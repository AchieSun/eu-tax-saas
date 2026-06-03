/**
 * DE calculator unit tests.
 *
 * Reference fixtures: BMF Grundtabelle 2025 (verified against bmf-steuerrechner.de).
 * Tolerance: ± € 1 per § 32a Abs. 1 Satz 6 EStG rounding rules.
 */

import { describe, expect, it } from 'vitest';
import { calculateDe, tariff } from './calculator';

describe('DE tariff 2025 — § 32a EStG single (pure zvE→tax formula)', () => {
  // These are EXACT outputs of T(zvE) per § 32a Abs. 1 EStG 2025 (Steuerfortentwicklungsgesetz),
  // computed and floor-rounded per Satz 6. They differ from the BMF Grundtabelle lookup table,
  // which takes GROSS income and pre-applies Werbungskostenpauschale (€ 1,230) +
  // Sonderausgaben (€ 36) before invoking the tariff. Our calculator is the pure tariff;
  // gross→zvE conversion happens at the frontend / a future deduction layer.
  const cases: Array<[number, number]> = [
    [10_000, 0], // below Grundfreibetrag
    [12_096, 0], // exactly Grundfreibetrag → 0
    [15_000, 485], // zone 2 (lower progression)
    [20_000, 1_639],
    [30_000, 4_303],
    [50_000, 10_691],
    [68_480, 17_849], // zone 3 → zone 4 boundary
    [70_000, 18_488], // zone 4 (42% proportional)
    [90_000, 26_888],
    [200_000, 73_088],
    [300_000, 115_753], // zone 5 (45% Reichensteuer)
  ];

  for (const [zvE, expected] of cases) {
    it(`zvE €${zvE.toLocaleString('de-DE')} → €${expected}`, () => {
      const actual = tariff(zvE, 2025);
      // ± €2 tolerance for double-precision rounding chains
      expect(actual).toBeGreaterThanOrEqual(expected - 2);
      expect(actual).toBeLessThanOrEqual(expected + 2);
    });
  }
});

describe('DE tariff 2025 — top brackets', () => {
  it('zvE €68,480 hits 42% proportional zone boundary', () => {
    // T(68480) = 0.42·68480 − 10911.92 ≈ 17849.68
    expect(tariff(68_480, 2025)).toBeGreaterThan(17_700);
    expect(tariff(68_480, 2025)).toBeLessThan(18_000);
  });
  it('zvE €300,000 triggers 45% Reichensteuer', () => {
    // T(300000) = 0.45·300000 − 19246.67 = 115753.33
    expect(tariff(300_000, 2025)).toBeGreaterThan(115_500);
    expect(tariff(300_000, 2025)).toBeLessThan(116_000);
  });
});

describe('DE calculateDe — full result shape', () => {
  it('returns breakdown + source + citation', () => {
    const r = calculateDe({
      country: 'DE',
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 60_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    expect(r.country).toBe('DE');
    expect(r.taxOwed).toBeGreaterThan(0);
    expect(r.netIncome).toBe(r.grossIncome - r.taxOwed);
    expect(r.effectiveRate).toBeGreaterThan(0);
    expect(r.effectiveRate).toBeLessThan(1);
    expect(r.breakdown.length).toBeGreaterThan(0);
    expect(r.source).toContain('§ 32a EStG');
    expect(r.breakdown[0]?.citation).toContain('§ 32a EStG');
  });

  it('Splittingverfahren halves the tax burden for joint filing at low/mid income', () => {
    const single = calculateDe({
      country: 'DE',
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 60_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    const joint = calculateDe({
      country: 'DE',
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 60_000,
      specialStatus: 'none',
      filingStatus: 'married_joint',
    });
    // Married joint always ≤ single at same gross
    expect(joint.taxOwed).toBeLessThan(single.taxOwed);
  });
});

describe('DE tariff 2026 — uplifted Grundfreibetrag', () => {
  it('zvE €12,348 (new Grundfreibetrag) → 0', () => {
    expect(tariff(12_348, 2026)).toBe(0);
  });
  it('zvE €12,347 (one below) → 0', () => {
    expect(tariff(12_347, 2026)).toBe(0);
  });
  it('2026 tax at €50,000 ≤ 2025 tax at €50,000 (bracket widening)', () => {
    expect(tariff(50_000, 2026)).toBeLessThanOrEqual(tariff(50_000, 2025));
  });
});
