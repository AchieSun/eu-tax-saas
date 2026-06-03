/**
 * synth.ts — Synthetic PDF builders used as the production dev-fallback
 * source for the render pipeline (W4 T3.2).
 *
 * Moved out of tests/fixtures/pdf-builder.ts so the API route (which runs
 * in the Worker bundle) can import these helpers without dragging in any
 * test-only modules. tests/fixtures/pdf-builder.ts now re-exports from
 * here so existing test imports keep working unchanged.
 *
 * Two builders:
 *   - buildSynthPdfWithAcroForm({pageCount, pageWidth, pageHeight, fields})
 *       → AcroForm-bearing PDF (text + checkbox widgets at requested coords)
 *   - buildSynthPdfCoordOnly({pageCount, pageWidth, pageHeight})
 *       → empty pages, no AcroForm (used by coordinate-overlay tests)
 *
 * Plus one preset:
 *   - defaultMantelStyleFields()
 *       → 5-field German Mantelbogen-style layout for the dev fallback.
 *
 * Pure helpers — no I/O, no Worker-only globals. Safe to import from
 * Node, Workers, or the Vitest pool-workers env identically.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FieldKind = 'text' | 'checkbox';

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  x: number;
  y: number;
  width: number;
  height: number;
  page?: number;
  defaultValue?: string;
}

export interface BuildAcroFormOptions {
  pageCount?: number;
  pageWidth?: number;
  pageHeight?: number;
  fields?: FieldSpec[];
}

export interface BuildCoordOnlyOptions {
  pageCount?: number;
  pageWidth?: number;
  pageHeight?: number;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_PAGE_WIDTH = 595; // A4 width in pt
const DEFAULT_PAGE_HEIGHT = 842; // A4 height in pt
const DEFAULT_FONT_SIZE = 12;

// ─── Builders ───────────────────────────────────────────────────────────────

/**
 * Build a synthetic PDF carrying an AcroForm with the requested fields.
 *
 * - Default page size is A4 portrait (595 x 842 pt).
 * - Embeds Helvetica once and binds it to the form's default-appearance
 *   resource so text-field appearance strings render correctly across
 *   pdf-lib versions.
 * - Checkboxes treat defaultValue values "true" / "1" / "yes" as checked.
 */
export async function buildSynthPdfWithAcroForm(
  options: BuildAcroFormOptions = {},
): Promise<Uint8Array> {
  const pageCount = options.pageCount ?? 1;
  const pageWidth = options.pageWidth ?? DEFAULT_PAGE_WIDTH;
  const pageHeight = options.pageHeight ?? DEFAULT_PAGE_HEIGHT;
  const fields = options.fields ?? [];

  if (pageCount < 1) {
    throw new Error(`pageCount must be >= 1, got ${pageCount}`);
  }

  const pdf = await PDFDocument.create();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);

  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push(pdf.addPage([pageWidth, pageHeight]));
  }

  const form = pdf.getForm();

  for (const spec of fields) {
    const pageIndex = spec.page ?? 0;
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(
        `field "${spec.name}" targets page ${pageIndex} but document has ${pages.length} page(s)`,
      );
    }
    const targetPage = pages[pageIndex];

    if (spec.kind === 'text') {
      const tf = form.createTextField(spec.name);
      if (spec.defaultValue !== undefined) {
        tf.setText(spec.defaultValue);
      }
      // addToPage must run before setFontSize: pdf-lib creates the /DA
      // (default appearance) entry on the widget during addToPage, and
      // setFontSize parses /DA to inject the new size token.
      tf.addToPage(targetPage, {
        x: spec.x,
        y: spec.y,
        width: spec.width,
        height: spec.height,
        font: helvetica,
      });
      tf.setFontSize(DEFAULT_FONT_SIZE);
    } else if (spec.kind === 'checkbox') {
      const cb = form.createCheckBox(spec.name);
      const truthy = ['true', '1', 'yes', 'on', 'checked'];
      if (spec.defaultValue !== undefined && truthy.includes(spec.defaultValue.toLowerCase())) {
        cb.check();
      }
      cb.addToPage(targetPage, {
        x: spec.x,
        y: spec.y,
        width: spec.width,
        height: spec.height,
      });
    } else {
      throw new Error(`unsupported field kind "${(spec as FieldSpec).kind}"`);
    }
  }

  return pdf.save({ updateFieldAppearances: false });
}

/**
 * Build a synthetic PDF with empty pages and no AcroForm — used for testing
 * coordinate-only overlay rendering paths.
 */
export async function buildSynthPdfCoordOnly(
  options: BuildCoordOnlyOptions = {},
): Promise<Uint8Array> {
  const pageCount = options.pageCount ?? 1;
  const pageWidth = options.pageWidth ?? DEFAULT_PAGE_WIDTH;
  const pageHeight = options.pageHeight ?? DEFAULT_PAGE_HEIGHT;

  if (pageCount < 1) {
    throw new Error(`pageCount must be >= 1, got ${pageCount}`);
  }

  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    pdf.addPage([pageWidth, pageHeight]);
  }
  return pdf.save({ updateFieldAppearances: false });
}

// ─── Preset ─────────────────────────────────────────────────────────────────

/**
 * Default 5-field preset mimicking a German Mantelbogen (cover sheet)
 * layout. Coordinates are realistic pt positions on an A4 page.
 *
 * Field order:
 *   txt_first_name, txt_last_name, txt_tax_id, txt_address_line1, chk_married
 */
export function defaultMantelStyleFields(): FieldSpec[] {
  return [
    {
      name: 'txt_first_name',
      kind: 'text',
      x: 80,
      y: 720,
      width: 200,
      height: 18,
      page: 0,
    },
    {
      name: 'txt_last_name',
      kind: 'text',
      x: 300,
      y: 720,
      width: 215,
      height: 18,
      page: 0,
    },
    {
      name: 'txt_tax_id',
      kind: 'text',
      x: 80,
      y: 680,
      width: 200,
      height: 18,
      page: 0,
    },
    {
      name: 'txt_address_line1',
      kind: 'text',
      x: 80,
      y: 640,
      width: 435,
      height: 18,
      page: 0,
    },
    {
      name: 'chk_married',
      kind: 'checkbox',
      x: 80,
      y: 600,
      width: 14,
      height: 14,
      page: 0,
    },
  ];
}
