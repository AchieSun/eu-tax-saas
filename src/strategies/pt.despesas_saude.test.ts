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
  it('eligible-with-null-savings: PT returns null and lower confidence (P2#2 anti-hallucination)', () => {
    const baseline = calculateTax(PT_BASE);
    const result = STRATEGY.evaluate(PT_BASE, baseline);
    expect(result.applicable).toBe(true);
    // Oracle Wave A+B P2#2: do NOT default to the €1,000 cap when actual
    // medical-expense data is missing; surface the input gap instead.
    expect(result.estimatedSavingsEur).toBeNull();
    expect(result.confidence).toBe(0.5);
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

  it('reason mentions 15% rate and €6,667 cap-spend threshold', () => {
    const baseline = calculateTax(PT_BASE);
    const result = STRATEGY.evaluate(PT_BASE, baseline);
    expect(result.reason).toMatch(/15%/);
    expect(result.reason).toMatch(/6,667/);
    expect(result.reason).toMatch(/未估算/);
  });
});
