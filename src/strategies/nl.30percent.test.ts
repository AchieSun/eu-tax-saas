/**
 * F4 — nl.30percent strategy contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { _resetRegistryForTests, registerStrategy } from './index';
import STRATEGY from './nl.30percent';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const NL_INPUT: CalculatorInput = {
  country: 'NL',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 100_000,
  specialStatus: '30pct_ruling',
  filingStatus: 'single',
};

describe('nl.30percent', () => {
  it('eligible-with-saving: 100k with 30% ruling produces real saving', () => {
    const baseline = calculateTax({ ...NL_INPUT, specialStatus: 'none' });
    const result = STRATEGY.evaluate(NL_INPUT, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeGreaterThan(0);
    expect(result.confidence).toBe(1);
  });

  it('eligible-no-saving: under threshold → ineligible by threshold gate', () => {
    const low: CalculatorInput = { ...NL_INPUT, grossIncome: 40_000 };
    const baseline = calculateTax({ ...low, specialStatus: 'none' });
    const result = STRATEGY.evaluate(low, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/46,660/);
  });

  it('ineligible-blocker: wrong country (UK) returns applicable=false', () => {
    const ukInput: CalculatorInput = { ...NL_INPUT, country: 'UK', region: 'EWN' };
    const baseline = calculateTax({ ...ukInput, specialStatus: 'none' });
    const result = STRATEGY.evaluate(ukInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/荷兰/);
  });

  it('missing-data: specialStatus=none rejects requiring 30%-regeling approval', () => {
    const noStatus: CalculatorInput = { ...NL_INPUT, specialStatus: 'none' };
    const baseline = calculateTax(noStatus);
    const result = STRATEGY.evaluate(noStatus, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/30%/);
  });
});
