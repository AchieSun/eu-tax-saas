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
import type { CalculatorInput } from '../../rules/common/types';
import { SUPPORTED_COUNTRIES } from '../../rules/common/types';
import type { Country } from '../../rules/common/types';
import { recommendStrategies } from '../../services/f4-llm';
import { STRATEGIES, getStrategyById, listStrategiesByCountry } from '../../strategies';
import type { Strategy, StrategyEvaluation } from '../../strategies/types';
import type { Bindings, Variables } from '../index';
import { rateLimitD1 } from '../middleware/rate-limit-d1';
import { fetchUserAccess, isPro, requireActiveSubscription } from '../middleware/subscription';

export const strategiesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── i18n (bilingual strategy output) ────────────────────────────────────────
//
// GET / and POST /evaluate serve BOTH languages side by side on every
// response - the payload carries titleZh+titleEn, descriptionZh+descriptionEn,
// reason+reasonEn - so the SPA can switch language instantly with no refetch.
// Per the t4 contract the server is NOT locale-aware: it never sniffs
// Accept-Language and never picks a language for the client. The SPA reads
// whichever paired field matches its locale (falling back to Zh).
//
// The one exception is POST /ai-recommend's single-string `aiDisclaimer`,
// which cannot carry both languages at once - an EXPLICIT ?lang=en query
// param switches it to English (default stays zh).

function resolveLang(c: { req: { query: (k: string) => string | undefined } }): 'zh' | 'en' {
  return (c.req.query('lang') ?? '').toLowerCase() === 'en' ? 'en' : 'zh';
}

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
  const items = list.map((s) => ({
    id: s.id,
    tier: s.tier,
    category: s.category,
    // Full bilingual pair always crosses the wire; the SPA picks the side
    // matching its locale (Zh fallback) - the server never chooses.
    titleZh: s.titleZh,
    titleEn: s.titleEn ?? '',
    descriptionZh: s.descriptionZh,
    descriptionEn: s.descriptionEn ?? '',
    eligibility: s.eligibility,
    citation: s.citation,
  }));
  return c.json({ ok: true, count: items.length, items });
});

// ── F4 free-tier server-side trimming (t3 spec gap #1) ──────────────────────
//
// Free users (anon / free / past_due) see a trimmed evaluation: applicable,
// the bilingual title pair (titleZh+titleEn), and estimatedSavingsEur survive
// (the savings figure is the conversion hook — "see how much you can save"),
// while the how-to details are cut: reason and reasonEn clipped to
// REASON_MAX_CHARS with an ellipsis, actionSteps and citations emptied. Pro users (admin OR active subscription) get the
// full payload. Trimming happens HERE on the server — never via frontend
// hiding, since the full JSON crosses the wire otherwise.
const REASON_MAX_CHARS = 60;
const ELLIPSIS = '…';

function trimReason(reason: string): string {
  if (reason.length <= REASON_MAX_CHARS) return reason;
  // Reserve one char for the ellipsis so the trimmed string stays ≤ 61.
  return `${reason.slice(0, REASON_MAX_CHARS - 1)}${ELLIPSIS}`;
}

interface EvaluationRow {
  id: string;
  tier: string;
  category: string;
  titleZh: string;
  titleEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  citation: unknown;
  applicable: boolean;
  reason: string;
  reasonEn?: string;
  estimatedSavingsEur?: number | null;
  confidence: number;
  assumptions?: unknown;
}

/**
 * Apply free-tier trimming to one evaluation row. Returns a new object —
 * never mutates the input. Fields kept: id/tier/category/titleZh+titleEn/
 * applicable/estimatedSavingsEur/confidence (sorting already happened on the
 * full data, so confidence survives for display). Fields cut: reason AND
 * reasonEn (both clipped to REASON_MAX_CHARS), actionSteps (→ []),
 * citations (→ []).
 */
function trimEvaluationForFree(ev: EvaluationRow): EvaluationRow & {
  actionSteps: string[];
  citations: unknown[];
} {
  return {
    ...ev,
    reason: trimReason(ev.reason),
    reasonEn: ev.reasonEn !== undefined ? trimReason(ev.reasonEn) : undefined,
    actionSteps: [],
    citations: [],
  };
}

/** Pro view of a rule-engine evaluation: full reason + guidance + citations. */
function toFullEvaluation(
  ev: EvaluationRow,
  guidance: string,
): EvaluationRow & { actionSteps: string[]; citations: unknown[] } {
  return {
    ...ev,
    // Rule-engine strategies don't emit structured step lists; the strategy's
    // usage description is the actionable guidance, and the full reason (with
    // concrete numbers) plus the statute citation are the paid deliverables.
    actionSteps: [guidance],
    citations: [ev.citation],
  };
}

// ── POST /api/strategies/evaluate ──────────────────────────────────────────
// Body: CalculatorInput. Returns the baseline tax + per-strategy evaluation.
// Pure compute: no DB writes. Oracle P1#3: rate-limited at 30/min per
// (user|anon) bucket since each call iterates 22 strategies × calculator
// — non-trivial CPU on a Worker. No auth required; the caller's Pro status
// (resolved via users.role + users.subscription_status when a session is
// attached) decides full vs trimmed evaluations.
strategiesRoutes.post(
  '/evaluate',
  rateLimitD1({
    keyPrefix: 'rl:strategies:eval',
    max: 30,
    windowSeconds: 60,
    requireSession: false,
  }),
  async (c) => {
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
    // Oracle P0#1: baseline uses specialStatus='none', but some country calculators
    // require a region in that mode that the regime itself does not (e.g. ES Beckham
    // is a single national flat rate; non-Beckham ES requires a CCAA). Mirror the
    // defensive defaulting from `compareCountries()` in src/rules/index.ts so the
    // baseline never crashes for inputs that the regime-aware path accepts.
    const baselineInput: CalculatorInput = { ...input, specialStatus: 'none' };
    if (baselineInput.country === 'ES' && !baselineInput.region) {
      baselineInput.region = 'MAD';
    }
    if (baselineInput.country === 'UK' && !baselineInput.region) {
      baselineInput.region = 'EWN';
    }
    let baseline: ReturnType<typeof calculateTax>;
    try {
      baseline = calculateTax(baselineInput);
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 400);
    }
    // t3: resolve Pro status. /evaluate is the acquisition funnel — no auth
    // required. Anon → trimmed. Session attached → look up role +
    // subscription_status (same source of truth as the hard gates). On a DB
    // lookup failure we degrade to the TRIMMED view (fail-safe for revenue:
    // the funnel stays up, worst case a Pro user sees the free view).
    let pro = false;
    const sessionUserId = c.get('session')?.user?.id;
    if (sessionUserId) {
      try {
        const db = createDb(c.env.DB);
        pro = isPro(await fetchUserAccess(db, sessionUserId));
      } catch (err) {
        console.error('/evaluate: Pro lookup failed, degrading to trimmed view', err);
        pro = false;
      }
    }

    // Evaluate ALL strategies; surface eligible AND ineligible so the UI can
    // explain *why* something was excluded (anti-hallucination G2).
    // Sorting runs on the FULL rows; trimming is applied afterwards so the
    // order is identical for free and Pro views.
    const fullRows = STRATEGIES.map((s: Strategy) => {
      let result: StrategyEvaluation;
      try {
        result = s.evaluate(input, baseline);
      } catch (err) {
        result = {
          applicable: false,
          reason: `策略评估失败: ${(err as Error).message}`,
          reasonEn: `Strategy evaluation failed: ${(err as Error).message}`,
          confidence: 0,
          estimatedSavingsEur: null,
        };
      }
      return {
        id: s.id,
        tier: s.tier,
        category: s.category,
        titleZh: s.titleZh,
        titleEn: s.titleEn ?? '',
        citation: s.citation,
        descriptionZh: s.descriptionZh,
        descriptionEn: s.descriptionEn ?? '',
        ...result,
      };
    });
    // Sort: applicable first, then by estimated saving desc, then by confidence desc.
    fullRows.sort((a, b) => {
      if (a.applicable !== b.applicable) return a.applicable ? -1 : 1;
      const sa = a.estimatedSavingsEur ?? 0;
      const sb = b.estimatedSavingsEur ?? 0;
      if (sb !== sa) return sb - sa;
      return b.confidence - a.confidence;
    });

    // t3: server-side paywall trimming. Free rows drop the how-to (reason
    // clipped, no guidance step, no statute citations) but keep the savings
    // figure — the conversion hook. Pro rows keep everything and gain the
    // explicit actionSteps/citations arrays.
    const evaluations = fullRows.map((row) => {
      if (pro) {
        return toFullEvaluation(row, row.descriptionZh ?? row.titleZh);
      }
      return trimEvaluationForFree(row);
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
  },
);

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
  // Paywall (F4): persisting a report is a Pro feature — the full strategy
  // report (AI recommendations + saved baseline) is the paid deliverable.
  // Mounted BEFORE rateLimitD1 so a refused 402 doesn't burn a quota slot.
  requireActiveSubscription({ feature: 'strategy-report-persist' }),
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

// ── POST /api/strategies/ai-recommend ──────────────────────────────────────
// F4 Wave C: Pro feature. Wraps the 6-layer LLM harness (recommendStrategies).
// Returns C-tier AI suggestions alongside the rule-based evaluations the user
// has already seen. The paywall mounts BEFORE the rate limit so a refused
// 402 doesn't burn one of the 10/hour Pro slots.
strategiesRoutes.post(
  '/ai-recommend',
  requireActiveSubscription({ feature: 'ai-strategy-report' }),
  rateLimitD1({
    keyPrefix: 'rl:strategies:ai',
    max: 10,
    windowSeconds: 3600,
    requireSession: true,
  }),
  async (c) => {
    const session = c.get('session');
    if (!session?.user?.id) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }
    if (!c.env.DEEPSEEK_API_KEY) {
      return c.json({ ok: false, error: 'llm_unavailable' }, 503);
    }
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
    const baselineInput: CalculatorInput = { ...input, specialStatus: 'none' };
    if (baselineInput.country === 'ES' && !baselineInput.region) {
      baselineInput.region = 'MAD';
    }
    if (baselineInput.country === 'UK' && !baselineInput.region) {
      baselineInput.region = 'EWN';
    }
    let baseline: ReturnType<typeof calculateTax>;
    try {
      baseline = calculateTax(baselineInput);
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 400);
    }
    const existing = listStrategiesByCountry(input.country, input.taxYear);
    try {
      const result = await recommendStrategies({
        env: c.env,
        input,
        baseline,
        existingStrategies: existing,
        maxLlmStrategies: 3,
      });
      const lang = resolveLang(c);
      return c.json({
        ok: true,
        baseline: {
          country: baseline.country,
          taxYear: baseline.taxYear,
          taxOwed: baseline.taxOwed,
        },
        recommendations: result.llmRecommendations.map((r) => ({
          id: r.id,
          tier: r.tier,
          titleZh: r.titleZh,
          titleEn: r.titleEn,
          reasoning: r.raw.reasoning,
          confidence: r.confidence,
          estimatedSavingsEur: r.estimatedSavingsEur,
          actionSteps: r.raw.action_steps,
          citations: r.raw.citations,
          aiDisclaimer:
            lang === 'en'
              ? '[AI suggestion · not deterministically verified]'
              : '[AI建议·未经确定性验证]',
        })),
        warnings: result.warnings,
        usage: result.usage,
      });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500);
    }
  },
);
