/**
 * F4 — pt.jovem (IRS Jovem) strategy contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { _resetRegistryForTests, registerStrategy } from './index';
import STRATEGY from './pt.jovem';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const PT_YOUNG: CalculatorInput = {
  country: 'PT',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 30_000,
  specialStatus: 'none',
  filingStatus: 'single',
  age: 25,
};

describe('pt.jovem', () => {
  it('eligible-with-saving: 25-year-old with 30k salary saves substantially', () => {
    const baseline = calculateTax(PT_YOUNG);
    const result = STRATEGY.evaluate(PT_YOUNG, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeGreaterThan(0);
    expect(result.confidence).toBe(0.8);
  });

  it('eligible-no-saving: zero income → zero baseline tax → no saving', () => {
    const tiny: CalculatorInput = { ...PT_YOUNG, grossIncome: 0 };
    const baseline = calculateTax(tiny);
    const result = STRATEGY.evaluate(tiny, baseline);
    expect(result.applicable).toBe(false);
    expect(result.estimatedSavingsEur).toBe(0);
  });

  it('ineligible-blocker: age 40 > max 35 returns applicable=false', () => {
    const old: CalculatorInput = { ...PT_YOUNG, age: 40 };
    const baseline = calculateTax(old);
    const result = STRATEGY.evaluate(old, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/18-35/);
  });

  it('missing-data: age undefined → not eligible with prompt for age', () => {
    const noAge: CalculatorInput = { ...PT_YOUNG, age: undefined };
    const baseline = calculateTax(noAge);
    const result = STRATEGY.evaluate(noAge, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/年龄/);
    expect(result.confidence).toBe(0.9);
  });
});
