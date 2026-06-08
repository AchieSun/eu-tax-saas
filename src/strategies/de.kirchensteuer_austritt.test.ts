/**
 * F4 — de.kirchensteuer_austritt contract tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput, CalculatorResult } from '../rules/common/types';
import STRATEGY from './de.kirchensteuer_austritt';
import { _resetRegistryForTests, registerStrategy } from './index';

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy(STRATEGY);
});

const DE_BASE: CalculatorInput = {
  country: 'DE',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 60_000,
  specialStatus: 'none',
  filingStatus: 'single',
};

describe('de.kirchensteuer_austritt', () => {
  it('eligible-with-saving: DE 60k returns positive saving at 9%', () => {
    const baseline = calculateTax(DE_BASE);
    const result = STRATEGY.evaluate(DE_BASE, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBeGreaterThan(0);
    expect(result.confidence).toBe(0.95);
    expect(result.reason).toMatch(/9%|其它联邦州/);
  });

  it('BY region: uses 8% rate', () => {
    const baseline = calculateTax(DE_BASE);
    const result = STRATEGY.evaluate({ ...DE_BASE, region: 'BY' }, baseline);
    expect(result.applicable).toBe(true);
    expect(result.reason).toMatch(/8%|巴伐利亚/);
  });

  it('ineligible-blocker: wrong country (NL) returns applicable=false', () => {
    const nlInput: CalculatorInput = { ...DE_BASE, country: 'NL' };
    const baseline = calculateTax(nlInput);
    const result = STRATEGY.evaluate(nlInput, baseline);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/德国/);
  });

  it('eligible-no-saving: zero tax baseline returns applicable=false', () => {
    const real = calculateTax(DE_BASE) as CalculatorResult;
    const baseline: CalculatorResult = {
      ...real,
      taxOwed: 0,
      breakdown: [],
    };
    const result = STRATEGY.evaluate(DE_BASE, baseline);
    expect(result.applicable).toBe(false);
    expect(result.estimatedSavingsEur).toBe(0);
  });

  // ── Oracle P1#6: SolZ-aware Einkommensteuer extraction ─────────────────
  // The old back-out divided baseline.taxOwed by 1.055 unconditionally,
  // which understated Einkommensteuer below the SolZ exemption (and thus
  // understated the church-tax saving). After the fix the strategy reads
  // the breakdown line directly, so the saving should equal exactly
  // `Einkommensteuer × rate`.
  it('P1#6 low-income (€18k): SolZ-exempt → saving uses true Einkommensteuer (no 1.055 divisor)', () => {
    const lowInput: CalculatorInput = { ...DE_BASE, grossIncome: 18_000 };
    // DE-only test — narrow the union to the common CalculatorResult shape.
    const baseline = calculateTax(lowInput) as CalculatorResult;
    // Sanity: at €18k single, SolZ is zero → taxOwed == Einkommensteuer.
    const eLine = baseline.breakdown.find((b) => b.label.startsWith('Einkommensteuer'));
    expect(eLine).toBeDefined();
    expect(baseline.taxOwed).toBe(eLine!.amount);
    const result = STRATEGY.evaluate(lowInput, baseline);
    expect(result.applicable).toBe(true);
    const expected = Math.round(eLine!.amount * 0.09);
    expect(result.estimatedSavingsEur).toBe(expected);
    // The old buggy estimate would have been Math.round((taxOwed/1.055)*0.09)
    // which differs from `expected` whenever SolZ == 0 (taxOwed/1.055 < taxOwed).
    const oldBuggy = Math.round((baseline.taxOwed / 1.055) * 0.09);
    expect(result.estimatedSavingsEur).toBeGreaterThanOrEqual(oldBuggy);
  });

  it('P1#6 high-income (€80k): SolZ phase-in → saving still uses breakdown Einkommensteuer', () => {
    const highInput: CalculatorInput = { ...DE_BASE, grossIncome: 80_000 };
    const baseline = calculateTax(highInput) as CalculatorResult;
    const eLine = baseline.breakdown.find((b) => b.label.startsWith('Einkommensteuer'));
    expect(eLine).toBeDefined();
    const result = STRATEGY.evaluate(highInput, baseline);
    expect(result.applicable).toBe(true);
    expect(result.estimatedSavingsEur).toBe(Math.round(eLine!.amount * 0.09));
  });
});
