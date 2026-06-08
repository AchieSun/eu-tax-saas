/**
 * F4 — strategy library routes.
 *
 * GET  /api/strategies            → static catalog (id, tier, category, title, citation)
 * GET  /api/strategies/status     → liveness + registered strategy count
 * POST /api/strategies/evaluate   → run all strategies against a CalculatorInput
 * POST /api/strategies/persist    → persist a chosen evaluation to D1 (auth + DB)
 *
 * The catalog / evaluate routes are pure: no auth, no DB, no rate-limit (the
 * calculator is the costly call, not the strategy registry). The persist
 * route writes to `strategy_recommendations` and is gated by a D1 rate limit
 * (60/min) plus session auth.
 *
 * Importing './strategies' triggers side-effect registration of all bundled
 * Tier A + B strategies at module load.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../../db';
import { strategyRecommendations } from '../../db/schema';
import { calculateTax, calculatorInputSchema } from '../../rules';
import { SUPPORTED_COUNTRIES } from '../../rules/common/types';
import type { Country } from '../../rules/common/types';
import { STRATEGIES, getStrategyById, listStrategiesByCountry } from '../../strategies';
import type { Strategy, StrategyEvaluation } from '../../strategies/types';
import type { Bindings, Variables } from '../index';
import { rateLimitD1 } from '../middleware/rate-limit-d1';

export const strategiesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── GET /api/strategies/status ─────────────────────────────────────────────
strategiesRoutes.get('/status', (c) =>
  c.json({
    status: 'implemented',
    tiers: ['A', 'B'],
    registered: STRATEGIES.length,
    note: 'Tier C (LLM-driven) reserved for W6',
  }),
);

// ── GET /api/strategies ────────────────────────────────────────────────────
// Optional ?country=ES&taxYear=2025 filter. Returns static definitions.
strategiesRoutes.get('/', (c) => {
  const country = c.req.query('country');
  const taxYearStr = c.req.query('taxYear');
  let list: Strategy[] = STRATEGIES;
  if (country) {
    if (!(SUPPORTED_COUNTRIES as readonly string[]).includes(country)) {
      return c.json({ ok: false, error: 'invalid_country' }, 400);
    }
    const taxYear = taxYearStr ? Number.parseInt(taxYearStr, 10) : 2025;
    if (!Number.isInteger(taxYear) || taxYear < 2024 || taxYear > 2030) {
      return c.json({ ok: false, error: 'invalid_tax_year' }, 400);
    }
    list = listStrategiesByCountry(country as Country, taxYear);
  }
  const items = list.map(
    ({ id, tier, category, titleZh, descriptionZh, eligibility, citation }) => ({
      id,
      tier,
      category,
      titleZh,
      descriptionZh,
      eligibility,
      citation,
    }),
  );
  return c.json({ ok: true, count: items.length, items });
});

// ── POST /api/strategies/evaluate ──────────────────────────────────────────
// Body: CalculatorInput. Returns the baseline tax + per-strategy evaluation.
// Pure: no DB, no auth (mirrors POST /api/calculate which also takes raw inputs).
strategiesRoutes.post('/evaluate', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400);
  }
  const parsed = calculatorInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'validation', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;
  let baseline: ReturnType<typeof calculateTax>;
  try {
    baseline = calculateTax({ ...input, specialStatus: 'none' });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 400);
  }
  // Evaluate ALL strategies; surface eligible AND ineligible so the UI can
  // explain *why* something was excluded (anti-hallucination G2).
  const evaluations = STRATEGIES.map((s: Strategy) => {
    let result: StrategyEvaluation;
    try {
      result = s.evaluate(input, baseline);
    } catch (err) {
      result = {
        applicable: false,
        reason: `策略评估失败: ${(err as Error).message}`,
        confidence: 0,
        estimatedSavingsEur: null,
      };
    }
    return {
      id: s.id,
      tier: s.tier,
      category: s.category,
      titleZh: s.titleZh,
      citation: s.citation,
      ...result,
    };
  });
  // Sort: applicable first, then by estimated saving desc, then by confidence desc.
  evaluations.sort((a, b) => {
    if (a.applicable !== b.applicable) return a.applicable ? -1 : 1;
    const sa = a.estimatedSavingsEur ?? 0;
    const sb = b.estimatedSavingsEur ?? 0;
    if (sb !== sa) return sb - sa;
    return b.confidence - a.confidence;
  });
  return c.json({
    ok: true,
    baseline: {
      country: baseline.country,
      taxYear: baseline.taxYear,
      grossIncome: baseline.grossIncome,
      taxOwed: baseline.taxOwed,
      effectiveRate: baseline.effectiveRate,
      marginalRate: baseline.marginalRate,
    },
    evaluations,
  });
});

// ── POST /api/strategies/persist ───────────────────────────────────────────
// Auth + rate-limited. Persists a single evaluation row to D1.
const persistSchema = z.object({
  strategyId: z.string().min(1),
  taxYear: z.number().int().min(2024).max(2030),
  estimatedSavings: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1),
  eligible: z.boolean(),
  reason: z.string().min(1),
});

strategiesRoutes.post(
  '/persist',
  rateLimitD1({ keyPrefix: 'rl:strategies', max: 60, windowSeconds: 60 }),
  async (c) => {
    const session = c.get('session');
    if (!session?.user?.id) return c.json({ ok: false, error: 'unauthorized' }, 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid_json' }, 400);
    }
    const parsed = persistSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'validation', issues: parsed.error.issues }, 400);
    }
    const strategy = getStrategyById(parsed.data.strategyId);
    if (!strategy) {
      return c.json({ ok: false, error: 'unknown_strategy_id' }, 404);
    }
    const db = createDb(c.env.DB);
    const id = crypto.randomUUID();
    await db.insert(strategyRecommendations).values({
      id,
      userId: session.user.id,
      taxYear: parsed.data.taxYear,
      strategyId: parsed.data.strategyId,
      tier: strategy.tier,
      eligible: parsed.data.eligible,
      estimatedSavings: parsed.data.estimatedSavings ?? null,
      confidence: parsed.data.confidence,
      actionSteps: [parsed.data.reason],
      citations: [strategy.citation],
    });
    return c.json({ ok: true, id });
  },
);

export default strategiesRoutes;
