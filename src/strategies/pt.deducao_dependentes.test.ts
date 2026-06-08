/**
 * F4 — pt.deducao_dependentes contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { _resetRegistryForTests, registerStrategy } from './index';
import STRATEGY from './pt.deducao_dependentes';

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

describe('pt.deducao_dependentes', () => {
  it('eligible-no-data: PT returns applicable=true with null saving', () => {
    const baseline = calculateTax(PT_BASE);
    const result = STRATEGY.evaluate(PT_BASE, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeNull();
    expect(result.reason).toMatch(/子女|600/);
  });

  it('ineligible-blocker: wrong country (ES) returns applicable=false', () => {
    const esInput: CalculatorInput = { ...PT_BASE, country: 'ES', region: 'MAD' };
    const baseline = calculateTax(esInput);
    const result = STRATEGY.evaluate(esInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/葡萄牙/);
  });

  it('citation references art. 78.º-A CIRS', () => {
    expect(STRATEGY.citation.source).toMatch(/78.º-A|CIRS/);
    expect(STRATEGY.citation.url).toMatch(/portaldasfinancas/);
  });

  it('confidence is 0.7 (needs dependent count + ages)', () => {
    const baseline = calculateTax(PT_BASE);
    const result = STRATEGY.evaluate(PT_BASE, baseline);
    expect(result.confidence).toBe(0.7);
  });
});
