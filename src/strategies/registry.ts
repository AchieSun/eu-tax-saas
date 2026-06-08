/**
 * F4 — Strategy registry core.
 *
 * Split from `./index.ts` so that strategy modules can `import { registerStrategy }
 * from './registry'` WITHOUT participating in the circular import cycle that
 * `./index.ts` creates by side-effect-importing every strategy. ES modules
 * tolerate the cycle only as long as the strategy module never reads a binding
 * from `./index` at evaluation time — relying on `registry.ts` (which is a leaf
 * module) is the safe pattern.
 *
 * Invariants enforced (per docs/16-ai-agent-workflow.md G2):
 *   1. IDs are globally unique.
 *   2. `eligibility.countries` is non-empty.
 *   3. `citation.lastVerified` is a real date in the past.
 *   4. `citation.url` is a parseable URL.
 */

import type { Country } from '../rules/common/types';
import type { Strategy, StrategyTier } from './types';

const REGISTRY = new Map<string, Strategy>();

/**
 * Snapshot of all registered strategies. The array reference is stable; its
 * contents are rebuilt in place every time a strategy registers. Callers that
 * sort/filter should copy first.
 */
export const STRATEGIES: Strategy[] = [];

function rebuildSnapshot(): void {
  STRATEGIES.length = 0;
  for (const s of REGISTRY.values()) STRATEGIES.push(s);
}

function assertValidUrl(url: string, strategyId: string): void {
  try {
    new URL(url);
  } catch {
    throw new Error(`registerStrategy(${strategyId}): citation.url is not a parseable URL: ${url}`);
  }
}

function assertValidLastVerified(lastVerified: string, strategyId: string): void {
  const parsed = new Date(`${lastVerified}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `registerStrategy(${strategyId}): citation.lastVerified is not a real date: ${lastVerified}`,
    );
  }
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (parsed.getTime() > todayUtc) {
    throw new Error(
      `registerStrategy(${strategyId}): citation.lastVerified is in the future: ${lastVerified}`,
    );
  }
}

/**
 * Register a strategy. Idempotent only when called with the same instance —
 * a duplicate `id` from a different object throws.
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

/** Test-only: clear the registry. Guarded so a production caller cannot
 *  accidentally wipe the registry — Workers has no `process.env` so we
 *  detect test mode via `NODE_ENV==='test'` OR the vitest global `vi`. */
export function _resetRegistryForTests(): void {
  const isNodeTest =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
  const isViTest = typeof globalThis !== 'undefined' && 'vi' in globalThis;
  if (!isNodeTest && !isViTest) {
    throw new Error('_resetRegistryForTests is only callable in test environment');
  }
  REGISTRY.clear();
  rebuildSnapshot();
}

export function getStrategyById(id: string): Strategy | undefined {
  return REGISTRY.get(id);
}

export function listStrategiesByCountry(country: Country, taxYear: number): Strategy[] {
  return STRATEGIES.filter(
    (s) => s.eligibility.countries.includes(country) && s.eligibility.taxYears.includes(taxYear),
  );
}

export function listStrategiesByTier(tier: StrategyTier): Strategy[] {
  return STRATEGIES.filter((s) => s.tier === tier);
}
