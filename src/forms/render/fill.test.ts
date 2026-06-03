/**
 * fill.test.ts — Integration tests for the pdf-fill render core (W4 T3.1a).
 *
 * Builds synthetic PDFs at runtime via tests/fixtures/pdf-builder (no
 * committed binaries) and verifies the engine's behaviour end-to-end:
 *   - Successful AcroForm + checkbox + coordinate writes
 *   - Best-effort warning collection (missing data, missing widget, bad page)
 *   - Round-trippable output (PDFDocument.load doesn't throw, values readable)
 */

import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildSynthPdfCoordOnly,
  buildSynthPdfWithAcroForm,
  defaultMantelStyleFields,
} from '../../../tests/fixtures/pdf-builder';
import type { FormMapping } from '../types';
import { fillForm } from './fill';

// ─── Helpers ────────────────────────────────────────────────────────────────

const SOURCE_VERSION = 'synthetic 1.0 — for tests only';
const SOURCE_URL = 'https://example.com/synthetic.pdf';

/** Build a FormMapping that matches `defaultMantelStyleFields()` 1:1. */
function defaultMantelMapping(): FormMapping {
  return {
    country: 'DE',
    year: 2024,
    form: 'mantelbogen-synth',
    formTitle: 'Synthetic Mantelbogen for tests',
    sourceUrl: SOURCE_URL,
    sourceVersion: SOURCE_VERSION,
    fields: [
      {
        kind: 'acroform',
        pdfField: 'txt_first_name',
        sourcePath: 'user.profile.firstName',
        type: 'text',
        transform: 'none',
        citation: 'test',
      },
      {
        kind: 'acroform',
        pdfField: 'txt_last_name',
        sourcePath: 'user.profile.lastName',
        type: 'text',
        transform: 'none',
        citation: 'test',
      },
      {
        kind: 'acroform',
        pdfField: 'txt_tax_id',
        sourcePath: 'user.profile.taxId',
        type: 'text',
        transform: 'none',
        citation: 'test',
      },
      {
        kind: 'acroform',
        pdfField: 'txt_address_line1',
        sourcePath: 'user.profile.address.line1',
        type: 'text',
        transform: 'none',
        citation: 'test',
      },
      {
        kind: 'acroform',
        pdfField: 'chk_married',
        sourcePath: 'user.profile.isMarried',
        type: 'checkbox',
        transform: 'boolean-x',
        citation: 'test',
      },
    ],
  };
}

// ─── Fixtures shared across tests ───────────────────────────────────────────

let mantelPdf: Uint8Array;
let coordPdf: Uint8Array;
let multiPagePdf: Uint8Array;

beforeAll(async () => {
  mantelPdf = await buildSynthPdfWithAcroForm({ fields: defaultMantelStyleFields() });
  coordPdf = await buildSynthPdfCoordOnly();
  multiPagePdf = await buildSynthPdfCoordOnly({ pageCount: 3 });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('fillForm — AcroForm happy path', () => {
  it('fills all 5 default Mantelbogen-style fields with no warnings', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'Anna',
            lastName: 'Schmidt',
            taxId: 'DE123456789',
            address: { line1: 'Hauptstraße 1' },
            isMarried: true,
          },
        },
      },
    });

    // %PDF magic header
    expect(result.pdfBytes[0]).toBe(0x25);
    expect(result.pdfBytes[1]).toBe(0x50);
    expect(result.pdfBytes[2]).toBe(0x44);
    expect(result.pdfBytes[3]).toBe(0x46);

    expect(result.filledFieldCount).toBe(5);
    expect(result.warnings).toEqual([]);
  });

  it('round-trips: re-parsing the output yields the same text field values', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'Anna',
            lastName: 'Schmidt',
            taxId: 'DE123456789',
            address: { line1: 'Hauptstraße 1' },
            isMarried: false,
          },
        },
      },
    });

    const pdf = await PDFDocument.load(result.pdfBytes);
    const form = pdf.getForm();
    expect(form.getTextField('txt_first_name').getText()).toBe('Anna');
    expect(form.getTextField('txt_last_name').getText()).toBe('Schmidt');
    expect(form.getTextField('txt_tax_id').getText()).toBe('DE123456789');
    expect(form.getTextField('txt_address_line1').getText()).toBe('Hauptstraße 1');
  });

  it('checks the checkbox when boolean-x transform yields "X"', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'A',
            lastName: 'B',
            taxId: 'C',
            address: { line1: 'D' },
            isMarried: true,
          },
        },
      },
    });

    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getForm().getCheckBox('chk_married').isChecked()).toBe(true);
  });

  it('unchecks the checkbox when the boolean source is false', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'A',
            lastName: 'B',
            taxId: 'C',
            address: { line1: 'D' },
            isMarried: false,
          },
        },
      },
    });

    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getForm().getCheckBox('chk_married').isChecked()).toBe(false);
    // Field is still considered "filled" — we wrote a value (uncheck) into it.
    expect(result.filledFieldCount).toBe(5);
  });
});

describe('fillForm — warning collection', () => {
  it('warns and skips when sourcePath resolves to undefined', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'Anna',
            // lastName intentionally omitted
            taxId: 'DE1',
            address: { line1: 'X' },
            isMarried: true,
          },
        },
      },
    });

    expect(result.filledFieldCount).toBe(4);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('missing data');
    expect(result.warnings[0]).toContain('user.profile.lastName');
  });

  it('warns and skips when the mapping references a missing AcroForm widget', async () => {
    const mapping = defaultMantelMapping();
    // Inject a typo as the third field; the other 4 must still fill.
    mapping.fields.splice(2, 0, {
      kind: 'acroform',
      pdfField: 'txt_does_not_exist',
      sourcePath: 'user.profile.firstName',
      type: 'text',
      transform: 'none',
      citation: 'test',
    });

    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping,
      data: {
        user: {
          profile: {
            firstName: 'Anna',
            lastName: 'Schmidt',
            taxId: 'DE1',
            address: { line1: 'X' },
            isMarried: true,
          },
        },
      },
    });

    expect(result.filledFieldCount).toBe(5);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/txt_does_not_exist/);
    expect(result.warnings[0]).toMatch(/not found/);
  });

  it('warns and skips when a transform throws on incompatible input', async () => {
    const mapping: FormMapping = {
      ...defaultMantelMapping(),
      fields: [
        {
          kind: 'acroform',
          pdfField: 'txt_first_name',
          sourcePath: 'user.profile.flag',
          type: 'text',
          transform: 'format-currency-eur', // boolean → throws TypeError
          citation: 'test',
        },
      ],
    };

    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping,
      data: { user: { profile: { flag: true } } },
    });

    expect(result.filledFieldCount).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/transform 'format-currency-eur' failed/);
  });
});

describe('fillForm — coordinate writes', () => {
  it('draws coordinate text on the requested page of a coord-only PDF', async () => {
    const mapping: FormMapping = {
      country: 'DE',
      year: 2024,
      form: 'coord-synth',
      formTitle: 'Synthetic coord PDF',
      sourceUrl: SOURCE_URL,
      sourceVersion: SOURCE_VERSION,
      fields: [
        {
          kind: 'coordinate',
          sourcePath: 'value',
          type: 'text',
          transform: 'none',
          citation: 'test',
          page: 0,
          x: 100,
          y: 700,
          fontSize: 12,
        },
      ],
    };

    const result = await fillForm({
      pdfBytes: coordPdf,
      mapping,
      data: { value: 'Hello PDF' },
    });

    expect(result.filledFieldCount).toBe(1);
    expect(result.warnings).toEqual([]);

    // Output PDF must still load cleanly.
    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('writes coordinate text on page 2 of a 3-page PDF without touching others', async () => {
    const mapping: FormMapping = {
      country: 'DE',
      year: 2024,
      form: 'coord-multi',
      formTitle: 'Multi-page coord PDF',
      sourceUrl: SOURCE_URL,
      sourceVersion: SOURCE_VERSION,
      fields: [
        {
          kind: 'coordinate',
          sourcePath: 'value',
          type: 'text',
          transform: 'none',
          citation: 'test',
          page: 2,
          x: 50,
          y: 500,
          fontSize: 10,
        },
      ],
    };

    const result = await fillForm({
      pdfBytes: multiPagePdf,
      mapping,
      data: { value: 'page-2-text' },
    });

    expect(result.filledFieldCount).toBe(1);
    expect(result.warnings).toEqual([]);

    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getPageCount()).toBe(3);
  });

  it('warns and skips when the coordinate page is out of range', async () => {
    const mapping: FormMapping = {
      country: 'DE',
      year: 2024,
      form: 'coord-bad-page',
      formTitle: 'Bad page coord PDF',
      sourceUrl: SOURCE_URL,
      sourceVersion: SOURCE_VERSION,
      fields: [
        {
          kind: 'coordinate',
          sourcePath: 'value',
          type: 'text',
          transform: 'none',
          citation: 'test',
          page: 99,
          x: 50,
          y: 500,
          fontSize: 10,
        },
      ],
    };

    const result = await fillForm({
      pdfBytes: coordPdf,
      mapping,
      data: { value: 'never drawn' },
    });

    expect(result.filledFieldCount).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/page 99 out of range/);
  });
});

describe('fillForm — formatting + edge cases', () => {
  it('applies format-date-de to a Date source', async () => {
    const mapping: FormMapping = {
      ...defaultMantelMapping(),
      fields: [
        {
          kind: 'acroform',
          pdfField: 'txt_first_name',
          sourcePath: 'user.profile.dob',
          type: 'date',
          transform: 'format-date-de',
          citation: 'test',
        },
      ],
    };

    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping,
      data: { user: { profile: { dob: new Date(Date.UTC(2024, 5, 3)) } } },
    });

    expect(result.filledFieldCount).toBe(1);
    expect(result.warnings).toEqual([]);

    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getForm().getTextField('txt_first_name').getText()).toBe('03.06.2024');
  });

  it('returns a valid PDF and no warnings when mapping has zero fields', async () => {
    // Note: FormMappingSchema enforces fields.min(1) at parse time, but the
    // render engine doesn't re-validate — it just iterates. Constructing the
    // object directly (no .parse()) lets us prove the loop is a no-op.
    const mapping = {
      ...defaultMantelMapping(),
      fields: [],
    } as unknown as FormMapping;

    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping,
      data: {},
    });

    expect(result.filledFieldCount).toBe(0);
    expect(result.warnings).toEqual([]);
    // Output is still a valid PDF — just round-trippable input bytes.
    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('honours fontSize on an AcroForm text field without crashing', async () => {
    const mapping: FormMapping = {
      ...defaultMantelMapping(),
      fields: [
        {
          kind: 'acroform',
          pdfField: 'txt_first_name',
          sourcePath: 'user.profile.firstName',
          type: 'text',
          transform: 'none',
          citation: 'test',
          fontSize: 18,
        },
      ],
    };

    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping,
      data: { user: { profile: { firstName: 'Anna' } } },
    });

    expect(result.filledFieldCount).toBe(1);
    expect(result.warnings).toEqual([]);

    // Re-parse + read back to confirm the field is still well-formed.
    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getForm().getTextField('txt_first_name').getText()).toBe('Anna');
  });

  it('produces a result PDF that re-opens cleanly', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'Anna',
            lastName: 'Schmidt',
            taxId: 'DE1',
            address: { line1: 'X' },
            isMarried: true,
          },
        },
      },
    });

    // Must not throw.
    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getPageCount()).toBe(1);
    // Form should still be present (we don't flatten).
    expect(pdf.getForm().getFields().length).toBe(5);
  });
});
