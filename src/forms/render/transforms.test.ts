/**
 * transforms.test.ts — Tests for the pure transform dispatcher used by
 * the pdf-fill render core. Covers every variant of `TransformSchema`
 * declared in ../types.ts.
 */

import { describe, expect, it } from 'vitest';
import { type SourceValue, type TransformId, applyTransform } from './transforms';

// Every variant in TransformSchema. Kept here as a literal tuple so the
// "null/undefined → ''" loop test naturally fails if the enum grows.
const ALL_TRANSFORMS: TransformId[] = [
  'none',
  'floor',
  'round',
  'format-currency-eur',
  'format-currency-no-symbol',
  'format-date-iso',
  'format-date-de',
  'boolean-x',
];

describe('applyTransform — none', () => {
  it('stringifies number / string / boolean / Date as expected', () => {
    expect(applyTransform(42, 'none')).toBe('42');
    expect(applyTransform('Müller', 'none')).toBe('Müller');
    expect(applyTransform(true, 'none')).toBe('true');
    expect(applyTransform(false, 'none')).toBe('false');
    const d = new Date(Date.UTC(2024, 5, 3, 10, 0, 0));
    expect(applyTransform(d, 'none')).toBe(d.toISOString());
  });
});

describe('applyTransform — boolean-x', () => {
  it('true → "X", false → ""', () => {
    expect(applyTransform(true, 'boolean-x')).toBe('X');
    expect(applyTransform(false, 'boolean-x')).toBe('');
  });

  it('null / undefined → ""', () => {
    expect(applyTransform(null, 'boolean-x')).toBe('');
    expect(applyTransform(undefined, 'boolean-x')).toBe('');
  });

  it('throws TypeError on non-boolean input', () => {
    expect(() => applyTransform('yes', 'boolean-x')).toThrow(TypeError);
    expect(() => applyTransform(1, 'boolean-x')).toThrow(TypeError);
  });
});

describe('applyTransform — format-date-de', () => {
  it('formats a Date as DD.MM.YYYY with zero padding', () => {
    // UTC midnight → no off-by-one timezone bug regardless of host TZ.
    const d = new Date(Date.UTC(2024, 5, 3)); // 2024-06-03
    expect(applyTransform(d, 'format-date-de')).toBe('03.06.2024');
  });

  it('accepts an ISO 8601 string as input', () => {
    expect(applyTransform('2024-06-03T00:00:00.000Z', 'format-date-de')).toBe('03.06.2024');
  });

  it('throws TypeError on unparseable string', () => {
    expect(() => applyTransform('not a date', 'format-date-de')).toThrow(TypeError);
  });
});

describe('applyTransform — format-date-iso', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    const d = new Date(Date.UTC(2024, 0, 7));
    expect(applyTransform(d, 'format-date-iso')).toBe('2024-01-07');
  });

  it('accepts an ISO string and normalises to date-only', () => {
    expect(applyTransform('2024-12-15T13:45:00.000Z', 'format-date-iso')).toBe('2024-12-15');
  });
});

describe('applyTransform — format-currency-eur', () => {
  it('uses German thousands separator + comma decimal + € suffix', () => {
    expect(applyTransform(1234.56, 'format-currency-eur')).toBe('1.234,56 €');
    expect(applyTransform(0, 'format-currency-eur')).toBe('0,00 €');
    expect(applyTransform(-5, 'format-currency-eur')).toBe('-5,00 €');
    expect(applyTransform(1_000_000.5, 'format-currency-eur')).toBe('1.000.000,50 €');
  });

  it('throws TypeError on non-numeric input', () => {
    expect(() => applyTransform(true, 'format-currency-eur')).toThrow(TypeError);
    expect(() => applyTransform('abc', 'format-currency-eur')).toThrow(TypeError);
  });
});

describe('applyTransform — format-currency-no-symbol', () => {
  it('formats German decimal style without currency symbol', () => {
    expect(applyTransform(1234.56, 'format-currency-no-symbol')).toBe('1.234,56');
    expect(applyTransform(0, 'format-currency-no-symbol')).toBe('0,00');
    expect(applyTransform(-12345.6, 'format-currency-no-symbol')).toBe('-12.345,60');
  });
});

describe('applyTransform — floor / round', () => {
  it('floor truncates toward -∞ and returns a plain integer string', () => {
    expect(applyTransform(1.9, 'floor')).toBe('1');
    expect(applyTransform(-1.1, 'floor')).toBe('-2');
    expect(applyTransform(0, 'floor')).toBe('0');
  });

  it('round uses half-away-from-zero for positive values', () => {
    expect(applyTransform(1234.7, 'round')).toBe('1235');
    expect(applyTransform(-100, 'round')).toBe('-100');
    expect(applyTransform(0.5, 'round')).toBe('1');
  });

  it('throws TypeError on non-numeric input for numeric transforms', () => {
    expect(() => applyTransform(true, 'floor')).toThrow(TypeError);
    expect(() => applyTransform(new Date(), 'round')).toThrow(TypeError);
  });
});

describe('applyTransform — null / undefined short-circuit', () => {
  it('returns "" for null on every transform variant', () => {
    for (const t of ALL_TRANSFORMS) {
      expect(applyTransform(null, t)).toBe('');
    }
  });

  it('returns "" for undefined on every transform variant', () => {
    for (const t of ALL_TRANSFORMS) {
      expect(applyTransform(undefined, t)).toBe('');
    }
  });
});

describe('applyTransform — defensive guards', () => {
  it('rejects an invalid Date for the none transform', () => {
    expect(() => applyTransform(new Date('not-a-date'), 'none')).toThrow(TypeError);
  });

  it('rejects non-finite numbers for currency formatting', () => {
    expect(() =>
      applyTransform(Number.POSITIVE_INFINITY as unknown as SourceValue, 'format-currency-eur'),
    ).toThrow(TypeError);
    expect(() =>
      applyTransform(Number.NaN as unknown as SourceValue, 'format-currency-no-symbol'),
    ).toThrow(TypeError);
  });
});
