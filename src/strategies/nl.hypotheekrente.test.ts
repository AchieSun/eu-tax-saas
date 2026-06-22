/**
 * F4 — nl.hypotheekrente contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { _resetRegistryForTests, registerStrategy } from './index';
import STRATEGY from './nl.hypotheekrente';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const NL_SALARY: CalculatorInput = {
  country: 'NL',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 60_000,
  specialStatus: 'none',
  filingStatus: 'single',
};

describe('nl.hypotheekrente', () => {
  it('eligible-with-saving: NL returns saving = 5000 × 0.3697 ≈ 1849', () => {
    const baseline = calculateTax(NL_SALARY);
    const result = STRATEGY.evaluate(NL_SALARY, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBe(Math.round(5000 * 0.3697));
    expect(result.confidence).toBe(0.65);
  });

  it('ineligible-blocker: wrong country (DE) returns applicable=false', () => {
    const deInput: CalculatorInput = { ...NL_SALARY, country: 'DE' };
    const baseline = calculateTax(deInput);
    const result = STRATEGY.evaluate(deInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/荷兰/);
  });

  it('citation references Wet IB 2001 art. 3.119a', () => {
    expect(STRATEGY.citation.source).toMatch(/3\.119a|Wet IB/);
    expect(STRATEGY.citation.url).toMatch(/overheid\.nl/);
  });

  it('reason mentions 36.97% rate', () => {
    const baseline = calculateTax(NL_SALARY);
    const result = STRATEGY.evaluate(NL_SALARY, baseline);
    expect(result.reason).toMatch(/36\.97%/);
  });

  it('assumptions array lists annualMortgageInterestEur default with rationale', () => {
    const baseline = calculateTax(NL_SALARY);
    const result = STRATEGY.evaluate(NL_SALARY, baseline);
    expect(result.assumptions).toBeDefined();
    expect(result.assumptions).toHaveLength(1);
    expect(result.assumptions?.[0]).toMatchObject({
      field: 'annualMortgageInterestEur',
      defaultValue: 5000,
    });
    expect(result.assumptions?.[0].rationale).toMatch(/CBS|mortgage|median/);
  });
});
