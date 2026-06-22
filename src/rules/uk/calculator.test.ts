import { describe, expect, it } from 'vitest';
import { calculateUk, srtTest } from './calculator';

describe('UK Income Tax 2025-26', () => {
  const base = (overrides: Record<string, unknown> = {}) => ({
    country: 'UK' as const,
    taxYear: 2025,
    incomeType: 'salary' as const,
    grossIncome: 30000,
    filingStatus: 'single' as const,
    specialStatus: 'none' as const,
    region: 'EWN',
    ...overrides,
  });

  it('£0 → £0 tax', () => {
    expect(calculateUk(base({ grossIncome: 0 })).totalTax).toBe(0);
  });

  it('£30,000 EWN → £3,486', () => {
    // (30000 - 12570) × 20% = 17430 × 0.20 = £3,486
    expect(calculateUk(base({ grossIncome: 30000 })).totalTax).toBe(3486);
  });

  it('£150,000 EWN → £53,703 (PA fully tapered)', () => {
    // PA = 0; Tax = 37700×0.20 + (125140-37700)×0.40 + (150000-125140)×0.45
    //    = 7540 + 34976 + 11187 = 53703
    expect(calculateUk(base({ grossIncome: 150000 })).totalTax).toBe(53703);
  });

  it('£150,000 SCOT > £150,000 EWN (Scotland is higher)', () => {
    const ewn = calculateUk(base({ grossIncome: 150000, region: 'EWN' }));
    const scot = calculateUk(base({ grossIncome: 150000, region: 'SCOT' }));
    expect(scot.totalTax).toBeGreaterThan(ewn.totalTax);
  });

  it('PA taper boundary: £100,000 retains full PA', () => {
    const r = calculateUk(base({ grossIncome: 100000 }));
    expect(r.breakdown.personalAllowance).toBe(12570);
  });

  it('PA at £125,140 is fully withdrawn', () => {
    const r = calculateUk(base({ grossIncome: 125140 }));
    expect(r.breakdown.personalAllowance).toBe(0);
  });

  it('FIG status returns 0 tax with warning', () => {
    const r = calculateUk(base({ grossIncome: 200000, specialStatus: 'fig' }));
    expect(r.totalTax).toBe(0);
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it('Unknown region throws', () => {
    expect(() => calculateUk(base({ region: 'XYZ' }))).toThrow(/EWN|SCOT/);
  });
});

describe('UK SRT', () => {
  const srtBase = (overrides: Record<string, unknown> = {}) => ({
    daysInUk: 100,
    wasResidentInAnyOfPrior3Years: false,
    ties: 0,
    fullTimeWorkOverseas: false,
    daysWorkingInUk: 0,
    hasUkHome91Days: false,
    presentInUkHome30Days: false,
    noOverseasHomeOrLittlePresent: false,
    fullTimeUkWork365: false,
    ...overrides,
  });

  it('183+ days → auto UK resident', () => {
    const r = srtTest(srtBase({ daysInUk: 183 }));
    expect(r.resident).toBe(true);
    expect(r.reason).toBe('auto-uk-1');
  });

  it('arriver with <16 days → NOT auto-overseas-1 (arriver uses <46)', () => {
    const r = srtTest(srtBase({ daysInUk: 10, wasResidentInAnyOfPrior3Years: false }));
    expect(r.resident).toBe(false);
    expect(r.reason).toBe('auto-overseas-2');
  });

  it('leaver with <16 days → auto-overseas-1', () => {
    const r = srtTest(srtBase({ daysInUk: 10, wasResidentInAnyOfPrior3Years: true }));
    expect(r.resident).toBe(false);
    expect(r.reason).toBe('auto-overseas-1');
  });

  it('arriver with 4 ties × 46-90 days → resident', () => {
    const r = srtTest(srtBase({ daysInUk: 60, ties: 4, wasResidentInAnyOfPrior3Years: false }));
    expect(r.resident).toBe(true);
    expect(r.reason).toBe('sufficient-ties-met');
  });

  it('leaver with 1 tie × 46-90 days → NOT resident', () => {
    const r = srtTest(srtBase({ daysInUk: 60, ties: 1, wasResidentInAnyOfPrior3Years: true }));
    expect(r.resident).toBe(false);
    expect(r.reason).toBe('sufficient-ties-not-met');
  });
});
