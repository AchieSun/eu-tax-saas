// Oracle P1-1 (W4 review): export PDFTooLargeError so the /render route
// can reject oversized source PDFs (R2 bytes that exceed maxPages) with a
// typed, catchable error instead of silently OOMing the worker isolate.
/**
 * fill.ts — Pure render core for W4 T3.1a (pdf-fill engine).
 *
 * Overlays user data onto a PDF using two strategies, dispatched per field by
 * the mapping's `kind` discriminator:
 *
 *   - `kind: 'acroform'`   → writes via pdf-lib's AcroForm API
 *                            (`setText` / `check` / `uncheck`).
 *   - `kind: 'coordinate'` → draws absolute-positioned text via
 *                            `page.drawText` (for flat / scanned PDFs).
 *
 * Design contract (per W4 design notes):
 *   - Best-effort fill: a missing data path, an unknown PDF field, or a
 *     transform failure produces a WARNING (collected in the result) and
 *     skips that single field rather than aborting the whole render.
 *   - The form is NEVER flattened — users may re-edit the output in a
 *     standard PDF reader (this is an explicit product decision).
 *   - No I/O: the function takes bytes in and returns bytes out so it can
 *     run in a Worker, in Node, or in a unit test pool worker identically.
 *   - WinAnsi-only fonts in this milestone (StandardFonts.Helvetica). User
 *     data is run through `toWinAnsi` (T3.1c) before every setText/drawText
 *     so non-WinAnsi codepoints (ü, ö, ß, —, …, emoji) are deterministically
 *     transliterated instead of crashing pdf-lib's encoder.
 *   - Watermarking (T3.1b) runs as the final pass before save. Default ON;
 *     opt out per-call with `watermark: false`, or override defaults by
 *     passing a `WatermarkOptions` object.
 */

import { PDFDocument, type PDFFont, StandardFonts, rgb } from 'pdf-lib';
import type { Field, FormMapping } from '../types';
import { type SourceValue, applyTransform } from './transforms';
import { type WatermarkOptions, applyWatermark } from './watermark';
import { toWinAnsi } from './winansi';

// Re-exported so downstream callers (T3.2 API surface) can type their input
// against the consolidated fill.ts module without an extra import.
export type { WatermarkOptions } from './watermark';

// ─── Public types ───────────────────────────────────────────────────────────

/** Arbitrarily nested user data bundle; leaves resolve to `SourceValue`. */
export type FillFormData = Record<string, unknown>;

/**
 * Oracle P1-1 (W4 review) — typed error thrown by fillForm when the source
 * PDF carries more pages than the caller is willing to render. The /render
 * route catches this to return a structured 502 + reject-reason header
 * instead of letting pdf-lib chew through arbitrary user-supplied bytes.
 */
export class PDFTooLargeError extends Error {
  readonly pageCount: number;
  readonly limit: number;
  constructor(pageCount: number, limit: number) {
    super(`source PDF has ${pageCount} pages, exceeds limit ${limit}`);
    this.name = 'PDFTooLargeError';
    this.pageCount = pageCount;
    this.limit = limit;
  }
}

export interface FillFormInput {
  pdfBytes: Uint8Array;
  mapping: FormMapping;
  /**
   * Free-form bundle whose leaves are resolved via dot-notation
   * `sourcePath`s declared in the mapping (e.g. `user.profile.firstName`).
   */
  data: FillFormData;
  /**
   * Oracle P1-1 (W4 review): hard ceiling on source PDF page count. When
   * set, fillForm() throws PDFTooLargeError after PDFDocument.load() if
   * the loaded doc exceeds this number. Omit to disable (no cap).
   */
  maxPages?: number;
  /**
   * Draft watermark control (T3.1b). Three states:
   *   - `undefined` (omitted) → ON with defaults. This is the safe default:
   *     every rendered PDF is marked as a draft unless the caller opts out.
   *   - `false`               → OFF (e.g. final filing copy).
   *   - `WatermarkOptions`    → ON with overrides (custom text, opacity, etc.).
   */
  watermark?: false | WatermarkOptions;
  /**
   * Oracle P0-4 (W4 review) — embed mapping + render provenance into the
   * PDF's built-in metadata slots (Producer / Creator / Subject / Keywords
   * / CreationDate / ModDate) so the artifact is self-describing after it
   * leaves the worker. All fields optional; omit to leave pdf-lib defaults
   * untouched (callers that don't care — e.g. unit tests — needn't pay
   * for the extra dictionary writes).
   */
  metadata?: {
    mappingVersion: number;
    mappingHash: string;
    country: string;
    taxYear: number;
    formType: string;
    /** ISO-8601 string. Defaults to `new Date().toISOString()` if omitted. */
    renderedAt?: string;
    /** Short SHA-256 prefix of the user id (or 'anonymous' / omitted). */
    userIdHash?: string;
  };
}

export interface FillFormResult {
  pdfBytes: Uint8Array;
  /** Human-readable diagnostics for skipped fields. Order matches mapping. */
  warnings: string[];
  /** Count of fields that were actually written into the PDF. */
  filledFieldCount: number;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Render `mapping.fields` over `pdfBytes` using `data` as the value source.
 *
 * Returns the modified PDF bytes plus a warnings list — never throws for
 * data-shape issues (only for genuinely broken PDF input, which is let
 * through from pdf-lib).
 */
export async function fillForm(input: FillFormInput): Promise<FillFormResult> {
  const { pdfBytes, mapping, data } = input;

  // Invalid PDF bytes deliberately propagate the natural pdf-lib error.
  const doc = await PDFDocument.load(pdfBytes);
  // Oracle P1-1 (W4 review): enforce page-count cap on the freshly-loaded
  // doc BEFORE embedding fonts or iterating fields. Throwing PDFTooLargeError
  // gives the caller a typed error to map to a 502 + structured body.
  if (input.maxPages !== undefined) {
    const pageCount = doc.getPageCount();
    if (pageCount > input.maxPages) {
      throw new PDFTooLargeError(pageCount, input.maxPages);
    }
  }
  // Embed Helvetica once and reuse — embedFont is expensive and the engine
  // may stamp dozens of coordinate fields per render.
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();

  const warnings: string[] = [];
  let filledFieldCount = 0;

  for (let i = 0; i < mapping.fields.length; i++) {
    const field = mapping.fields[i];
    const fieldLabel = describeField(field, i);

    // 1. Resolve source value via dot-notation path.
    const rawValue = getByPath(data, field.sourcePath);
    if (rawValue === undefined) {
      warnings.push(`field ${fieldLabel} missing data at path '${field.sourcePath}'`);
      continue;
    }

    // 2. Apply transform. Catch defensively so one bad value never
    //    poisons the rest of the render.
    let rawText: string;
    try {
      rawText = applyTransform(rawValue as SourceValue, field.transform);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`field ${fieldLabel} transform '${field.transform}' failed: ${msg}`);
      continue;
    }

    // 2b. WinAnsi safety pass (T3.1c). Helvetica throws on out-of-range
    //     codepoints; we transliterate first and surface a per-field
    //     summary warning when anything was rewritten. Originals are
    //     deduped in the message so "Müller Straße" reads as one entry
    //     listing [ü,ß] rather than five.
    const { text, replacements } = toWinAnsi(rawText);
    if (replacements.length > 0) {
      const uniqueOriginals = [...new Set(replacements.map((r) => r.original))];
      warnings.push(
        `field ${fieldLabel} replaced ${replacements.length} non-WinAnsi char(s) [${uniqueOriginals.join(',')}]`,
      );
    }

    // 3. Dispatch on field kind.
    if (field.kind === 'acroform') {
      const ok = writeAcroFormField(form, field, text, rawValue, warnings, fieldLabel);
      if (ok) filledFieldCount += 1;
    } else {
      const ok = writeCoordinateField(doc, field, text, helvetica, warnings, fieldLabel);
      if (ok) filledFieldCount += 1;
    }
  }

  // Final pass: stamp the DRAFT watermark unless the caller opts out. We
  // pass the already-embedded Helvetica through so the helper doesn't
  // embed a second copy. Default-ON matches the W4 product decision:
  // every rendered PDF must be unmistakably marked as a draft.
  if (input.watermark !== false) {
    const overrides = typeof input.watermark === 'object' ? input.watermark : {};
    await applyWatermark(doc, { font: helvetica, ...overrides });
  }

  // Oracle P0-4 (W4 review): if the caller supplied provenance metadata,
  // write it into the PDF's built-in metadata slots so the artifact is
  // self-describing after it leaves the worker. We deliberately keep this
  // OUT of the render hot-path's exception surface — pdf-lib's setters
  // throw only on invalid types, not on user data, so wrapping is overkill.
  if (input.metadata) {
    const m = input.metadata;
    const renderedAt = m.renderedAt ?? new Date().toISOString();
    const shortHash = m.mappingHash.slice(0, 16);
    doc.setProducer(
      `eu-tax-saas/${m.country}/${m.taxYear}/${m.formType} mapping v${m.mappingVersion} ${shortHash}`,
    );
    doc.setCreator('eu-tax-saas render core T3.1a');
    doc.setSubject(`${m.country} ${m.taxYear} ${m.formType} draft`);
    const keywords = [
      `country:${m.country}`,
      `year:${m.taxYear}`,
      `form:${m.formType}`,
      `mapping-version:${m.mappingVersion}`,
      `mapping-hash:${m.mappingHash}`,
      `rendered-at:${renderedAt}`,
    ];
    if (m.userIdHash) keywords.push(`user-id-hash:${m.userIdHash}`);
    doc.setKeywords(keywords);
    const now = new Date();
    doc.setCreationDate(now);
    doc.setModificationDate(now);
  }

  // Deliberately NOT calling form.flatten(): users may re-edit the output.
  const out = await doc.save({ updateFieldAppearances: true });

  return { pdfBytes: out, warnings, filledFieldCount };
}

// ─── AcroForm write path ────────────────────────────────────────────────────

/**
 * Write a single AcroForm widget. Returns `true` on success, `false` (and
 * pushes a warning) if the field name is missing from the PDF or the
 * widget access throws.
 */
function writeAcroFormField(
  form: ReturnType<PDFDocument['getForm']>,
  field: Extract<Field, { kind: 'acroform' }>,
  text: string,
  rawValue: unknown,
  warnings: string[],
  fieldLabel: string,
): boolean {
  try {
    if (field.type === 'checkbox') {
      const cb = form.getCheckBox(field.pdfField);
      // Prefer the transform output ('X' from `boolean-x`); fall back to the
      // raw truthiness so a 'checkbox' field with `transform: 'none'` still
      // works as expected from a boolean source.
      const shouldCheck = text === 'X' || (text === '' ? false : Boolean(rawValue));
      if (shouldCheck) cb.check();
      else cb.uncheck();
      return true;
    }

    // text / number / date all map onto the AcroForm text-widget API.
    const tf = form.getTextField(field.pdfField);
    tf.setText(text);
    if (field.fontSize !== undefined) {
      tf.setFontSize(field.fontSize);
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(
      `field ${fieldLabel} AcroForm widget '${field.pdfField}' not found or unwritable: ${msg}`,
    );
    return false;
  }
}

// ─── Coordinate write path ──────────────────────────────────────────────────

/**
 * Draw absolute-positioned text on the requested page. Returns `true` on
 * success, `false` (and pushes a warning) if the page index is out of range.
 */
function writeCoordinateField(
  doc: PDFDocument,
  field: Extract<Field, { kind: 'coordinate' }>,
  text: string,
  font: PDFFont,
  warnings: string[],
  fieldLabel: string,
): boolean {
  const pageCount = doc.getPageCount();
  if (field.page < 0 || field.page >= pageCount) {
    warnings.push(
      `field ${fieldLabel} coordinate page ${field.page} out of range (document has ${pageCount} page(s))`,
    );
    return false;
  }

  const page = doc.getPage(field.page);
  page.drawText(text, {
    x: field.x,
    y: field.y,
    size: field.fontSize,
    font,
    color: rgb(0, 0, 0),
  });
  return true;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve a dot-notation path (e.g. `'user.profile.firstName'`) inside an
 * arbitrarily nested object. Returns `undefined` for any missing segment.
 *
 * Deliberately tiny + dependency-free: lodash.get would be overkill here.
 */
function getByPath(obj: unknown, path: string): SourceValue | undefined {
  const keys = path.split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur as SourceValue | undefined;
}

/**
 * Stable identifier for a mapping field used in warning messages. Falls back
 * to the array index when the field has no human-readable key (coordinate
 * fields don't carry a name beyond their sourcePath).
 */
function describeField(field: Field, index: number): string {
  if (field.kind === 'acroform') return `#${index} '${field.pdfField}'`;
  return `#${index} (coord ${field.sourcePath})`;
}
