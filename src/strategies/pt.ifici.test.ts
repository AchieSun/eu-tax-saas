/**
 * F4 — pt.ifici strategy contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { _resetRegistryForTests, registerStrategy } from './index';
import STRATEGY from './pt.ifici';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const HIGH_INCOME: CalculatorInput = {
  country: 'PT',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 80_000,
  specialStatus: 'ifici',
  filingStatus: 'single',
};

describe('pt.ifici', () => {
  it('eligible-with-saving: 80k IFICI 20% beats progressive IRS', () => {
    const baseline = calculateTax({ ...HIGH_INCOME, specialStatus: 'none' });
    const result = STRATEGY.evaluate(HIGH_INCOME, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeGreaterThan(0);
  });

  it('eligible-no-saving: 10k IFICI loses to progressive (low brackets)', () => {
    const lowInput: CalculatorInput = { ...HIGH_INCOME, grossIncome: 10_000 };
    const baseline = calculateTax({ ...lowInput, specialStatus: 'none' });
    const result = STRATEGY.evaluate(lowInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.estimatedSavingsEur).toBe(0);
  });

  it('ineligible-blocker: wrong country (ES) returns applicable=false', () => {
    const esInput: CalculatorInput = { ...HIGH_INCOME, country: 'ES', region: 'MAD' };
    const baseline = calculateTax({ ...esInput, specialStatus: 'none' });
    const result = STRATEGY.evaluate(esInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/葡萄牙/);
  });

  it('missing-data: specialStatus=none rejects with IFICI application reason', () => {
    const noStatus: CalculatorInput = { ...HIGH_INCOME, specialStatus: 'none' };
    const baseline = calculateTax(noStatus);
    const result = STRATEGY.evaluate(noStatus, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/IFICI/);
  });
});
