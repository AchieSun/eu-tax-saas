/**
 * NL Box 1 / Box 2 / Box 3 unit tests.
 * Reference: Belastingdienst published rates + PwC NL Tax Summaries.
 */

import { describe, expect, it } from 'vitest';
import { calculateBox1, calculateBox2, calculateBox3 } from './calculator';

describe('NL Box 1 2025 (under AOW)', () => {
  it('income €20,000 sits in bracket 1 (35.82%)', () => {
    const r = calculateBox1({
      country: 'NL',
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 20_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    // Gross tax = 20000 * 0.3582 = 7164; minus heffingskorting ≈ 3068 (2025) → ≈ 4096
    expect(r.taxOwed).toBeGreaterThan(3_900);
    expect(r.taxOwed).toBeLessThan(4_300);
    expect(r.marginalRate).toBeCloseTo(0.3582, 4);
  });

  it('income €100,000 hits 49.5% top bracket', () => {
    const r = calculateBox1({
      country: 'NL',
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 100_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    expect(r.marginalRate).toBeCloseTo(0.495, 4);
    expect(r.taxOwed).toBeGreaterThan(38_000);
    expect(r.taxOwed).toBeLessThan(43_000);
  });
});

describe('NL Box 2 substantial interest', () => {
  it('2026 €50,000 stays in bracket 1 (24.5%)', () => {
    const r = calculateBox2({ taxYear: 2026, income: 50_000 });
    expect(r.taxOwed).toBe(12_250);
  });
  it('2026 €100,000 mixes brackets', () => {
    const r = calculateBox2({ taxYear: 2026, income: 100_000 });
    // 68843 * 0.245 + (100000-68843)*0.31 = 16866.535 + 9658.67 = 26525.2
    expect(r.taxOwed).toBeGreaterThan(26_400);
    expect(r.taxOwed).toBeLessThan(26_600);
  });
});

describe('NL Box 3 transitional regime', () => {
  it('2026 net assets below heffingsvrij → 0', () => {
    const r = calculateBox3({ taxYear: 2026, bankBalances: 30_000, otherAssets: 0, debts: 0 });
    expect(r.taxOwed).toBe(0);
  });
  it('2026 net assets above heffingsvrij → positive tax', () => {
    const r = calculateBox3({
      taxYear: 2026,
      bankBalances: 100_000,
      otherAssets: 50_000,
      debts: 10_000,
    });
    expect(r.taxOwed).toBeGreaterThan(0);
    expect(r.provisional).toBe(true);
  });
});
