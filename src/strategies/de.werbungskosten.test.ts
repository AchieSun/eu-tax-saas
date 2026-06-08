/**
 * F4 — de.werbungskosten contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './de.werbungskosten';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const DE_SALARY: CalculatorInput = {
  country: 'DE',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 60_000,
  specialStatus: 'none',
  filingStatus: 'single',
};

describe('de.werbungskosten', () => {
  it('eligible-with-saving: DE salary returns saving = 500 × marginal rate', () => {
    const baseline = calculateTax(DE_SALARY);
    const result = STRATEGY.evaluate(DE_SALARY, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBe(Math.round(500 * baseline.marginalRate));
    expect(result.confidence).toBe(0.6);
  });

  it('ineligible-blocker: wrong country (ES) returns applicable=false', () => {
    const esInput: CalculatorInput = { ...DE_SALARY, country: 'ES', region: 'MAD' };
    const baseline = calculateTax(esInput);
    const result = STRATEGY.evaluate(esInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/德国/);
  });

  it('ineligible-blocker: capital_gains income excluded', () => {
    const cgInput: CalculatorInput = { ...DE_SALARY, incomeType: 'capital_gains' };
    const baseline = calculateTax(cgInput);
    const result = STRATEGY.evaluate(cgInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/Werbungskosten|工资/);
  });

  it('citation references §9 / §9a EStG', () => {
    expect(STRATEGY.citation.source).toMatch(/§ 9|EStG/);
    expect(STRATEGY.citation.url).toMatch(/gesetze-im-internet/);
  });
});
