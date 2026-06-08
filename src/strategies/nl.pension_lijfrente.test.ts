/**
 * F4 — nl.pension_lijfrente contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { _resetRegistryForTests, registerStrategy } from './index';
import STRATEGY from './nl.pension_lijfrente';

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

describe('nl.pension_lijfrente', () => {
  it('eligible-with-saving: NL salary returns saving = 5000 × marginal rate', () => {
    const baseline = calculateTax(NL_SALARY);
    const result = STRATEGY.evaluate(NL_SALARY, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBe(Math.round(5000 * baseline.marginalRate));
    expect(result.confidence).toBe(0.65);
  });

  it('ineligible-blocker: wrong country (PT) returns applicable=false', () => {
    const ptInput: CalculatorInput = { ...NL_SALARY, country: 'PT' };
    const baseline = calculateTax(ptInput);
    const result = STRATEGY.evaluate(ptInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/荷兰/);
  });

  it('citation references Wet IB 2001 art. 3.127', () => {
    expect(STRATEGY.citation.source).toMatch(/3\.127|Wet IB/);
    expect(STRATEGY.citation.url).toMatch(/overheid\.nl/);
  });

  it('reason mentions jaarruimte', () => {
    const baseline = calculateTax(NL_SALARY);
    const result = STRATEGY.evaluate(NL_SALARY, baseline);
    expect(result.reason).toMatch(/jaarruimte/);
  });
});
