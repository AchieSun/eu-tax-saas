/**
 * F4 — de.riester contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './de.riester';
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

describe('de.riester', () => {
  it('eligible-with-saving: DE salary returns saving ≥ Grundzulage 175', () => {
    const baseline = calculateTax(DE_SALARY);
    const result = STRATEGY.evaluate(DE_SALARY, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeGreaterThanOrEqual(175);
    expect(result.confidence).toBe(0.65);
  });

  it('ineligible-blocker: wrong country (NL) returns applicable=false', () => {
    const nlInput: CalculatorInput = { ...DE_SALARY, country: 'NL' };
    const baseline = calculateTax(nlInput);
    const result = STRATEGY.evaluate(nlInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/德国/);
  });

  it('ineligible-blocker: self_employed income (not Pflichtversichert)', () => {
    const seInput: CalculatorInput = { ...DE_SALARY, incomeType: 'self_employed' };
    const baseline = calculateTax(seInput);
    const result = STRATEGY.evaluate(seInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/Pflichtversicherte|工资/);
  });

  it('citation references § 10a EStG', () => {
    expect(STRATEGY.citation.source).toMatch(/10a|EStG/);
    expect(STRATEGY.citation.url).toMatch(/gesetze-im-internet/);
  });
});
