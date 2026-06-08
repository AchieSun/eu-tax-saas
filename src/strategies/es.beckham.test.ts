/**
 * F4 — es.beckham strategy contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './es.beckham';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const HIGH_INCOME: CalculatorInput = {
  country: 'ES',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 200_000,
  specialStatus: 'beckham',
  filingStatus: 'single',
  region: 'MAD',
};

describe('es.beckham', () => {
  it('eligible-with-saving: 200k Beckham beats progressive IRPF', () => {
    const baseline = calculateTax({ ...HIGH_INCOME, specialStatus: 'none' });
    const result = STRATEGY.evaluate(HIGH_INCOME, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeGreaterThan(0);
    expect(result.confidence).toBe(1);
  });

  it('eligible-no-saving: 20k Beckham loses to progressive IRPF (mínimo personal)', () => {
    const lowInput: CalculatorInput = { ...HIGH_INCOME, grossIncome: 20_000 };
    const baseline = calculateTax({ ...lowInput, specialStatus: 'none' });
    const result = STRATEGY.evaluate(lowInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.estimatedSavingsEur).toBe(0);
  });

  it('ineligible-blocker: wrong country (PT) returns applicable=false', () => {
    const ptInput: CalculatorInput = { ...HIGH_INCOME, country: 'PT', region: undefined };
    const baseline = calculateTax({ ...ptInput, specialStatus: 'none' });
    const result = STRATEGY.evaluate(ptInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/西班牙/);
  });

  it('missing-data: specialStatus=none rejects with clear reason', () => {
    const noStatus: CalculatorInput = { ...HIGH_INCOME, specialStatus: 'none' };
    const baseline = calculateTax(noStatus);
    const result = STRATEGY.evaluate(noStatus, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/Beckham/);
  });
});
