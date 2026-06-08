/**
 * F4 — es.deduccion_arrendamiento (Madrid rental deduction) contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './es.deduccion_arrendamiento';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const MAD_YOUNG: CalculatorInput = {
  country: 'ES',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 22_000,
  specialStatus: 'none',
  filingStatus: 'single',
  region: 'MAD',
  age: 28,
};

describe('es.deduccion_arrendamiento', () => {
  it('eligible-with-saving (informational): under 35 + Madrid + low income', () => {
    const baseline = calculateTax(MAD_YOUNG);
    const result = STRATEGY.evaluate(MAD_YOUNG, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeNull();
    expect(result.confidence).toBe(0.85);
    expect(result.reason).toMatch(/rentPaidEur/);
  });

  it('eligible-no-saving: age too high → ineligible', () => {
    const old: CalculatorInput = { ...MAD_YOUNG, age: 40 };
    const baseline = calculateTax(old);
    const result = STRATEGY.evaluate(old, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/< 35/);
  });

  it('ineligible-blocker: wrong region (CAT instead of MAD)', () => {
    const cat: CalculatorInput = { ...MAD_YOUNG, region: 'CAT' };
    const baseline = calculateTax(cat);
    const result = STRATEGY.evaluate(cat, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/马德里/);
  });

  it('missing-data: age undefined → not eligible with explanation', () => {
    const noAge: CalculatorInput = { ...MAD_YOUNG, age: undefined };
    const baseline = calculateTax(noAge);
    const result = STRATEGY.evaluate(noAge, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/年龄/);
    expect(result.confidence).toBe(0.9);
  });
});
