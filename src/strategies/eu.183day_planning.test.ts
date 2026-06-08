/**
 * F4 — eu.183day_planning contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './eu.183day_planning';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const ES_BASE: CalculatorInput = {
  country: 'ES',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 60_000,
  specialStatus: 'none',
  filingStatus: 'single',
  region: 'MAD',
};

describe('eu.183day_planning', () => {
  it('eligible-no-data: ES returns informational applicable=true', () => {
    const baseline = calculateTax(ES_BASE);
    const result = STRATEGY.evaluate(ES_BASE, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeNull();
    expect(result.reason).toMatch(/183/);
  });

  it('UK branch: mentions SRT explicitly', () => {
    const ukInput: CalculatorInput = { ...ES_BASE, country: 'UK', region: undefined };
    const baseline = calculateTax(ukInput);
    const result = STRATEGY.evaluate(ukInput, baseline);
    expect(result.applicable).toBe(true);
    expect(result.reason).toMatch(/SRT/);
  });

  it('citation references HMRC SRT', () => {
    expect(STRATEGY.citation.url).toMatch(/gov\.uk/);
  });

  it('confidence is 0.5 (depends on external F2 module)', () => {
    const baseline = calculateTax(ES_BASE);
    const result = STRATEGY.evaluate(ES_BASE, baseline);
    expect(result.confidence).toBe(0.5);
  });
});
