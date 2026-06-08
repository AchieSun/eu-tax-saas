/**
 * F4 — eu.dtt_relief contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './eu.dtt_relief';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const SALARY: CalculatorInput = {
  country: 'ES',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 60_000,
  specialStatus: 'none',
  filingStatus: 'single',
  region: 'MAD',
};

describe('eu.dtt_relief', () => {
  it('eligible-no-data: salary case returns applicable=true with null saving', () => {
    const baseline = calculateTax(SALARY);
    const result = STRATEGY.evaluate(SALARY, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeNull();
    expect(result.reason).toMatch(/foreignTaxPaid|境外/);
  });

  it('eligible-no-data: capital_gains case also returns applicable=true', () => {
    const cgInput: CalculatorInput = { ...SALARY, incomeType: 'capital_gains' };
    const baseline = calculateTax(cgInput);
    const result = STRATEGY.evaluate(cgInput, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeNull();
  });

  it('citation references OECD MTC', () => {
    expect(STRATEGY.citation.source).toMatch(/OECD/);
    expect(STRATEGY.citation.url).toMatch(/oecd\.org/);
  });

  it('confidence below 0.75 (heuristic until foreignTaxPaid provided)', () => {
    const baseline = calculateTax(SALARY);
    const result = STRATEGY.evaluate(SALARY, baseline);
    expect(result.confidence).toBeLessThan(0.75);
  });
});
