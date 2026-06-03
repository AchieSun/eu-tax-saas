/**
 * W4 T5.1 — End-to-end PDF render pipeline smoke test.
 *
 * Exercises the full render stack IN-PROCESS, end-to-end:
 *   synth source PDF (T3.2 dev-fallback)
 *     → fillForm with realistic user data (T3.1a)
 *       → WinAnsi transliteration (T3.1c)
 *         → DRAFT watermark (T3.1b)
 *           → byte-level assertions on the produced PDF
 *
 * Why this layer:
 *   Unit tests in src/forms/render/*.test.ts cover each module in
 *   isolation. The route integration tests in src/api/routes/forms.test.ts
 *   cover HTTP plumbing with a mocked DB. Neither runs the realistic
 *   "synth PDF -> fill -> watermark -> bytes" chain start-to-finish.
 *   This test does, with assertions that catch composition regressions
 *   even when every individual module's tests stay green.
 *
 * No CI. Run locally via `pnpm test` (vitest already includes
 * `tests/e2e/**\/*.test.ts` per vitest.config.ts).
 */

import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { fillForm } from '../../src/forms/render/fill';
import { buildSynthPdfWithAcroForm, defaultMantelStyleFields } from '../../src/forms/render/synth';
import type { FormMapping } from '../../src/forms/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Decompress a single page's content streams and return the latin1 text.
 * Mirrors the helper in src/forms/render/watermark.test.ts (kept private
 * there); duplicated here to keep the e2e test self-contained.
 */
function decodePageContentStream(pdf: PDFDocument, pageIdx: number): string {
  const page = pdf.getPage(pageIdx);
  const ctx = pdf.context;
  const contents = page.node.Contents();
  if (!contents) return '';

  const items =
    typeof (contents as { asArray?: () => unknown[] }).asArray === 'function'
      ? (contents as { asArray: () => unknown[] }).asArray()
      : [contents];

  let combined = '';
  for (const item of items) {
    const stream = ctx.lookup(item as never) as { contents?: Uint8Array };
    const raw = stream?.contents;
    if (!raw) continue;
    try {
      combined += inflateSync(Buffer.from(raw)).toString('latin1');
    } catch {
      combined += Buffer.from(raw).toString('latin1');
    }
  }
  return combined;
}

/**
 * Extract every Tj-operand string (both literal `(text)` and hex `<bytes>`
 * forms) from a decoded content stream so .includes(search) catches both.
 */
function extractTjStrings(decoded: string): string {
  let out = '';
  for (const m of decoded.matchAll(/\(([^)]*)\)\s*Tj/g)) {
    out += m[1];
  }
  for (const m of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    const hex = m[1];
    for (let i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(Number.parseInt(hex.substring(i, i + 2), 16));
    }
  }
  return out;
}

/** Whole-PDF text scan across every page. */
async function pdfContainsText(pdfBytes: Uint8Array, search: string): Promise<boolean> {
  const doc = await PDFDocument.load(pdfBytes);
  for (let i = 0; i < doc.getPageCount(); i++) {
    const decoded = decodePageContentStream(doc, i);
    if (extractTjStrings(decoded).includes(search)) return true;
  }
  return false;
}

/**
 * Build a FormMapping whose fields line up 1:1 with the synth PDF's
 * AcroForm widgets (txt_first_name / txt_last_name / txt_tax_id /
 * txt_address_line1 / chk_married). Mirrors what the route will look
 * like once T1.3b's BMF mapping has its TBD_* placeholders resolved.
 */
function buildE2EMapping(): FormMapping {
  return {
    country: 'DE',
    year: 2024,
    form: 'mantelbogen_e2e',
    formTitle: 'E2E synth Mantelbogen-style mapping',
    sourceUrl: 'https://example.invalid/e2e-mantelbogen.pdf',
    sourceVersion: 'E2E-FIXTURE',
    fields: [
      {
        kind: 'acroform',
        pdfField: 'txt_first_name',
        sourcePath: 'taxpayer.firstName',
        type: 'text',
        transform: 'none',
        citation: 'E2E synth field — first name',
      },
      {
        kind: 'acroform',
        pdfField: 'txt_last_name',
        sourcePath: 'taxpayer.lastName',
        type: 'text',
        transform: 'none',
        citation: 'E2E synth field — last name',
      },
      {
        kind: 'acroform',
        pdfField: 'txt_tax_id',
        sourcePath: 'taxpayer.taxId',
        type: 'text',
        transform: 'none',
        citation: 'E2E synth field — tax id',
      },
      {
        kind: 'acroform',
        pdfField: 'txt_address_line1',
        sourcePath: 'taxpayer.addressLine1',
        type: 'text',
        transform: 'none',
        citation: 'E2E synth field — address',
      },
      {
        kind: 'acroform',
        pdfField: 'chk_married',
        sourcePath: 'taxpayer.married',
        type: 'checkbox',
        transform: 'boolean-x',
        citation: 'E2E synth field — married checkbox',
      },
    ],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('W4 T5.1 — end-to-end PDF render pipeline', () => {
  it('happy path: synth PDF + ASCII data → valid PDF with DRAFT watermark and all 5 fields filled', async () => {
    const synth = await buildSynthPdfWithAcroForm({
      pageCount: 1,
      pageWidth: 595,
      pageHeight: 842,
      fields: defaultMantelStyleFields(),
    });
    const mapping = buildE2EMapping();

    const result = await fillForm({
      pdfBytes: synth,
      mapping,
      data: {
        taxpayer: {
          firstName: 'Anna',
          lastName: 'Schmidt',
          taxId: '11-DE-12345678',
          addressLine1: 'Hauptstrasse 1, 10115 Berlin',
          married: true,
        },
      },
    });

    // 1. Pipeline-level invariants.
    expect(result.warnings).toEqual([]);
    expect(result.filledFieldCount).toBe(5);

    // 2. Resulting bytes are a valid PDF reloadable by pdf-lib.
    expect(Buffer.from(result.pdfBytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const reloaded = await PDFDocument.load(result.pdfBytes);
    expect(reloaded.getPageCount()).toBe(1);

    // 3. Default watermark is present on the rendered page.
    await expect(pdfContainsText(result.pdfBytes, 'DRAFT')).resolves.toBe(true);

    // 4. Round-trip: re-reading the AcroForm shows the filled values
    //    AS-WRITTEN (no transliteration needed for ASCII data).
    const reloadedForm = reloaded.getForm();
    expect(reloadedForm.getTextField('txt_first_name').getText()).toBe('Anna');
    expect(reloadedForm.getTextField('txt_last_name').getText()).toBe('Schmidt');
    expect(reloadedForm.getTextField('txt_tax_id').getText()).toBe('11-DE-12345678');
    expect(reloadedForm.getTextField('txt_address_line1').getText()).toBe(
      'Hauptstrasse 1, 10115 Berlin',
    );
    expect(reloadedForm.getCheckBox('chk_married').isChecked()).toBe(true);
  });

  it('WinAnsi guard: German diacritics transliterate without throwing, with one warning per field', async () => {
    const synth = await buildSynthPdfWithAcroForm({
      pageCount: 1,
      pageWidth: 595,
      pageHeight: 842,
      fields: defaultMantelStyleFields(),
    });
    const mapping = buildE2EMapping();

    const result = await fillForm({
      pdfBytes: synth,
      mapping,
      data: {
        taxpayer: {
          firstName: 'Müller',
          lastName: 'Größe',
          taxId: '99-DE-Straße',
          addressLine1: 'Lärchenweg 7, 80331 München',
          married: false,
        },
      },
    });

    // Four text fields each emit ONE deduped warning; the checkbox
    // path doesn't run the WinAnsi guard. Five fields filled total.
    expect(result.filledFieldCount).toBe(5);
    expect(result.warnings.length).toBe(4);
    for (const w of result.warnings) {
      expect(w).toMatch(/replaced \d+ non-WinAnsi char/);
    }

    // Round-trip: ASCII transliterations made it into the form.
    const reloaded = await PDFDocument.load(result.pdfBytes);
    const form = reloaded.getForm();
    expect(form.getTextField('txt_first_name').getText()).toBe('Mueller');
    expect(form.getTextField('txt_last_name').getText()).toBe('Groesse');
    expect(form.getTextField('txt_tax_id').getText()).toBe('99-DE-Strasse');
    expect(form.getTextField('txt_address_line1').getText()).toBe('Laerchenweg 7, 80331 Muenchen');
    expect(form.getCheckBox('chk_married').isChecked()).toBe(false);
  });

  it('watermark opt-out: result PDF contains no DRAFT bytes when watermark:false', async () => {
    const synth = await buildSynthPdfWithAcroForm({
      pageCount: 1,
      pageWidth: 595,
      pageHeight: 842,
      fields: defaultMantelStyleFields(),
    });
    const mapping = buildE2EMapping();

    const result = await fillForm({
      pdfBytes: synth,
      mapping,
      data: {
        taxpayer: {
          firstName: 'Foo',
          lastName: 'Bar',
          taxId: 'X',
          addressLine1: 'Y',
          married: true,
        },
      },
      watermark: false,
    });

    expect(result.warnings).toEqual([]);
    expect(result.filledFieldCount).toBe(5);
    await expect(pdfContainsText(result.pdfBytes, 'DRAFT')).resolves.toBe(false);
  });

  it('missing data: fields with no source value record a warning and are skipped (no throw)', async () => {
    const synth = await buildSynthPdfWithAcroForm({
      pageCount: 1,
      pageWidth: 595,
      pageHeight: 842,
      fields: defaultMantelStyleFields(),
    });
    const mapping = buildE2EMapping();

    const result = await fillForm({
      pdfBytes: synth,
      mapping,
      data: {
        // Only firstName + lastName supplied; the other three are absent.
        taxpayer: { firstName: 'Half', lastName: 'Filled' },
      },
    });

    expect(result.filledFieldCount).toBe(2);
    expect(result.warnings.length).toBe(3);
    for (const w of result.warnings) {
      expect(w).toMatch(/missing data at path 'taxpayer\./);
    }

    // The PDF is still valid + DRAFT-watermarked.
    const reloaded = await PDFDocument.load(result.pdfBytes);
    expect(reloaded.getPageCount()).toBe(1);
    await expect(pdfContainsText(result.pdfBytes, 'DRAFT')).resolves.toBe(true);
  });

  it('multi-page synth: watermark stamps every page', async () => {
    const synth = await buildSynthPdfWithAcroForm({
      pageCount: 3,
      pageWidth: 595,
      pageHeight: 842,
      fields: defaultMantelStyleFields(),
    });
    const mapping = buildE2EMapping();

    const result = await fillForm({
      pdfBytes: synth,
      mapping,
      data: {
        taxpayer: {
          firstName: 'A',
          lastName: 'B',
          taxId: 'C',
          addressLine1: 'D',
          married: false,
        },
      },
    });

    expect(result.filledFieldCount).toBe(5);
    const reloaded = await PDFDocument.load(result.pdfBytes);
    expect(reloaded.getPageCount()).toBe(3);

    // Per-page DRAFT check using the same decode helper as pdfContainsText.
    for (let p = 0; p < reloaded.getPageCount(); p++) {
      const decoded = decodePageContentStream(reloaded, p);
      const txt = extractTjStrings(decoded);
      expect(txt.includes('DRAFT'), `page ${p} missing DRAFT watermark`).toBe(true);
    }
  });
});
