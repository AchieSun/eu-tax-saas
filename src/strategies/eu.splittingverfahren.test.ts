/**
 * F4 — eu.splittingverfahren (DE married joint filing) strategy contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './eu.splittingverfahren';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const DE_SEPARATE: CalculatorInput = {
  country: 'DE',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 100_000,
  specialStatus: 'none',
  filingStatus: 'married_separate',
};

describe('eu.splittingverfahren', () => {
  it('eligible-with-saving: 100k married_separate → splitting saves money', () => {
    const baseline = calculateTax(DE_SEPARATE);
    const result = STRATEGY.evaluate(DE_SEPARATE, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeGreaterThan(0);
    expect(result.confidence).toBe(0.8);
  });

  it('eligible-no-saving: already filing married_joint → already applied', () => {
    const joint: CalculatorInput = { ...DE_SEPARATE, filingStatus: 'married_joint' };
    const baseline = calculateTax(joint);
    const result = STRATEGY.evaluate(joint, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/已选择合并申报/);
  });

  it('ineligible-blocker: wrong country (UK) returns applicable=false', () => {
    const uk: CalculatorInput = { ...DE_SEPARATE, country: 'UK', region: 'EWN' };
    const baseline = calculateTax(uk);
    const result = STRATEGY.evaluate(uk, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/德国/);
  });

  it('missing-data: single filing status → not eligible (no marriage)', () => {
    const single: CalculatorInput = { ...DE_SEPARATE, filingStatus: 'single' };
    const baseline = calculateTax(single);
    const result = STRATEGY.evaluate(single, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/单身/);
  });
});
