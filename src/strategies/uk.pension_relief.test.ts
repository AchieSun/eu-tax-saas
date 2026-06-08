/**
 * F4 — uk.pension_relief contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { _resetRegistryForTests, registerStrategy } from './index';
import STRATEGY from './uk.pension_relief';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const UK_SALARY: CalculatorInput = {
  country: 'UK',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 80_000,
  specialStatus: 'none',
  filingStatus: 'single',
};

describe('uk.pension_relief', () => {
  it('eligible-with-saving: UK salary returns saving = 5000 × marginal rate', () => {
    const baseline = calculateTax(UK_SALARY);
    const result = STRATEGY.evaluate(UK_SALARY, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBe(Math.round(5000 * baseline.marginalRate));
    expect(result.confidence).toBe(0.7);
  });

  it('ineligible-blocker: wrong country (DE) returns applicable=false', () => {
    const deInput: CalculatorInput = { ...UK_SALARY, country: 'DE' };
    const baseline = calculateTax(deInput);
    const result = STRATEGY.evaluate(deInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/英国/);
  });

  it('citation references Finance Act 2023', () => {
    expect(STRATEGY.citation.source).toMatch(/Finance Act 2023|PTM/);
    expect(STRATEGY.citation.url).toMatch(/legislation\.gov\.uk/);
  });

  it('reason mentions £60,000 annual allowance', () => {
    const baseline = calculateTax(UK_SALARY);
    const result = STRATEGY.evaluate(UK_SALARY, baseline);
    expect(result.reason).toMatch(/60,000/);
  });
});
