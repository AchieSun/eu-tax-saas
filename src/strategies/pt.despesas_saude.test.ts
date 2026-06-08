/**
 * F4 — pt.despesas_saude contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { _resetRegistryForTests, registerStrategy } from './index';
import STRATEGY from './pt.despesas_saude';

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

describe('pt.despesas_saude', () => {
  it('eligible-with-cap: PT returns max cap 1000 EUR', () => {
    const baseline = calculateTax(PT_BASE);
    const result = STRATEGY.evaluate(PT_BASE, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBe(1000);
    expect(result.confidence).toBe(0.7);
  });

  it('ineligible-blocker: wrong country (DE) returns applicable=false', () => {
    const deInput: CalculatorInput = { ...PT_BASE, country: 'DE' };
    const baseline = calculateTax(deInput);
    const result = STRATEGY.evaluate(deInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/葡萄牙/);
  });

  it('citation references art. 78.º-C CIRS', () => {
    expect(STRATEGY.citation.source).toMatch(/78.º-C|CIRS/);
    expect(STRATEGY.citation.url).toMatch(/portaldasfinancas/);
  });

  it('reason mentions 15% and €1,000 cap', () => {
    const baseline = calculateTax(PT_BASE);
    const result = STRATEGY.evaluate(PT_BASE, baseline);
    expect(result.reason).toMatch(/1000|1,000|6,667/);
  });
});
