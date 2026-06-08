/**
 * F4 — eu.country_arbitrage contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './eu.country_arbitrage';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const BASE: CalculatorInput = {
  country: 'DE',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 80_000,
  specialStatus: 'none',
  filingStatus: 'single',
};

describe('eu.country_arbitrage', () => {
  it('eligible-with-saving: DE 80k vs cheaper peer surfaces a delta', () => {
    const baseline = calculateTax(BASE);
    const result = STRATEGY.evaluate(BASE, baseline);
    // DE at 80k is high-tax vs at least one peer (NL/PT/UK/ES) — expect saving
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeGreaterThan(0);
    expect(result.confidence).toBe(0.6);
  });

  it('eligible-no-saving: when current country already lowest, applicable=false', () => {
    // Construct synthetic baseline that is already cheaper than any peer
    const baseline = { ...calculateTax(BASE), taxOwed: 0, effectiveRate: 0, marginalRate: 0 };
    const result = STRATEGY.evaluate(BASE, baseline);
    expect(result.applicable).toBe(false);
    expect(result.estimatedSavingsEur).toBe(0);
  });

  it('always informational: reason warns about non-tax factors', () => {
    const baseline = calculateTax(BASE);
    const result = STRATEGY.evaluate(BASE, baseline);
    if (result.applicable) {
      expect(result.reason).toMatch(/社保|医疗|家庭|参考/);
    }
  });

  it('confidence is 0.6 (heuristic, multi-factor)', () => {
    const baseline = calculateTax(BASE);
    const result = STRATEGY.evaluate(BASE, baseline);
    expect(result.confidence).toBe(0.6);
  });
});
