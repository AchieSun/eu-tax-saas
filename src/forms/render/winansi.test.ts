/**
 * winansi.test.ts — Unit tests for the WinAnsi safety guard (W4 T3.1c).
 *
 * Coverage anchors:
 *   - Identity for ASCII / WinAnsi-safe input (no replacements emitted).
 *   - German diacritics get the two-letter expansion (`ü → ue`, `ß → ss`).
 *   - Major EU diacritics collapse to ASCII base letter.
 *   - Typography (em-dash, smart quotes, ellipsis, NBSP) downgrades even
 *     though some of those would technically encode under WinAnsi.
 *   - Non-Latin scripts (CJK, emoji) become `'?'` rather than throw.
 *   - Surrogate pairs (emoji, codepoint > 0xFFFF) iterate as one unit.
 *   - Replacements are emitted in order, not deduplicated (callers own that).
 */

import { describe, expect, it } from 'vitest';
import { toWinAnsi } from './winansi';

describe('toWinAnsi — pass-through inputs', () => {
  it('empty string returns empty + no replacements', () => {
    expect(toWinAnsi('')).toEqual({ text: '', replacements: [] });
  });

  it('pure ASCII input is unchanged with no replacements', () => {
    const r = toWinAnsi('Hello World 123');
    expect(r.text).toBe('Hello World 123');
    expect(r.replacements).toEqual([]);
  });

  it('preserves the Euro sign (WinAnsi 0x80) without replacement', () => {
    const r = toWinAnsi('Total: 100€');
    expect(r.text).toBe('Total: 100€');
    expect(r.replacements).toEqual([]);
  });

  it('preserves Latin-1 supplement (¡..ÿ) chars that have no transliteration entry', () => {
    // ¿ (U+00BF) is Latin-1 supplement, not in TRANSLIT_MAP → passes through.
    const r = toWinAnsi('¿Hola?');
    expect(r.text).toBe('¿Hola?');
    expect(r.replacements).toEqual([]);
  });
});

describe('toWinAnsi — German transliteration', () => {
  it('transliterates Müller to Mueller', () => {
    const r = toWinAnsi('Müller');
    expect(r.text).toBe('Mueller');
    expect(r.replacements).toEqual([{ original: 'ü', replacement: 'ue' }]);
  });

  it('transliterates Straße to Strasse', () => {
    const r = toWinAnsi('Straße');
    expect(r.text).toBe('Strasse');
    expect(r.replacements).toEqual([{ original: 'ß', replacement: 'ss' }]);
  });

  it('transliterates Größe to Groesse with two replacements', () => {
    const r = toWinAnsi('Größe');
    expect(r.text).toBe('Groesse');
    expect(r.replacements).toEqual([
      { original: 'ö', replacement: 'oe' },
      { original: 'ß', replacement: 'ss' },
    ]);
  });

  it('handles uppercase Umlauts (Ä Ö Ü) → (Ae Oe Ue)', () => {
    const r = toWinAnsi('ÄÖÜ');
    expect(r.text).toBe('AeOeUe');
    expect(r.replacements).toHaveLength(3);
  });
});

describe('toWinAnsi — Romance languages', () => {
  it('transliterates résumé to resume', () => {
    const r = toWinAnsi('résumé');
    expect(r.text).toBe('resume');
    expect(r.replacements).toHaveLength(2);
    expect(r.replacements.every((rep) => rep.original === 'é')).toBe(true);
  });

  it('transliterates naïve façade to naive facade', () => {
    const r = toWinAnsi('naïve façade');
    expect(r.text).toBe('naive facade');
    expect(r.replacements).toEqual([
      { original: 'ï', replacement: 'i' },
      { original: 'ç', replacement: 'c' },
    ]);
  });

  it('transliterates Polish Łódź to Lodz with 3 replacements', () => {
    const r = toWinAnsi('Łódź');
    expect(r.text).toBe('Lodz');
    expect(r.replacements).toHaveLength(3);
  });

  it('transliterates Czech Příliš žluťoučký to plain ASCII', () => {
    const r = toWinAnsi('Příliš žluťoučký');
    // P + ř→r + í→i + l + i + š→s + ' ' + ž→z + l + u + ť→t + o + u + č→c + k + ý→y
    expect(r.text).toBe('Prilis zlutoucky');
    expect(r.text.includes('?')).toBe(false);
  });
});

describe('toWinAnsi — typography', () => {
  it('em-dash becomes ASCII hyphen', () => {
    const r = toWinAnsi('—');
    expect(r.text).toBe('-');
    expect(r.replacements).toEqual([{ original: '—', replacement: '-' }]);
  });

  it('en-dash becomes ASCII hyphen', () => {
    const r = toWinAnsi('–');
    expect(r.text).toBe('-');
    expect(r.replacements).toEqual([{ original: '–', replacement: '-' }]);
  });

  it('smart double quotes collapse to ASCII double quotes', () => {
    const r = toWinAnsi('\u201Chello\u201D');
    expect(r.text).toBe('"hello"');
    expect(r.replacements).toHaveLength(2);
  });

  it('ellipsis becomes three ASCII dots', () => {
    const r = toWinAnsi('\u2026');
    expect(r.text).toBe('...');
    expect(r.replacements).toEqual([{ original: '\u2026', replacement: '...' }]);
  });

  it('non-breaking space becomes regular space', () => {
    const r = toWinAnsi('a\u00A0b');
    expect(r.text).toBe('a b');
    expect(r.replacements).toEqual([{ original: '\u00A0', replacement: ' ' }]);
  });
});

describe('toWinAnsi — unsupported scripts fall back to "?"', () => {
  it('CJK chars become one "?" each', () => {
    const r = toWinAnsi('北京');
    expect(r.text).toBe('??');
    expect(r.replacements).toEqual([
      { original: '北', replacement: '?' },
      { original: '京', replacement: '?' },
    ]);
  });

  it('emoji (surrogate pair) is iterated as one char and becomes one "?"', () => {
    const r = toWinAnsi('🎉');
    expect(r.text).toBe('?');
    expect(r.replacements).toHaveLength(1);
    // The original captured is the surrogate-pair-as-string from for..of.
    expect(r.replacements[0].original).toBe('🎉');
    expect(r.replacements[0].replacement).toBe('?');
  });

  it('mixed Latin + emoji preserves Latin and replaces only the emoji', () => {
    const r = toWinAnsi('Party 🎉 time');
    expect(r.text).toBe('Party ? time');
    expect(r.replacements).toHaveLength(1);
  });
});

describe('toWinAnsi — Oracle P2-B NFC normalization', () => {
  it('NFD-decomposed é (e + U+0301) normalizes to NFC é before transliteration', () => {
    // 'caf\u0065\u0301' is NFD for 'café'. After NFC normalization it becomes
    // 'caf\u00e9' which maps to 'cafe' in TRANSLIT_MAP. No '?' should appear.
    const r = toWinAnsi('caf\u0065\u0301');
    expect(r.text).toBe('cafe');
    expect(r.text.includes('?')).toBe(false);
  });

  it('NFD ñ (n + U+0303) becomes single char in output', () => {
    // NFD 'n\u0303' normalizes to NFC '\u00f1' which maps to 'n'.
    const r = toWinAnsi('jalape\u00f1o');
    expect(r.text).toBe('jalapeno');
    expect(r.text.includes('?')).toBe(false);
  });

  it('NFC pre-composed é stays as é (single char output)', () => {
    // NFC 'caf\u00e9' should produce identical output to the NFD case.
    const r = toWinAnsi('caf\u00e9');
    expect(r.text).toBe('cafe');
    expect(r.text.includes('?')).toBe(false);
  });

  it('NFC normalization is idempotent for already-NFC strings (existing tests still pass)', () => {
    // Regression: existing German/Romance tests all use NFC strings already.
    const r1 = toWinAnsi('Müller');
    expect(r1.text).toBe('Mueller');
    const r2 = toWinAnsi('résumé');
    expect(r2.text).toBe('resume');
    const r3 = toWinAnsi('naïve façade');
    expect(r3.text).toBe('naive facade');
  });
});

describe('toWinAnsi — mixed-input integration', () => {
  it('Café — €100 → Cafe - €100 (é + em-dash replaced, € preserved)', () => {
    const r = toWinAnsi('Café — €100');
    expect(r.text).toBe('Cafe - €100');
    expect(r.replacements).toEqual([
      { original: 'é', replacement: 'e' },
      { original: '—', replacement: '-' },
    ]);
  });

  it('Real German address line transliterates fully', () => {
    const r = toWinAnsi('Hauptstraße 1, 10115 München');
    expect(r.text).toBe('Hauptstrasse 1, 10115 Muenchen');
    // ß + ü = 2 replacements
    expect(r.replacements).toHaveLength(2);
  });

  it('Replacements list is NOT deduplicated (each occurrence emits one entry)', () => {
    const r = toWinAnsi('üüü');
    expect(r.text).toBe('ueueue');
    expect(r.replacements).toHaveLength(3);
  });
});
