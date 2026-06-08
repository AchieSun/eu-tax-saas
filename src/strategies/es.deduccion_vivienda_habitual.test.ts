/**
 * F4 — es.deduccion_vivienda_habitual contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import STRATEGY from './es.deduccion_vivienda_habitual';
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

describe('es.deduccion_vivienda_habitual', () => {
  it('eligible-no-data: ES returns applicable=true with null saving', () => {
    const baseline = calculateTax(ES_BASE);
    const result = STRATEGY.evaluate(ES_BASE, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeNull();
    expect(result.reason).toMatch(/2013|按揭|1,356/);
  });

  it('ineligible-blocker: wrong country (PT) returns applicable=false', () => {
    const ptInput: CalculatorInput = { ...ES_BASE, country: 'PT', region: undefined };
    const baseline = calculateTax(ptInput);
    const result = STRATEGY.evaluate(ptInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/西班牙/);
  });

  it('citation references BOE Ley 35/2006', () => {
    expect(STRATEGY.citation.source).toMatch(/LIRPF|Ley 35\/2006/);
    expect(STRATEGY.citation.url).toMatch(/boe\.es/);
  });

  it('confidence is 0.7 (legacy regime, needs purchase date)', () => {
    const baseline = calculateTax(ES_BASE);
    const result = STRATEGY.evaluate(ES_BASE, baseline);
    expect(result.confidence).toBe(0.7);
  });
});
