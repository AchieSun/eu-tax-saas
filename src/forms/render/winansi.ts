/**
 * winansi.ts — WinAnsi (CP1252) safety layer for pdf-lib StandardFonts.
 *
 * pdf-lib's StandardFonts.Helvetica is WinAnsi-encoded (~256 glyphs). Any
 * Unicode codepoint outside that set throws an `Encoding error` deep inside
 * setText / drawText. Real W4 user data WILL contain such codepoints — every
 * German address has an ü/ö/ä/ß, every French name has é/à, every
 * sufficiently fancy email signature has an em-dash or a smart quote.
 *
 * This module deterministically transliterates such input into a string
 * that is guaranteed to encode under WinAnsi, returning both the safe text
 * AND a structured list of replacements so callers can surface a "we
 * silently rewrote 3 chars" warning to the user.
 *
 * Strategy:
 *   1. Apply a lossy transliteration table char-by-char (German + common
 *      European diacritics + typography). Crucially, the table runs FIRST
 *      even for chars that ARE in the WinAnsi extended set (e.g. em-dash
 *      0x97). This is intentional: simpler/uglier output is more portable
 *      than relying on extended WinAnsi slots that some PDF readers render
 *      with replacement boxes.
 *   2. Any remaining char that is NOT WinAnsi-safe → `'?'`.
 *   3. Iterate via `for (const ch of input)` so surrogate pairs (emoji,
 *      higher-plane CJK) are treated as a single replacement unit.
 *
 * NotoSans / true Unicode font embedding is W5 scope — explicitly NOT
 * landing here because it adds ~250 KB to the worker bundle.
 *
 * The module is pure: no I/O, no top-level side effects, no imports beyond
 * stdlib types.
 */

// ─── Public types ───────────────────────────────────────────────────────────

export interface WinAnsiResult {
  /** Input string after transliteration; guaranteed WinAnsi-encodable. */
  text: string;
  /**
   * Pairs of `{original, replacement}` for every char that was rewritten.
   * NOT deduplicated — `"Müller"` produces one entry for `ü`; `"Größe"`
   * produces two (one for `ö`, one for `ß`). Callers that want a summary
   * (e.g. for a single warning line per field) can dedupe via Set.
   */
  replacements: Array<{ original: string; replacement: string }>;
}

// ─── Transliteration table ──────────────────────────────────────────────────

/**
 * Char-by-char lossy map. Applied before the WinAnsi-safety check so that
 * even chars that would technically encode (—, ", ", …) get downgraded to
 * plain ASCII. Order doesn't matter (every key is a single char).
 *
 * Coverage targets: German (primary), then the major Latin-script EU
 * languages that show up in the W4 user base — French, Spanish,
 * Portuguese, Italian, Polish, Czech, plus the typography characters that
 * sneak in via copy-paste from web forms / Word docs.
 */
const TRANSLIT_MAP: Record<string, string> = {
  // German
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
  ẞ: 'SS',
  // French / Spanish / Portuguese / Italian — vowels with diacritics
  à: 'a',
  á: 'a',
  â: 'a',
  ã: 'a',
  å: 'a',
  ą: 'a',
  À: 'A',
  Á: 'A',
  Â: 'A',
  Ã: 'A',
  Å: 'A',
  Ą: 'A',
  è: 'e',
  é: 'e',
  ê: 'e',
  ë: 'e',
  ę: 'e',
  È: 'E',
  É: 'E',
  Ê: 'E',
  Ë: 'E',
  Ę: 'E',
  ì: 'i',
  í: 'i',
  î: 'i',
  ï: 'i',
  Ì: 'I',
  Í: 'I',
  Î: 'I',
  Ï: 'I',
  ò: 'o',
  ó: 'o',
  ô: 'o',
  õ: 'o',
  ø: 'o',
  Ò: 'O',
  Ó: 'O',
  Ô: 'O',
  Õ: 'O',
  Ø: 'O',
  ù: 'u',
  ú: 'u',
  û: 'u',
  Ù: 'U',
  Ú: 'U',
  Û: 'U',
  ý: 'y',
  ÿ: 'y',
  Ý: 'Y',
  Ÿ: 'Y',
  // Consonants with diacritics
  ñ: 'n',
  Ñ: 'N',
  ç: 'c',
  Ç: 'C',
  ł: 'l',
  Ł: 'L',
  ś: 's',
  š: 's',
  ş: 's',
  Ś: 'S',
  Š: 'S',
  Ş: 'S',
  ż: 'z',
  ź: 'z',
  ž: 'z',
  Ż: 'Z',
  Ź: 'Z',
  Ž: 'Z',
  č: 'c',
  Č: 'C',
  ř: 'r',
  Ř: 'R',
  ť: 't',
  Ť: 'T',
  ď: 'd',
  Ď: 'D',
  ň: 'n',
  Ň: 'N',
  ě: 'e',
  Ě: 'E',
  // Typography (em-dash, en-dash, smart quotes, ellipsis, NBSP)
  '—': '-',
  '–': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2026': '...',
  '\u00A0': ' ',
  // Currency note: € (U+20AC) is intentionally NOT in the table — it lives
  // at 0x80 in WinAnsi and is universally rendered by Helvetica, so we let
  // it pass through unchanged via isWinAnsiSafe below.
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Transliterate `input` into a WinAnsi-encodable string. Never throws.
 *
 * Performance: O(n) over Unicode scalars; uses string concatenation in a
 * tight loop. Inputs of realistic field length (< 200 chars) are sub-µs.
 */
export function toWinAnsi(input: string): WinAnsiResult {
  const replacements: Array<{ original: string; replacement: string }> = [];

  let result = '';
  // `for..of` iterates by Unicode scalar — surrogate pairs count as one
  // step, so emoji and higher-plane CJK collapse cleanly to a single `?`.
  for (const ch of input) {
    const mapped = TRANSLIT_MAP[ch];
    if (mapped !== undefined) {
      result += mapped;
      replacements.push({ original: ch, replacement: mapped });
    } else if (isWinAnsiSafe(ch)) {
      result += ch;
    } else {
      result += '?';
      replacements.push({ original: ch, replacement: '?' });
    }
  }
  return { text: result, replacements };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns true iff the single char `ch` can be encoded by pdf-lib's
 * WinAnsiEncoding. WinAnsi covers:
 *   - ASCII printable 0x20..0x7E plus the standard whitespace controls
 *   - Latin-1 supplement 0xA0..0xFF
 *   - A scattered set of Unicode-mapped chars in the 0x80..0x9F slot
 *     (€, ƒ, †, ‡, ™, etc.) — see PDF 32000-1 Annex D.2.
 *
 * NB: most of the 0x80..0x9F set is ALSO covered by TRANSLIT_MAP above and
 * gets downgraded BEFORE this check runs; the survivors here are the ones
 * we explicitly want to keep (€, †, ‡, •, ™, etc.).
 */
function isWinAnsiSafe(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  // Whitespace controls
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  // ASCII printable
  if (code >= 0x20 && code <= 0x7e) return true;
  // Latin-1 supplement (covers ¡..ÿ, including all the German extended set
  // even though we transliterated it above — defence in depth)
  if (code >= 0xa0 && code <= 0xff) return true;
  // WinAnsi-mapped chars in the 0x80..0x9F slot
  return WIN_ANSI_SPECIAL.has(code);
}

/**
 * Codepoints that WinAnsi maps into the 0x80..0x9F slot per PDF 32000-1
 * Annex D.2. Most are pre-empted by TRANSLIT_MAP — kept here as the
 * conservative fallback for callers that bypass the table (none today,
 * but the contract should be self-consistent).
 */
const WIN_ANSI_SPECIAL = new Set<number>([
  0x20ac, // €  EURO SIGN          → 0x80
  0x201a, // ‚  SINGLE LOW-9 QUOTE → 0x82
  0x0192, // ƒ  FLORIN              → 0x83
  0x201e, // „  DOUBLE LOW-9 QUOTE → 0x84
  0x2026, // …  HORIZONTAL ELLIPSIS→ 0x85 (transliterated)
  0x2020, // †  DAGGER              → 0x86
  0x2021, // ‡  DOUBLE DAGGER       → 0x87
  0x02c6, // ˆ  MODIFIER LETTER CIRCUMFLEX → 0x88
  0x2030, // ‰  PER MILLE SIGN     → 0x89
  0x0160, // Š  S WITH CARON       → 0x8A (transliterated)
  0x2039, // ‹  SINGLE LEFT-POINTING ANGLE QUOTE → 0x8B
  0x0152, // Œ  OE LIGATURE         → 0x8C
  0x017d, // Ž  Z WITH CARON        → 0x8E (transliterated)
  0x2018, // '  LEFT SINGLE QUOTE   → 0x91 (transliterated)
  0x2019, // '  RIGHT SINGLE QUOTE  → 0x92 (transliterated)
  0x201c, // "  LEFT DOUBLE QUOTE   → 0x93 (transliterated)
  0x201d, // "  RIGHT DOUBLE QUOTE  → 0x94 (transliterated)
  0x2022, // •  BULLET              → 0x95
  0x2013, // –  EN DASH             → 0x96 (transliterated)
  0x2014, // —  EM DASH             → 0x97 (transliterated)
  0x02dc, // ˜  SMALL TILDE         → 0x98
  0x2122, // ™  TRADE MARK SIGN     → 0x99
  0x0161, // š  s WITH CARON        → 0x9A (transliterated)
  0x203a, // ›  SINGLE RIGHT-POINTING ANGLE QUOTE → 0x9B
  0x0153, // œ  oe LIGATURE         → 0x9C
  0x017e, // ž  z WITH CARON        → 0x9E (transliterated)
  0x0178, // Ÿ  Y WITH DIAERESIS    → 0x9F (transliterated)
]);
