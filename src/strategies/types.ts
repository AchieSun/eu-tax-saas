/**
 * F4 — Strategy library: shared type contracts.
 *
 * A "strategy" is a deterministic (Tier A) or semi-deterministic (Tier B)
 * tax-saving recommendation. Each strategy exposes an `evaluate(input, baseline)`
 * function that, given a user's F1 CalculatorInput plus the baseline tax owed,
 * returns an applicability decision plus an estimated EUR saving.
 *
 * Tier C (LLM-driven) strategies will reuse this same shape in W6 once the
 * DeepSeek harness lands — they're intentionally NOT registered here yet.
 *
 * Spec: docs/15-ai-prompts/w5-f4-strategy/README.md
 *       docs/09-feature-design.md F4 three-tier design
 *       docs/10-data-model.md `strategy_recommendations` table
 *
 * Anti-hallucination rules baked into the type contract (per
 * docs/16-ai-agent-workflow.md G2):
 *   - Every strategy MUST cite a real statute/regulation URL.
 *   - `citation.lastVerified` MUST be a real date in the past.
 *   - The registry refuses to register a strategy that violates either.
 *
 * Forbidden regimes (verified 2026-06-08; never register a strategy for these):
 *   - PT NHR — closed to new entrants 2024-01-01, replaced by IFICI.
 *   - UK Non-Dom remittance basis — abolished 2025-04-06, replaced by FIG.
 *   - NL 30% ruling sliding 30/20/10 — reversed in 2025 budget back to flat 30%.
 */

import { z } from 'zod';
import type {
  CalculatorInput,
  CalculatorResult,
  Country,
  IncomeType,
  SpecialStatus,
} from '../rules/common/types';
import { INCOME_TYPES, SPECIAL_STATUSES, SUPPORTED_COUNTRIES } from '../rules/common/types';

// ───────────────────────────────────────────────────────────────────────────
// Enums
// ───────────────────────────────────────────────────────────────────────────

export const STRATEGY_TIERS = ['A', 'B', 'C'] as const;
export type StrategyTier = (typeof STRATEGY_TIERS)[number];

/**
 * Functional grouping. Drives UI filtering and analytics.
 *   - special_status: Beckham, IFICI, FIG, 30% ruling — regime opt-in.
 *   - deduction:      itemised deductions (pension, mortgage, donations).
 *   - arbitrage:      cross-country / cross-regime comparisons.
 *   - structuring:    legal entity / income-source restructuring.
 *   - timing:         realisation timing (LTCG holding, year-end planning).
 *   - family:         joint filing, splitting, dependent reliefs.
 */
export const STRATEGY_CATEGORIES = [
  'special_status',
  'deduction',
  'arbitrage',
  'structuring',
  'timing',
  'family',
] as const;
export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number];

// ───────────────────────────────────────────────────────────────────────────
// Citation
// ───────────────────────────────────────────────────────────────────────────

export const citationSchema = z.object({
  /** Human-readable source, e.g. "Ley 35/2006 art. 93". */
  source: z.string().min(1),
  /** Real URL — registry rejects unparseable URLs. */
  url: z.string().url(),
  /** ISO YYYY-MM-DD; registry rejects future dates. */
  lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'lastVerified must be YYYY-MM-DD'),
});
export type StrategyCitation = z.infer<typeof citationSchema>;

// ───────────────────────────────────────────────────────────────────────────
// Eligibility
// ───────────────────────────────────────────────────────────────────────────

export const eligibilitySchema = z.object({
  /** Countries this strategy applies in. Registry rejects empty arrays. */
  countries: z.array(z.enum(SUPPORTED_COUNTRIES)).min(1),
  /** Optional income-type whitelist (e.g. ['salary','self_employed']). */
  incomeTypes: z.array(z.enum(INCOME_TYPES)).optional(),
  /** Optional special-status whitelist (e.g. ['beckham']). */
  specialStatuses: z.array(z.enum(SPECIAL_STATUSES)).optional(),
  /** Optional inclusive lower-bound gross income (EUR). */
  minIncome: z.number().nonnegative().optional(),
  /** Optional inclusive upper-bound gross income (EUR). */
  maxIncome: z.number().nonnegative().optional(),
  /** Optional inclusive lower-bound age. */
  minAgeYears: z.number().int().nonnegative().optional(),
  /** Optional inclusive upper-bound age. */
  maxAgeYears: z.number().int().nonnegative().optional(),
  /** Tax years this strategy is valid for. */
  taxYears: z.array(z.number().int().min(2024).max(2030)).min(1),
});
export type StrategyEligibility = z.infer<typeof eligibilitySchema>;

// ───────────────────────────────────────────────────────────────────────────
// Evaluation result
// ───────────────────────────────────────────────────────────────────────────

export const evaluationSchema = z.object({
  applicable: z.boolean(),
  /**
   * End-user-facing reason in Chinese (Sisyphus product is zh-primary).
   * When applicable=true, this is a short summary; when false, it explains
   * why (e.g. "需要 Beckham 身份才能享受 24% 优惠税率").
   */
  reason: z.string().min(1),
  /**
   * Annual saving in EUR. Null when not computable (e.g. requires extra
   * user data, or strategy is informational-only).
   */
  estimatedSavingsEur: z.number().nullable().optional(),
  /** 0..1 — 1.0 = fully deterministic, < 0.75 = LLM/heuristic. */
  confidence: z.number().min(0).max(1),
});
export type StrategyEvaluation = z.infer<typeof evaluationSchema>;

// ───────────────────────────────────────────────────────────────────────────
// Strategy
// ───────────────────────────────────────────────────────────────────────────

/**
 * Runtime contract for a strategy module.
 *
 * The registry validates everything except `evaluate` (which is a function and
 * cannot be Zod-checked). Each strategy file exports a single `Strategy` const
 * and calls `registerStrategy(myStrategy)` from `./index.ts`.
 */
export interface Strategy {
  /** Globally unique slug, e.g. "es.beckham". Registry refuses duplicates. */
  id: string;
  tier: StrategyTier;
  category: StrategyCategory;
  /** End-user-facing Chinese title. */
  titleZh: string;
  /** End-user-facing Chinese description (1-3 sentences). */
  descriptionZh: string;
  eligibility: StrategyEligibility;
  citation: StrategyCitation;
  /**
   * Pure function. MUST NOT mutate inputs. SHOULD return applicable:false
   * with a clear reason rather than throwing when ineligible.
   *
   * `baseline` is the F1 CalculatorResult with specialStatus='none' — i.e.
   * the user's tax if no strategy applies. evaluate() returns the delta
   * vs that baseline.
   */
  evaluate(input: CalculatorInput, baseline: CalculatorResult): StrategyEvaluation;
}

/**
 * Static-only Zod schema for round-tripping a strategy *definition* without
 * its `evaluate` function. Used by tests and by the persistence layer when
 * serialising a recommendation to D1 (see `strategy_recommendations` table).
 */
export const strategyDefinitionSchema = z.object({
  id: z.string().min(1),
  tier: z.enum(STRATEGY_TIERS),
  category: z.enum(STRATEGY_CATEGORIES),
  titleZh: z.string().min(1),
  descriptionZh: z.string().min(1),
  eligibility: eligibilitySchema,
  citation: citationSchema,
});

// Re-export referenced types from rules layer so consumers don't need
// two imports.
export type { CalculatorInput, CalculatorResult, Country, IncomeType, SpecialStatus };
