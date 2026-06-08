/**
 * F4 — de.expatriate (Auslandstätigkeitserlass) strategy contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './de.expatriate';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const DE_INPUT: CalculatorInput = {
  country: 'DE',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 90_000,
  specialStatus: 'none',
  filingStatus: 'single',
};

describe('de.expatriate', () => {
  it('eligible-with-saving (informational): returns null saving + confidence 0.7', () => {
    const baseline = calculateTax(DE_INPUT);
    const result = STRATEGY.evaluate(DE_INPUT, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeNull();
    expect(result.confidence).toBe(0.7);
    expect(result.reason).toMatch(/ATE/);
  });

  it('eligible-no-saving: high-income salary still surfaces same advisory shape', () => {
    const big: CalculatorInput = { ...DE_INPUT, grossIncome: 500_000 };
    const baseline = calculateTax(big);
    const result = STRATEGY.evaluate(big, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeNull();
  });

  it('ineligible-blocker: wrong country (NL) returns applicable=false', () => {
    const nl: CalculatorInput = { ...DE_INPUT, country: 'NL' };
    const baseline = calculateTax(nl);
    const result = STRATEGY.evaluate(nl, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/德国/);
  });

  it('missing-data: non-salary incomeType (rental) is gated out', () => {
    const rental: CalculatorInput = { ...DE_INPUT, incomeType: 'rental' };
    const baseline = calculateTax(rental);
    const result = STRATEGY.evaluate(rental, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/工资/);
  });
});
