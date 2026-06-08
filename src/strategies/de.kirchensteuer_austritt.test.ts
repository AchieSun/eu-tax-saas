/**
 * F4 — de.kirchensteuer_austritt contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './de.kirchensteuer_austritt';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const DE_BASE: CalculatorInput = {
  country: 'DE',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 60_000,
  specialStatus: 'none',
  filingStatus: 'single',
};

describe('de.kirchensteuer_austritt', () => {
  it('eligible-with-saving: DE 60k returns positive saving at 9%', () => {
    const baseline = calculateTax(DE_BASE);
    const result = STRATEGY.evaluate(DE_BASE, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeGreaterThan(0);
    expect(result.confidence).toBe(0.95);
    expect(result.reason).toMatch(/9%|其它联邦州/);
  });

  it('BY region: uses 8% rate', () => {
    const baseline = calculateTax(DE_BASE);
    const result = STRATEGY.evaluate({ ...DE_BASE, region: 'BY' }, baseline);
    expect(result.applicable).toBe(true);
    expect(result.reason).toMatch(/8%|巴伐利亚/);
  });

  it('ineligible-blocker: wrong country (NL) returns applicable=false', () => {
    const nlInput: CalculatorInput = { ...DE_BASE, country: 'NL' };
    const baseline = calculateTax(nlInput);
    const result = STRATEGY.evaluate(nlInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/德国/);
  });

  it('eligible-no-saving: zero tax baseline returns applicable=false', () => {
    const baseline = { ...calculateTax(DE_BASE), taxOwed: 0 };
    const result = STRATEGY.evaluate(DE_BASE, baseline);
    expect(result.applicable).toBe(false);
    expect(result.estimatedSavingsEur).toBe(0);
  });
});
