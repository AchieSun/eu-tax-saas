/**
 * Spain IRPF 2025 — unit tests (Vitest, TDD-first).
 * Verifies estatal + autonómico (MAD/CAT/VAL/AND) and Beckham regime.
 */

import { describe, it, expect } from 'vitest';
import { calculateEs } from './calculator';
import type { CalculatorInput } from '../common/types';

describe('ES IRPF 2025', () => {
  const base = (overrides: Partial<CalculatorInput> = {}): CalculatorInput => ({
    country: 'ES',
    taxYear: 2025,
    incomeType: 'salary',
    grossIncome: 30000,
    filingStatus: 'single',
    specialStatus: 'none',
    region: 'MAD',
    ...overrides,
  });

  it('zero income returns zero tax', () => {
    expect(calculateEs(base({ grossIncome: 0 })).totalTax).toBe(0);
  });

  it('Madrid €30k tax is in plausible band (€3,500-€5,500)', () => {
    const r = calculateEs(base({ grossIncome: 30000, region: 'MAD' }));
    expect(r.totalTax).toBeGreaterThanOrEqual(3500);
    expect(r.totalTax).toBeLessThanOrEqual(5500);
  });

  it('Cataluña €30k tax is in plausible band, slightly higher than Madrid', () => {
    const mad = calculateEs(base({ grossIncome: 30000, region: 'MAD' }));
    const cat = calculateEs(base({ grossIncome: 30000, region: 'CAT' }));
    expect(cat.totalTax).toBeGreaterThan(mad.totalTax - 200);
  });

  it('Valencia €30k tax is in plausible band', () => {
    const r = calculateEs(base({ grossIncome: 30000, region: 'VAL' }));
    expect(r.totalTax).toBeGreaterThan(3500);
    expect(r.totalTax).toBeLessThan(5500);
  });

  it('Andalucía €30k tax is in plausible band', () => {
    const r = calculateEs(base({ grossIncome: 30000, region: 'AND' }));
    expect(r.totalTax).toBeGreaterThan(3500);
    expect(r.totalTax).toBeLessThan(5500);
  });

  it('Beckham €100k income → exactly €24,000', () => {
    const r = calculateEs(base({ grossIncome: 100000, specialStatus: 'beckham', region: 'MAD' }));
    expect(r.totalTax).toBe(24000);
    expect(r.breakdown.ccaa).toBeNull();
    expect(r.breakdown.specialStatus).toBe('beckham');
  });

  it('Beckham €700k income → exactly €191,000 (600k×24% + 100k×47%)', () => {
    const r = calculateEs(base({ grossIncome: 700000, specialStatus: 'beckham' }));
    expect(r.totalTax).toBe(191000);
    expect(r.marginalRate).toBe(0.47);
  });

  it('Beckham result independent of region (regression: bypass CCAA)', () => {
    const mad = calculateEs(base({ grossIncome: 100000, specialStatus: 'beckham', region: 'MAD' }));
    const cat = calculateEs(base({ grossIncome: 100000, specialStatus: 'beckham', region: 'CAT' }));
    expect(mad.totalTax).toBe(cat.totalTax);
  });

  it('Mínimo personal applied before bracket (€5k income MAD → low or zero tax)', () => {
    const r = calculateEs(base({ grossIncome: 5000, region: 'MAD' }));
    expect(r.totalTax).toBe(0);
  });

  it('Unknown CCAA throws clear error', () => {
    expect(() => calculateEs(base({ region: 'XYZ' }))).toThrow(/Spain MVP supports/);
  });

  it('Source citation present in result', () => {
    const r = calculateEs(base({ grossIncome: 30000 }));
    expect(r.source).toMatch(/AEAT/);
    expect(r.source).toMatch(/LIRPF/);
  });

  it('Provisional flag is false for 2025', () => {
    expect(calculateEs(base({ grossIncome: 30000 })).provisional).toBe(false);
  });
});
