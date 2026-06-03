/**
 * transforms.ts — Pure value-to-string formatters for the pdf-fill render core.
 *
 * One dispatcher (`applyTransform`) covers every variant declared in
 * `TransformSchema` (see ../types.ts). The render engine in `./fill.ts` calls
 * this once per mapping field to derive the string that gets written into the
 * PDF (either as an AcroForm text/checkbox or as an absolute-coordinate draw).
 *
 * Contract:
 *   - `null` / `undefined` input ALWAYS yields `''`, regardless of transform.
 *     This lets the caller treat "no data" uniformly without per-transform
 *     branching.
 *   - Type-incompatible input (e.g. boolean for `format-currency-eur`) throws
 *     a `TypeError` with a descriptive message. The render engine catches
 *     this and surfaces it as a warning.
 *   - No locale dependency — German formatting is hand-rolled so the function
 *     behaves identically in Node, Workers, and the Vitest pool-workers env
 *     where `Intl` formatters are unreliable across runtimes.
 *
 * If `TransformSchema` gains a variant, the `switch` here will fail the
 * exhaustiveness check (`assertNever`) and TypeScript will refuse to compile.
 */

import type { Transform } from '../types';

export type TransformId = Transform;

/** Every shape the render engine might pass in from the user data bundle. */
export type SourceValue = string | number | boolean | Date | null | undefined;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Convert `value` into the string that should be written into the PDF
 * according to `transformId`.
 *
 * `null` / `undefined` short-circuits to `''` for every transform.
 */
export function applyTransform(value: SourceValue, transformId: TransformId): string {
  if (value === null || value === undefined) return '';

  switch (transformId) {
    case 'none':
      return stringifyNone(value);
    case 'floor':
      return formatFloor(value);
    case 'round':
      return formatRound(value);
    case 'format-currency-eur':
      return formatCurrencyEur(value);
    case 'format-currency-no-symbol':
      return formatCurrencyNoSymbol(value);
    case 'format-date-iso':
      return formatDateIso(value);
    case 'format-date-de':
      return formatDateDe(value);
    case 'boolean-x':
      return formatBooleanX(value);
    default:
      return assertNever(transformId);
  }
}

// ─── Variant implementations ────────────────────────────────────────────────

/**
 * `none`: lossless stringification. Numbers via `String(n)`, booleans as
 * `'true' | 'false'`, Dates as ISO 8601 (the most machine-friendly default).
 */
function stringifyNone(value: Exclude<SourceValue, null | undefined>): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("transform 'none' received an invalid Date");
    }
    return value.toISOString();
  }
  throw new TypeError(`transform 'none' received unsupported value type`);
}

/** `floor`: numeric floor, written as a plain integer string ('1.7' -> '1'). */
function formatFloor(value: Exclude<SourceValue, null | undefined>): string {
  const n = coerceFiniteNumber(value, 'floor');
  return String(Math.floor(n));
}

/** `round`: half-away-from-zero round, written as a plain integer string. */
function formatRound(value: Exclude<SourceValue, null | undefined>): string {
  const n = coerceFiniteNumber(value, 'round');
  return String(Math.round(n));
}

/**
 * `format-currency-eur`: German locale currency with symbol suffix.
 * Examples: `1234.56` -> `'1.234,56 €'`, `0` -> `'0,00 €'`, `-5` -> `'-5,00 €'`.
 */
function formatCurrencyEur(value: Exclude<SourceValue, null | undefined>): string {
  const n = coerceFiniteNumber(value, 'format-currency-eur');
  return `${formatGermanDecimal(n, 2)} €`;
}

/**
 * `format-currency-no-symbol`: amount only, German thousands/decimal style,
 * no currency suffix. Used in BMF forms where the currency column is fixed.
 */
function formatCurrencyNoSymbol(value: Exclude<SourceValue, null | undefined>): string {
  const n = coerceFiniteNumber(value, 'format-currency-no-symbol');
  return formatGermanDecimal(n, 2);
}

/** `format-date-iso`: Date | ISO-string -> `YYYY-MM-DD` (calendar date only). */
function formatDateIso(value: Exclude<SourceValue, null | undefined>): string {
  const d = coerceDate(value, 'format-date-iso');
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** `format-date-de`: Date | ISO-string -> `DD.MM.YYYY`, zero-padded. */
function formatDateDe(value: Exclude<SourceValue, null | undefined>): string {
  const d = coerceDate(value, 'format-date-de');
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** `boolean-x`: truthy boolean -> `'X'`, everything else -> `''`. */
function formatBooleanX(value: Exclude<SourceValue, null | undefined>): string {
  if (typeof value !== 'boolean') {
    throw new TypeError(`transform 'boolean-x' expects boolean, got ${typeof value}`);
  }
  return value ? 'X' : '';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Coerce to finite number. Strings are parsed if they cleanly represent a
 * number. Booleans, Dates, and non-numeric strings throw.
 */
function coerceFiniteNumber(value: Exclude<SourceValue, null | undefined>, label: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`transform '${label}' received non-finite number`);
    }
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    throw new TypeError(`transform '${label}' received non-numeric string '${value}'`);
  }
  throw new TypeError(`transform '${label}' expects number, got ${typeof value}`);
}

/**
 * Coerce to Date. Accepts a `Date` instance or an ISO 8601 string.
 * Other types throw TypeError; invalid date values throw TypeError too.
 */
function coerceDate(value: Exclude<SourceValue, null | undefined>, label: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`transform '${label}' received an invalid Date`);
    }
    return value;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new TypeError(`transform '${label}' received unparseable date string '${value}'`);
    }
    return d;
  }
  throw new TypeError(`transform '${label}' expects Date or ISO string, got ${typeof value}`);
}

/** Two-digit zero-padded integer string. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Hand-rolled German decimal formatter: `1234567.5` -> `'1.234.567,50'`.
 * Avoids `Intl.NumberFormat` so output is deterministic across Node / Workers
 * runtimes (and across CI vs local). Negative numbers retain a leading `-`.
 */
function formatGermanDecimal(value: number, fractionDigits: number): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const fixed = abs.toFixed(fractionDigits); // always uses '.' as separator
  const [intPart, fracPart = ''] = fixed.split('.');
  // Insert '.' as thousands separator every three digits from the right.
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = fractionDigits > 0 ? `${withThousands},${fracPart}` : withThousands;
  return negative ? `-${body}` : body;
}

/**
 * Exhaustiveness guard. If a new variant is added to `TransformSchema` but
 * not handled above, `value` here is narrowed to `never` and TypeScript will
 * refuse to compile, surfacing the gap at build time.
 */
function assertNever(value: never): never {
  throw new TypeError(`applyTransform: unimplemented transform '${String(value)}'`);
}
