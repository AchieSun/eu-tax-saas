/**
 * Cross-country compare smoke test.
 */

import { describe, expect, it } from 'vitest';
import { calculateTax, compareCountries, compareCountriesDetailed } from '.';

describe('calculateTax dispatcher', () => {
  it('routes DE input to DE calculator', () => {
    const r = calculateTax({
      country: 'DE',
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 60_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    expect(r.country).toBe('DE');
  });

  it('validates input via Zod', () => {
    expect(() =>
      calculateTax({
        country: 'DE',
        taxYear: 2025,
        incomeType: 'salary',
        grossIncome: -1, // invalid
        filingStatus: 'single',
      }),
    ).toThrow();
  });
});

describe('compareCountries', () => {
  it('returns 5 implemented results (DE/NL/PT/ES/UK)', () => {
    const results = compareCountries({
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 50_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.country).sort()).toEqual(['DE', 'ES', 'NL', 'PT', 'UK']);
  });
});

describe('Dispatcher — ES + UK (W2)', () => {
  const baseInput = {
    taxYear: 2025,
    incomeType: 'salary' as const,
    grossIncome: 30000,
    filingStatus: 'single' as const,
    specialStatus: 'none' as const,
  };

  it('dispatches ES correctly', () => {
    const r = calculateTax({ ...baseInput, country: 'ES', region: 'MAD' } as any);
    expect((r as any).country).toBe('ES');
    expect((r as any).totalTax ?? (r as any).taxOwed).toBeGreaterThan(0);
  });

  it('dispatches UK correctly', () => {
    const r = calculateTax({ ...baseInput, country: 'UK', region: 'EWN' } as any);
    expect((r as any).country).toBe('UK');
    expect((r as any).totalTax ?? (r as any).taxOwed).toBeGreaterThan(0);
  });

  it('compareCountries returns 5 entries', () => {
    const results = compareCountries({ ...baseInput });
    expect(results.length).toBe(5);
    const countries = results.map((r: any) => r.country).sort();
    expect(countries).toEqual(['DE', 'ES', 'NL', 'PT', 'UK']);
  });
});

describe('compareCountries — apples-to-apples (Oracle W2 P1#1)', () => {
  it('forces specialStatus to "none" regardless of input — UK does NOT show £0 FIG relief', () => {
    // If the function honored specialStatus='fig' for UK, totalTax would be 0,
    // making UK look impossibly cheap vs DE/NL/PT/ES (apples-to-oranges bug).
    const results = compareCountries({
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 60_000,
      specialStatus: 'fig' as const,
      filingStatus: 'single',
    });
    const uk = results.find((r: any) => r.country === 'UK') as any;
    expect(uk).toBeDefined();
    expect(uk.totalTax ?? uk.taxOwed).toBeGreaterThan(5_000); // real UK tax on £60k, not 0
  });

  it('forces specialStatus to "none" — ES does NOT use Beckham flat', () => {
    const results = compareCountries({
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 100_000,
      specialStatus: 'beckham' as const,
      filingStatus: 'single',
    });
    const es = results.find((r: any) => r.country === 'ES') as any;
    expect(es).toBeDefined();
    expect(es.totalTax ?? es.taxOwed).not.toBe(24_000); // Beckham would be exactly 24k
  });
});

describe('compareCountriesDetailed — surfaces errors instead of swallowing (Oracle W2 P1#6)', () => {
  it('returns one entry per country with ok=true', () => {
    const entries = compareCountriesDetailed({
      taxYear: 2025,
      incomeType: 'salary',
      grossIncome: 60_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    expect(entries.length).toBe(5);
    expect(entries.every((e) => e.ok)).toBe(true);
    expect(entries.map((e) => e.country).sort()).toEqual(['DE', 'ES', 'NL', 'PT', 'UK']);
  });

  it('surfaces per-country error rather than silently dropping', () => {
    // Force an error by passing a tax year that one calculator rejects (e.g. ES only supports 2025)
    const entries = compareCountriesDetailed({
      taxYear: 1999 as any,
      incomeType: 'salary',
      grossIncome: 60_000,
      specialStatus: 'none',
      filingStatus: 'single',
    });
    expect(entries.length).toBe(5); // all 5 still present
    expect(entries.every((e) => !e.ok)).toBe(true);
    const esEntry = entries.find((e) => e.country === 'ES') as any;
    expect(esEntry.error).toBeTruthy(); // explicit error message present
  });
});
