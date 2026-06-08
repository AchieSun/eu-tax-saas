/**
 * F4 — uk.fig strategy contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { _resetRegistryForTests, registerStrategy } from './index';
import STRATEGY from './uk.fig';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const UK_INPUT: CalculatorInput = {
  country: 'UK',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 150_000,
  specialStatus: 'fig',
  filingStatus: 'single',
  region: 'EWN',
};

describe('uk.fig', () => {
  it('eligible-with-saving: FIG zeros foreign income, large saving', () => {
    const baseline = calculateTax({ ...UK_INPUT, specialStatus: 'none' });
    const result = STRATEGY.evaluate(UK_INPUT, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeGreaterThan(0);
    expect(result.confidence).toBe(0.9);
  });

  it('eligible-no-saving: 0 income → no FIG benefit', () => {
    const zero: CalculatorInput = { ...UK_INPUT, grossIncome: 0 };
    const baseline = calculateTax({ ...zero, specialStatus: 'none' });
    const result = STRATEGY.evaluate(zero, baseline);
    expect(result.applicable).toBe(false);
    expect(result.estimatedSavingsEur).toBe(0);
  });

  it('ineligible-blocker: wrong country (DE) returns applicable=false', () => {
    const deInput: CalculatorInput = { ...UK_INPUT, country: 'DE', region: undefined };
    const baseline = calculateTax({ ...deInput, specialStatus: 'none' });
    const result = STRATEGY.evaluate(deInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/英国/);
  });

  it('missing-data: specialStatus=none rejects requiring FIG claim', () => {
    const noStatus: CalculatorInput = { ...UK_INPUT, specialStatus: 'none' };
    const baseline = calculateTax(noStatus);
    const result = STRATEGY.evaluate(noStatus, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/FIG/);
  });
});
