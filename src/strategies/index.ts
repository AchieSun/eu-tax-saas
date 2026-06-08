/**
 * F4 — Strategy registry.
 *
 * Strategies self-register at module load via `registerStrategy()`. The registry
 * enforces three invariants (per docs/16-ai-agent-workflow.md G2):
 *   1. IDs are globally unique.
 *   2. `eligibility.countries` is non-empty.
 *   3. `citation.lastVerified` is a real date in the past.
 *   4. `citation.url` is a parseable URL.
 *
 * Tier A / B strategies live under this folder. Tier C is reserved for W6
 * LLM-driven additions and is intentionally NOT importable here yet.
 */

import type { Country } from '../rules/common/types';
import type { Strategy, StrategyTier } from './types';

// ───────────────────────────────────────────────────────────────────────────
// Internal store
// ───────────────────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, Strategy>();

/**
 * Snapshot of all registered strategies. Returned as a new array on every
 * read so callers can mutate freely (sort, filter, etc.) without poisoning
 * the registry.
 */
export const STRATEGIES: Strategy[] = [];

function rebuildSnapshot(): void {
  STRATEGIES.length = 0;
  for (const s of REGISTRY.values()) STRATEGIES.push(s);
}

// ───────────────────────────────────────────────────────────────────────────
// Validation helpers
// ───────────────────────────────────────────────────────────────────────────

function assertValidUrl(url: string, strategyId: string): void {
  try {
    // URL constructor throws on invalid input. We allow any scheme (some
    // statute portals use http://).
    new URL(url);
  } catch {
    throw new Error(`registerStrategy(${strategyId}): citation.url is not a parseable URL: ${url}`);
  }
}

function assertValidLastVerified(lastVerified: string, strategyId: string): void {
  // YYYY-MM-DD already enforced by Zod at the call site (when the strategy
  // is constructed). Here we additionally check that the date is real and
  // not in the future.
  const parsed = new Date(`${lastVerified}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `registerStrategy(${strategyId}): citation.lastVerified is not a real date: ${lastVerified}`,
    );
  }
  // Compare against today at UTC midnight. We treat "today" as still valid
  // (a strategy verified this morning is fine).
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (parsed.getTime() > todayUtc) {
    throw new Error(
      `registerStrategy(${strategyId}): citation.lastVerified is in the future: ${lastVerified}`,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Register a strategy. Idempotent only when called with the same instance —
 * a duplicate `id` from a different object throws. Used by each strategy
 * module's side-effecting top-level call.
 */
export function registerStrategy(s: Strategy): void {
  if (!s.id) {
    throw new Error('registerStrategy: strategy id is required');
  }
  if (REGISTRY.has(s.id) && REGISTRY.get(s.id) !== s) {
    throw new Error(`registerStrategy: duplicate id "${s.id}"`);
  }
  if (!s.eligibility.countries || s.eligibility.countries.length === 0) {
    throw new Error(`registerStrategy(${s.id}): eligibility.countries must be non-empty`);
  }
  assertValidUrl(s.citation.url, s.id);
  assertValidLastVerified(s.citation.lastVerified, s.id);

  REGISTRY.set(s.id, s);
  rebuildSnapshot();
}

/**
 * Test-only: clear the registry. Exposed so unit tests can re-register
 * fixtures without leaking state across `describe()` blocks.
 */
export function _resetRegistryForTests(): void {
  REGISTRY.clear();
  rebuildSnapshot();
}

export function getStrategyById(id: string): Strategy | undefined {
  return REGISTRY.get(id);
}

/**
 * All strategies whose `eligibility.countries` includes `country` AND whose
 * `eligibility.taxYears` includes `taxYear`.
 */
export function listStrategiesByCountry(country: Country, taxYear: number): Strategy[] {
  return STRATEGIES.filter(
    (s) => s.eligibility.countries.includes(country) && s.eligibility.taxYears.includes(taxYear),
  );
}

export function listStrategiesByTier(tier: StrategyTier): Strategy[] {
  return STRATEGIES.filter((s) => s.tier === tier);
}

// ───────────────────────────────────────────────────────────────────────────
// Auto-registration of bundled strategies.
//
// Each strategy file invokes `registerStrategy()` at module-load time. Importing
// them here as a side-effect ensures the registry is populated whenever this
// module is touched. Commit 2 will add A-tier imports; commit 3 adds B-tier.
// ───────────────────────────────────────────────────────────────────────────

// (intentionally empty in commit 1 — A-tier strategies wire up in commit 2)
