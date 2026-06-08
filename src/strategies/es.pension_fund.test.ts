/**
 * F4 — es.pension_fund contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './es.pension_fund';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const ES_SALARY: CalculatorInput = {
  country: 'ES',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 60_000,
  specialStatus: 'none',
  filingStatus: 'single',
  region: 'MAD',
};

describe('es.pension_fund', () => {
  it('eligible-with-saving: ES salary returns saving = 1500 × marginal rate', () => {
    const baseline = calculateTax(ES_SALARY);
    const result = STRATEGY.evaluate(ES_SALARY, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBe(Math.round(1500 * baseline.marginalRate));
    expect(result.confidence).toBe(0.7);
  });

  it('ineligible-blocker: wrong country (DE) returns applicable=false', () => {
    const deInput: CalculatorInput = { ...ES_SALARY, country: 'DE', region: undefined };
    const baseline = calculateTax(deInput);
    const result = STRATEGY.evaluate(deInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/西班牙/);
  });

  it('ineligible-blocker: capital_gains income excluded', () => {
    const cgInput: CalculatorInput = { ...ES_SALARY, incomeType: 'capital_gains' };
    const baseline = calculateTax(cgInput);
    const result = STRATEGY.evaluate(cgInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/Cat A|工资|自雇/);
  });

  it('citation references art. 51 LIRPF + Ley 12/2022', () => {
    expect(STRATEGY.citation.source).toMatch(/51 LIRPF|12\/2022/);
    expect(STRATEGY.citation.url).toMatch(/boe\.es/);
  });
});
