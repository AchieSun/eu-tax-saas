/**
 * F4 — pt.pension_ppr contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { _resetRegistryForTests, registerStrategy } from './index';
import STRATEGY from './pt.pension_ppr';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const PT_BASE: CalculatorInput = {
  country: 'PT',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 40_000,
  specialStatus: 'none',
  filingStatus: 'single',
};

describe('pt.pension_ppr', () => {
  it('eligible-young: age 30 returns max credit 400 EUR', () => {
    const baseline = calculateTax(PT_BASE);
    const result = STRATEGY.evaluate({ ...PT_BASE, age: 30 }, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBe(400);
    expect(result.confidence).toBe(0.75);
  });

  it('eligible-mid: age 40 returns max credit 350 EUR', () => {
    const baseline = calculateTax(PT_BASE);
    const result = STRATEGY.evaluate({ ...PT_BASE, age: 40 }, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBe(350);
  });

  it('eligible-senior: age 60 returns max credit 300 EUR', () => {
    const baseline = calculateTax(PT_BASE);
    const result = STRATEGY.evaluate({ ...PT_BASE, age: 60 }, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBe(300);
  });

  it('ineligible-blocker: wrong country (ES) returns applicable=false', () => {
    const esInput: CalculatorInput = { ...PT_BASE, country: 'ES', region: 'MAD' };
    const baseline = calculateTax(esInput);
    const result = STRATEGY.evaluate(esInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/葡萄牙/);
  });
});
