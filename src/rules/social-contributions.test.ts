/**
 * Social-contribution layer tests (added 2026-09).
 *
 * Before this change `netIncome` silently meant "gross minus income tax" for
 * every country, which overstated take-home pay by 6-22 % of gross. These
 * tests pin the employee-side statutory contributions now subtracted, the
 * per-country ceilings, and the two special cases (PT IFICI keeps paying
 * Segurança Social; NL reports 0 because the Dutch employee-side premies sit
 * inside Box 1 tax).
 *
 * Sources are recorded in each calculator; the headline rates are:
 *  - DE 2025/2026: RV 9,3 % + AV 1,3 % (ceiling 101.400 €/2026),
 *    KV 8,75 % + PV 2,4 % childless (ceiling 69.750 €/2026)
 *  - UK 2025-26: Class 1 NI 8 % (£12,570-£50,270) + 2 % above
 *  - ES 2025: 6,48 % of the contribution base, capped at 58.914 €/year
 *  - PT: 11 % of gross, no ceiling
 */

import { describe, expect, it } from 'vitest';
import type { Country } from './common/types';
import { calculateTax } from './index';

function calc(
  country: Country,
  taxYear: number,
  grossIncome: number,
  extra: Record<string, unknown> = {},
) {
  return calculateTax({
    country,
    taxYear,
    incomeType: 'salary',
    grossIncome,
    specialStatus: 'none',
    filingStatus: 'single',
    ...extra,
  }) as { taxOwed: number; socialContributions: number; netIncome: number; effectiveRate: number };
}

describe('invariant: netIncome = gross − income tax − social contributions', () => {
  const cases: Array<[Country, number, number, Record<string, unknown>]> = [
    ['DE', 2026, 80000, {}],
    ['UK', 2025, 60000, { region: 'EWN' }],
    ['ES', 2025, 60000, { region: 'MAD' }],
    ['PT', 2026, 60000, {}],
    ['NL', 2026, 60000, {}],
  ];
  it.each(cases)('%s %i €%i', (country, year, gross, extra) => {
    const r = calc(country, year, gross, extra);
    expect(r.netIncome).toBe(gross - r.taxOwed - r.socialContributions);
  });
});

describe('DE employee social insurance', () => {
  it('2026 at €80,000: KV/PV on the capped base + RV/AV on full gross', () => {
    // KV+PV base 69.750 (ceiling) → 8,75 % + 2,4 %; RV+AV on 80.000 → 9,3 % + 1,3 %
    expect(calc('DE', 2026, 80000).socialContributions).toBe(16257);
  });

  it('2026 both ceilings bind: €150,000 and €300,000 carry the same contributions', () => {
    const at150 = calc('DE', 2026, 150000).socialContributions;
    const at300 = calc('DE', 2026, 300000).socialContributions;
    expect(at150).toBe(18525);
    expect(at300).toBe(at150);
  });

  it('2025 uses the lower ceilings and the 2,5 % average Zusatzbeitrag', () => {
    const r2025 = calc('DE', 2025, 80000).socialContributions;
    const r2026 = calc('DE', 2026, 80000).socialContributions;
    expect(r2025).toBeLessThan(r2026);
  });
});

describe('UK employee National Insurance (Class 1)', () => {
  it('£50,000: 8 % between the primary threshold and the UEL', () => {
    expect(calc('UK', 2025, 50000, { region: 'EWN' }).socialContributions).toBe(2994);
  });

  it('£80,000: 8 % band plus 2 % above the UEL', () => {
    expect(calc('UK', 2025, 80000, { region: 'EWN' }).socialContributions).toBe(3610);
  });

  it('below the primary threshold pays nothing', () => {
    expect(calc('UK', 2025, 12000, { region: 'EWN' }).socialContributions).toBe(0);
  });

  it('the UEL does not cap NI entirely — the 2 % band keeps growing', () => {
    const at100k = calc('UK', 2025, 100000, { region: 'EWN' }).socialContributions;
    const at200k = calc('UK', 2025, 200000, { region: 'EWN' }).socialContributions;
    expect(at200k).toBeGreaterThan(at100k);
  });

  it('FIG relief zeroes income tax but not National Insurance', () => {
    const r = calc('UK', 2025, 80000, { region: 'EWN', specialStatus: 'fig' }) as {
      taxOwed: number;
      socialContributions: number;
      netIncome: number;
    };
    expect(r.taxOwed).toBe(0);
    // FIG is an income-tax relief; the calculator excludes NI from the FIG
    // branch and warns that the social-security position is decided elsewhere.
    expect(r.socialContributions).toBe(0);
    expect(r.netIncome).toBe(80000);
  });
});

describe('ES employee Seguridad Social', () => {
  it('€80,000: 6,48 % of the maximum contribution base (58.914 €/year)', () => {
    expect(calc('ES', 2025, 80000, { region: 'MAD' }).socialContributions).toBe(3817);
  });

  it('the base is capped: €150,000 pays the same as €80,000', () => {
    const at80 = calc('ES', 2025, 80000, { region: 'MAD' }).socialContributions;
    const at150 = calc('ES', 2025, 150000, { region: 'MAD' }).socialContributions;
    expect(at150).toBe(at80);
  });

  it('the Beckham regime does not reduce social security', () => {
    const standard = calc('ES', 2025, 80000, { region: 'MAD' });
    const beckham = calc('ES', 2025, 80000, { region: 'MAD', specialStatus: 'beckham' });
    expect(beckham.socialContributions).toBe(standard.socialContributions);
    expect(beckham.taxOwed).toBeLessThan(standard.taxOwed);
  });
});

describe('PT employee Segurança Social', () => {
  it('11 % of gross, no ceiling', () => {
    expect(calc('PT', 2026, 80000).socialContributions).toBe(8800);
    expect(calc('PT', 2026, 30000).socialContributions).toBe(3300);
  });

  it('IFICI changes income tax only — social security still applies', () => {
    const standard = calc('PT', 2026, 80000);
    const ifici = calc('PT', 2026, 80000, { specialStatus: 'ifici' });
    expect(ifici.socialContributions).toBe(8800);
    expect(ifici.taxOwed).toBe(16000);
    expect(ifici.netIncome).toBe(55200);
    expect(standard.socialContributions).toBe(ifici.socialContributions);
  });
});

describe('NL: no separate employee social contributions', () => {
  it('reports 0 — the premies volksverzekeringen are inside Box 1 tax', () => {
    const r = calc('NL', 2026, 80000);
    expect(r.socialContributions).toBe(0);
    expect(r.netIncome).toBe(80000 - r.taxOwed);
  });
});
