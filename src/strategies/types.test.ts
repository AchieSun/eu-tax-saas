/**
 * F4 strategy types + registry — contract tests.
 *
 * Verifies the invariants enforced by registerStrategy() and the shape of
 * the runtime registry. No tax math here — those tests live alongside
 * each strategy module.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { CalculatorInput, CalculatorResult } from '../rules/common/types';
import {
  STRATEGIES,
  _resetRegistryForTests,
  getStrategyById,
  listStrategiesByCountry,
  listStrategiesByTier,
  registerStrategy,
} from './index';
import {
  STRATEGY_TIERS,
  type Strategy,
  type StrategyEvaluation,
  type StrategyTier,
  strategyDefinitionSchema,
} from './types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOOP_EVALUATION: StrategyEvaluation = {
  applicable: false,
  reason: 'fixture — not applicable',
  confidence: 1,
};

function makeFixture(overrides: Partial<Strategy> = {}): Strategy {
  return {
    id: 'fix.example',
    tier: 'A',
    category: 'deduction',
    titleZh: '示例策略',
    descriptionZh: '仅用于单元测试',
    eligibility: {
      countries: ['ES'],
      taxYears: [2025],
    },
    citation: {
      source: 'Test fixture statute',
      url: 'https://example.com/statute',
      lastVerified: '2025-01-15',
    },
    evaluate: (_input: CalculatorInput, _baseline: CalculatorResult) => NOOP_EVALUATION,
    ...overrides,
  };
}

beforeEach(() => {
  _resetRegistryForTests();
});

// ── Test 1: duplicate id ────────────────────────────────────────────────────

describe('registerStrategy — uniqueness', () => {
  it('throws when a different strategy reuses an existing id', () => {
    const a = makeFixture({ id: 'dup.case' });
    const b = makeFixture({ id: 'dup.case', titleZh: '不同标题' });
    registerStrategy(a);
    expect(() => registerStrategy(b)).toThrow(/duplicate id "dup.case"/);
  });

  it('is idempotent when the same instance is re-registered', () => {
    const a = makeFixture({ id: 'idem.case' });
    registerStrategy(a);
    expect(() => registerStrategy(a)).not.toThrow();
    expect(STRATEGIES).toHaveLength(1);
  });
});

// ── Test 2: empty countries ────────────────────────────────────────────────

describe('registerStrategy — country validation', () => {
  it('throws when eligibility.countries is empty', () => {
    const s = makeFixture({
      id: 'no.countries',
      eligibility: { countries: [], taxYears: [2025] },
    });
    expect(() => registerStrategy(s)).toThrow(/countries must be non-empty/);
  });
});

// ── Test 3: future lastVerified ─────────────────────────────────────────────

describe('registerStrategy — lastVerified must not be future', () => {
  it('throws when citation.lastVerified is in the future', () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    const futureIso = future.toISOString().slice(0, 10);
    const s = makeFixture({
      id: 'future.verify',
      citation: {
        source: 'Future statute',
        url: 'https://example.com/x',
        lastVerified: futureIso,
      },
    });
    expect(() => registerStrategy(s)).toThrow(/in the future/);
  });
});

// ── Test 4 & 5: listing helpers ─────────────────────────────────────────────

describe('listStrategiesByCountry', () => {
  it('returns only strategies whose countries+taxYears match', () => {
    const esOnly = makeFixture({
      id: 'es.only',
      eligibility: { countries: ['ES'], taxYears: [2025] },
    });
    const ptOnly = makeFixture({
      id: 'pt.only',
      eligibility: { countries: ['PT'], taxYears: [2025] },
    });
    const future = makeFixture({
      id: 'es.future',
      eligibility: { countries: ['ES'], taxYears: [2026] },
    });
    registerStrategy(esOnly);
    registerStrategy(ptOnly);
    registerStrategy(future);
    const es2025 = listStrategiesByCountry('ES', 2025);
    expect(es2025.map((s) => s.id).sort()).toEqual(['es.only']);
    const es2026 = listStrategiesByCountry('ES', 2026);
    expect(es2026.map((s) => s.id).sort()).toEqual(['es.future']);
  });
});

describe('listStrategiesByTier', () => {
  it('filters by tier exactly', () => {
    const a = makeFixture({ id: 'a.tier', tier: 'A' });
    const b = makeFixture({ id: 'b.tier', tier: 'B' });
    registerStrategy(a);
    registerStrategy(b);
    expect(listStrategiesByTier('A').map((s) => s.id)).toEqual(['a.tier']);
    expect(listStrategiesByTier('B').map((s) => s.id)).toEqual(['b.tier']);
    expect(listStrategiesByTier('C')).toEqual([]);
  });
});

// ── Test 6: getStrategyById unknown ─────────────────────────────────────────

describe('getStrategyById', () => {
  it('returns undefined for an unknown id', () => {
    expect(getStrategyById('nonexistent.id')).toBeUndefined();
  });
});

// ── Test 7: tier enum exhaustiveness ────────────────────────────────────────

describe('StrategyTier enum', () => {
  it('is exhaustively A | B | C', () => {
    // Type-level test via `satisfies`: this fails to compile if the union
    // ever drifts. Runtime mirror just asserts shape.
    const expected = ['A', 'B', 'C'] as const satisfies readonly StrategyTier[];
    expect([...STRATEGY_TIERS]).toEqual([...expected]);
  });
});

// ── Test 8: URL validation ──────────────────────────────────────────────────

describe('registerStrategy — URL must be parseable', () => {
  it('throws on a non-URL citation.url', () => {
    const s = makeFixture({
      id: 'bad.url',
      citation: {
        source: 'Bad URL statute',
        url: 'not a url',
        lastVerified: '2025-06-01',
      },
    });
    expect(() => registerStrategy(s)).toThrow(/parseable URL/);
  });
});

// ── Bonus: Zod round-trip of definition (no `evaluate` field) ───────────────

describe('strategyDefinitionSchema', () => {
  it('round-trips a valid strategy definition (without evaluate)', () => {
    const s = makeFixture({ id: 'round.trip' });
    const { evaluate: _evaluate, ...definition } = s;
    const parsed = strategyDefinitionSchema.parse(definition);
    expect(parsed.id).toBe('round.trip');
    expect(parsed.eligibility.countries).toEqual(['ES']);
  });
});
