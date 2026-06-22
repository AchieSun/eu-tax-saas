/**
 * PT IRS unit tests.
 * Reference: PwC Guia Fiscal 2025 (post Lei 55-A/2025) + art. 68.º CIRS.
 */

import { describe, expect, it } from 'vitest';
import { calculatePt } from './calculator';

describe('PT IRS 2025 — Continente (post Lei 55-A/2025)', () => {
  it('€8,000 sits in bracket 1 (12.5%, no parcela)', () => {
    const r = calculatePt({
      country: 'PT',
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 8_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    // 8000 * 0.125 = 1000
    expect(r.taxOwed).toBe(1_000);
    expect(r.marginalRate).toBeCloseTo(0.125, 4);
  });

  it('€30,000 sits in 6th bracket (34.9%)', () => {
    const r = calculatePt({
      country: 'PT',
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 30_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    // 30000 * 0.349 - 4006.10 = 10470 - 4006.10 = 6463.90
    expect(r.taxOwed).toBeGreaterThan(6_400);
    expect(r.taxOwed).toBeLessThan(6_500);
    expect(r.marginalRate).toBeCloseTo(0.349, 4);
  });

  it('€100,000 triggers top bracket + solidariedade 2.5%', () => {
    const r = calculatePt({
      country: 'PT',
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 100_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    // 100000 * 0.48 - 10939.90 = 37060.10 IRS
    // + solidariedade: (100000 - 80000) * 0.025 = 500
    // total ≈ 37560
    expect(r.taxOwed).toBeGreaterThan(37_400);
    expect(r.taxOwed).toBeLessThan(37_700);
    expect(r.breakdown.some((b: { label: string }) => b.label.includes('solidariedade'))).toBe(
      true,
    );
  });
});

describe('PT IFICI flat 20%', () => {
  it('applies 20% flat regardless of bracket', () => {
    const r = calculatePt({
      country: 'PT',
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 100_000,
      specialStatus: 'ifici',
      filingStatus: 'single',
    });
    expect(r.taxOwed).toBe(20_000);
    expect(r.effectiveRate).toBeCloseTo(0.2, 4);
    expect(r.source).toContain('IFICI');
  });
});

describe('PT IRS 2026 — Continente (Lei 73-A/2025)', () => {
  it('marked provisional pending AT folheto', () => {
    const r = calculatePt({
      country: 'PT',
      taxYear: 2026,
      incomeType: 'salary',
      grossIncome: 50_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    expect(r.provisional).toBe(true);
    expect(r.taxOwed).toBeGreaterThan(0);
  });
});
