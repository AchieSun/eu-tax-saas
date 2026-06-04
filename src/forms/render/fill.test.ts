/**
 * fill.test.ts — Integration tests for the pdf-fill render core (W4 T3.1a).
 *
 * Builds synthetic PDFs at runtime via tests/fixtures/pdf-builder (no
 * committed binaries) and verifies the engine's behaviour end-to-end:
 *   - Successful AcroForm + checkbox + coordinate writes
 *   - Best-effort warning collection (missing data, missing widget, bad page)
 *   - Round-trippable output (PDFDocument.load doesn't throw, values readable)
 */

import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildSynthPdfCoordOnly,
  buildSynthPdfWithAcroForm,
  defaultMantelStyleFields,
} from '../../../tests/fixtures/pdf-builder';
import type { FormMapping } from '../types';
import {
  type FillWarning,
  PDFTooLargeError,
  buildWarningFooterText,
  fillForm,
  formatWarningsForLog,
} from './fill';

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
            address: { line1: 'Hauptstrasse 1' },
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
            address: { line1: 'Hauptstrasse 1' },
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
    expect(form.getTextField('txt_address_line1').getText()).toBe('Hauptstrasse 1');
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
    expect(result.warnings[0]?.reason).toBe('missing-data');
    expect(result.warnings[0]?.dataPath).toBe('user.profile.lastName');
    expect(result.warnings[0]?.fieldName).toBe('txt_last_name');
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
    expect(result.warnings[0]?.reason).toBe('unknown-field');
    expect(result.warnings[0]?.fieldName).toBe('txt_does_not_exist');
    expect(result.warnings[0]?.detail).toMatch(/not found/);
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
    expect(result.warnings[0]?.reason).toBe('transform-failed');
    expect(result.warnings[0]?.detail).toMatch(/format-currency-eur/);
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
    expect(result.warnings[0]?.reason).toBe('unknown-field');
    expect(result.warnings[0]?.detail).toMatch(/page 99 out of range/);
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

describe('fillForm — watermark integration (T3.1b)', () => {
  // pdf-lib emits Tj text operands as hex strings (`<4452...> Tj`) inside
  // FlateDecode-compressed content streams, so a naive byte scan of the
  // saved bytes won't find the watermark text. We inflate + decode here.
  async function pdfContainsText(pdfBytes: Uint8Array, search: string): Promise<boolean> {
    const pdf = await PDFDocument.load(pdfBytes);
    for (let i = 0; i < pdf.getPageCount(); i++) {
      const page = pdf.getPage(i);
      const contents = page.node.Contents();
      if (!contents) continue;
      const items =
        typeof (contents as { asArray?: () => unknown[] }).asArray === 'function'
          ? (contents as { asArray: () => unknown[] }).asArray()
          : [contents];

      let decoded = '';
      for (const item of items) {
        const stream = pdf.context.lookup(item as never) as { contents?: Uint8Array };
        const raw = stream?.contents;
        if (!raw) continue;
        try {
          decoded += inflateSync(Buffer.from(raw)).toString('latin1');
        } catch {
          decoded += Buffer.from(raw).toString('latin1');
        }
      }

      let extracted = '';
      for (const m of decoded.matchAll(/\(([^)]*)\)\s*Tj/g)) extracted += m[1];
      for (const m of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
        const hex = m[1];
        for (let j = 0; j < hex.length; j += 2) {
          extracted += String.fromCharCode(Number.parseInt(hex.substring(j, j + 2), 16));
        }
      }
      if (extracted.includes(search)) return true;
    }
    return false;
  }

  const standardData = {
    user: {
      profile: {
        firstName: 'Anna',
        lastName: 'Schmidt',
        taxId: 'DE1',
        address: { line1: 'X' },
        isMarried: true,
      },
    },
  };

  it('stamps the default DRAFT watermark when no watermark option is supplied', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: standardData,
    });

    expect(await pdfContainsText(result.pdfBytes, 'DRAFT')).toBe(true);
    // Fields still filled normally — watermark is a non-destructive overlay.
    expect(result.filledFieldCount).toBe(5);
  });

  it('omits the watermark when watermark: false', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: standardData,
      watermark: false,
    });

    expect(await pdfContainsText(result.pdfBytes, 'DRAFT')).toBe(false);
    expect(result.filledFieldCount).toBe(5);
  });

  it('honours a custom watermark text passed via watermark option', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: standardData,
      watermark: { text: 'TEST DRAFT' },
    });

    expect(await pdfContainsText(result.pdfBytes, 'TEST DRAFT')).toBe(true);
    expect(result.filledFieldCount).toBe(5);
  });
});

describe('fillForm — WinAnsi safety guard (T3.1c)', () => {
  it('renders a German name with ü, emits a single dedup-summary warning, and round-trips as transliterated text', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'Müller',
            lastName: 'Schmidt',
            taxId: 'DE1',
            address: { line1: 'X' },
            isMarried: false,
          },
        },
      },
    });

    expect(result.filledFieldCount).toBe(5);
    // Exactly one warning, attributed to the first-name field, listing [ü].
    const warn = result.warnings.find((w) => w.fieldName === 'txt_first_name');
    expect(warn).toBeDefined();
    expect(warn?.reason).toBe('transliterated');
    expect(warn?.detail).toMatch(/replaced 1 non-WinAnsi char\(s\) \[ü\]/);

    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getForm().getTextField('txt_first_name').getText()).toBe('Mueller');
  });

  it('does NOT throw on Chinese input — falls back to "?" and warns', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: '北京',
            lastName: 'Schmidt',
            taxId: 'DE1',
            address: { line1: 'X' },
            isMarried: false,
          },
        },
      },
    });

    expect(result.filledFieldCount).toBe(5);
    const warn = result.warnings.find((w) => w.fieldName === 'txt_first_name');
    expect(warn).toBeDefined();
    expect(warn?.reason).toBe('transliterated');
    expect(warn?.detail).toMatch(/replaced 2 non-WinAnsi char\(s\)/);
    // Output must remain a re-parseable PDF.
    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getForm().getTextField('txt_first_name').getText()).toBe('??');
  });

  it('mixed input "Café Müller" emits ONE warning per field summarising both unique chars', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'Café Müller',
            lastName: 'Schmidt',
            taxId: 'DE1',
            address: { line1: 'X' },
            isMarried: false,
          },
        },
      },
    });

    expect(result.filledFieldCount).toBe(5);
    const matches = result.warnings.filter((w) => w.fieldName === 'txt_first_name');
    // Single per-field warning line, even though there are two distinct
    // non-WinAnsi chars in the value.
    expect(matches).toHaveLength(1);
    expect(matches[0]?.reason).toBe('transliterated');
    expect(matches[0]?.detail).toMatch(/replaced 2 non-WinAnsi char\(s\)/);
    expect(matches[0]?.detail).toContain('é');
    expect(matches[0]?.detail).toContain('ü');

    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getForm().getTextField('txt_first_name').getText()).toBe('Cafe Mueller');
  });

  it('coordinate-draw path also benefits from the guard (no throw on em-dash)', async () => {
    const mapping: FormMapping = {
      country: 'DE',
      year: 2024,
      form: 'coord-winansi',
      formTitle: 'Coord WinAnsi guard',
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
      // em-dash + smart-quotes + ü → all transliterated before drawText
      data: { value: 'A\u2014B \u201Chi\u201D Müller' },
    });

    expect(result.filledFieldCount).toBe(1);
    // One per-field summary covering the three distinct non-WinAnsi chars.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.reason).toBe('transliterated');
    expect(result.warnings[0]?.detail).toMatch(/replaced \d+ non-WinAnsi char\(s\)/);
    // PDF must still load.
    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getPageCount()).toBe(1);
  });
});

// ── Oracle P0-4 (W4 review): PDF metadata provenance ──────────────────
describe('fillForm — PDF metadata embedding (Oracle P0-4)', () => {
  it('leaves metadata slots untouched when no metadata option is supplied', async () => {
    const before = await PDFDocument.load(mantelPdf);
    const beforeProducer = before.getProducer();
    const beforeSubject = before.getSubject();

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

    const after = await PDFDocument.load(result.pdfBytes);
    // Producer is whatever pdf-lib injects on save; the important thing is
    // that we did NOT write our custom "eu-tax-saas/..." string.
    const afterProducer = after.getProducer();
    expect(afterProducer ?? '').not.toContain('eu-tax-saas/');
    expect(after.getSubject() ?? '').toBe(beforeSubject ?? '');
    // Sanity: pdf-lib still sets *some* producer string by default.
    expect(afterProducer).toBeDefined();
    void beforeProducer;
  });

  it('writes Producer/Creator/Subject/Keywords when metadata is provided', async () => {
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
      metadata: {
        mappingVersion: 7,
        mappingHash: 'deadbeefcafef00ddeadbeefcafef00ddeadbeefcafef00ddeadbeefcafef00d',
        country: 'DE',
        taxYear: 2024,
        formType: 'mantelbogen',
        renderedAt: '2026-06-03T12:00:00.000Z',
        userIdHash: '0123456789abcdef',
      },
    });

    // updateMetadata:false so PDFDocument.load() doesn't clobber our Producer
    // with pdf-lib's default string before we can read it back.
    const pdf = await PDFDocument.load(result.pdfBytes, { updateMetadata: false });
    const producer = pdf.getProducer() ?? '';
    expect(producer).toContain('eu-tax-saas/DE/2024/mantelbogen');
    expect(producer).toContain('mapping v7');
    expect(producer).toContain('deadbeefcafef00d'); // short hash prefix
    expect(pdf.getCreator()).toBe('eu-tax-saas render core T3.1a');
    expect(pdf.getSubject()).toBe('DE 2024 mantelbogen draft');

    const keywords = pdf.getKeywords() ?? '';
    expect(keywords).toContain('country:DE');
    expect(keywords).toContain('year:2024');
    expect(keywords).toContain('form:mantelbogen');
    expect(keywords).toContain('mapping-version:7');
    expect(keywords).toContain(
      'mapping-hash:deadbeefcafef00ddeadbeefcafef00ddeadbeefcafef00ddeadbeefcafef00d',
    );
    expect(keywords).toContain('rendered-at:2026-06-03T12:00:00.000Z');
    expect(keywords).toContain('user-id-hash:0123456789abcdef');
  });

  it('omits user-id-hash keyword when userIdHash is not provided', async () => {
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
      metadata: {
        mappingVersion: 1,
        mappingHash: 'aaaabbbbccccdddd1111222233334444aaaabbbbccccdddd1111222233334444',
        country: 'ES',
        taxYear: 2024,
        formType: 'modelo_100',
      },
    });
    const pdf = await PDFDocument.load(result.pdfBytes, { updateMetadata: false });
    const keywords = pdf.getKeywords() ?? '';
    expect(keywords).not.toContain('user-id-hash:');
    // renderedAt defaults to "now"-shaped ISO string when omitted.
    expect(keywords).toMatch(/rendered-at:\d{4}-\d{2}-\d{2}T/);
  });
});

// ── Oracle P1-1 (W4 review): PDFTooLargeError page-count cap ──────────
describe('fillForm — PDFTooLargeError (Oracle P1-1)', () => {
  it('throws PDFTooLargeError when source doc page count exceeds maxPages', async () => {
    // Build a 3-page coord-only PDF; cap at 2 → must throw.
    const longPdf = await buildSynthPdfCoordOnly({ pageCount: 3 });
    await expect(
      fillForm({
        pdfBytes: longPdf,
        mapping: {
          country: 'DE',
          year: 2024,
          form: 'coord-cap',
          formTitle: 'cap test',
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
              x: 10,
              y: 10,
              fontSize: 10,
            },
          ],
        },
        data: { value: 'x' },
        maxPages: 2,
      }),
    ).rejects.toBeInstanceOf(PDFTooLargeError);
  });

  it('attaches pageCount + limit fields to PDFTooLargeError', async () => {
    const longPdf = await buildSynthPdfCoordOnly({ pageCount: 5 });
    let caught: unknown;
    try {
      await fillForm({
        pdfBytes: longPdf,
        mapping: {
          country: 'DE',
          year: 2024,
          form: 'coord-cap',
          formTitle: 'cap test',
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
              x: 10,
              y: 10,
              fontSize: 10,
            },
          ],
        },
        data: { value: 'x' },
        maxPages: 2,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PDFTooLargeError);
    expect((caught as PDFTooLargeError).pageCount).toBe(5);
    expect((caught as PDFTooLargeError).limit).toBe(2);
  });

  it('does NOT throw when source page count equals maxPages', async () => {
    const pdf = await buildSynthPdfCoordOnly({ pageCount: 2 });
    const result = await fillForm({
      pdfBytes: pdf,
      mapping: {
        country: 'DE',
        year: 2024,
        form: 'coord-cap',
        formTitle: 'cap test',
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
            x: 10,
            y: 10,
            fontSize: 10,
          },
        ],
      },
      data: { value: 'x' },
      maxPages: 2,
    });
    expect(result.filledFieldCount).toBe(1);
  });

  it('omitting maxPages disables the cap (no throw on 10-page doc)', async () => {
    const pdf = await buildSynthPdfCoordOnly({ pageCount: 10 });
    const result = await fillForm({
      pdfBytes: pdf,
      mapping: {
        country: 'DE',
        year: 2024,
        form: 'coord-cap',
        formTitle: 'cap test',
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
            x: 10,
            y: 10,
            fontSize: 10,
          },
        ],
      },
      data: { value: 'x' },
    });
    expect(result.filledFieldCount).toBe(1);
  });
});

// ── Oracle P1-3 (W4 review): warning footer + structured warnings ─────
describe('fillForm — warning footer + structured shape (Oracle P1-3)', () => {
  // Reuse the inflate+Tj helper from the watermark describe block — keep
  // local so this describe can be skipped/refactored independently.
  async function pdfContainsText(pdfBytes: Uint8Array, search: string): Promise<boolean> {
    const pdf = await PDFDocument.load(pdfBytes);
    for (let i = 0; i < pdf.getPageCount(); i++) {
      const page = pdf.getPage(i);
      const contents = page.node.Contents();
      if (!contents) continue;
      const items =
        typeof (contents as { asArray?: () => unknown[] }).asArray === 'function'
          ? (contents as { asArray: () => unknown[] }).asArray()
          : [contents];
      let decoded = '';
      for (const item of items) {
        const stream = pdf.context.lookup(item as never) as { contents?: Uint8Array };
        const raw = stream?.contents;
        if (!raw) continue;
        try {
          decoded += inflateSync(Buffer.from(raw)).toString('latin1');
        } catch {
          decoded += Buffer.from(raw).toString('latin1');
        }
      }
      let extracted = '';
      for (const m of decoded.matchAll(/\(([^)]*)\)\s*Tj/g)) extracted += m[1];
      for (const m of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
        const hex = m[1];
        for (let j = 0; j < hex.length; j += 2) {
          extracted += String.fromCharCode(Number.parseInt(hex.substring(j, j + 2), 16));
        }
      }
      if (extracted.toLowerCase().includes(search.toLowerCase())) return true;
    }
    return false;
  }

  it('warning objects have structured shape with reason discriminator', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'Anna',
            // lastName omitted → missing-data
            taxId: 'DE1',
            address: { line1: 'X' },
            isMarried: true,
          },
        },
      },
    });
    expect(result.warnings).toHaveLength(1);
    const w = result.warnings[0] as FillWarning;
    expect(w).toMatchObject({
      dataPath: 'user.profile.lastName',
      fieldName: 'txt_last_name',
      reason: 'missing-data',
    });
    // Type-level guarantee: reason is one of the documented unions.
    const allowed: readonly FillWarning['reason'][] = [
      'missing-data',
      'transform-failed',
      'transliterated',
      'unknown-field',
      'set-text-failed',
      'set-checkbox-failed',
    ];
    expect(allowed).toContain(w.reason);
  });

  it('warning footer is stamped on page 1 when warnings exist and watermark is on', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'Anna',
            // lastName omitted → triggers missing-data warning
            taxId: 'DE1',
            address: { line1: 'X' },
            isMarried: true,
          },
        },
      },
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    // toWinAnsi rewrites '⚠' → '?'; the core phrase still encodes verbatim.
    expect(await pdfContainsText(result.pdfBytes, 'not filled or transliterated')).toBe(true);
  });

  it('no warning footer when warnings is empty', async () => {
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
    expect(result.warnings).toEqual([]);
    expect(await pdfContainsText(result.pdfBytes, 'not filled or transliterated')).toBe(false);
  });

  it('no warning footer when watermark is explicitly false (warningFooter defaults to false)', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'Anna',
            // lastName omitted → would emit warning if footer were enabled
            taxId: 'DE1',
            address: { line1: 'X' },
            isMarried: true,
          },
        },
      },
      watermark: false,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(await pdfContainsText(result.pdfBytes, 'not filled or transliterated')).toBe(false);
  });

  it('warningFooter:true forces the footer even when watermark is false', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: defaultMantelMapping(),
      data: {
        user: {
          profile: {
            firstName: 'Anna',
            // lastName omitted
            taxId: 'DE1',
            address: { line1: 'X' },
            isMarried: true,
          },
        },
      },
      watermark: false,
      warningFooter: true,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(await pdfContainsText(result.pdfBytes, 'not filled or transliterated')).toBe(true);
  });

  it('buildWarningFooterText is deterministic and asserts the literal format', () => {
    expect(buildWarningFooterText(3)).toBe(
      '⚠ 3 field(s) not filled or transliterated — see app for details',
    );
    expect(buildWarningFooterText(0)).toBe(
      '⚠ 0 field(s) not filled or transliterated — see app for details',
    );
  });

  it('formatWarningsForLog re-creates legacy string[] format for audit hashing', () => {
    const fakeWarnings: FillWarning[] = [
      {
        dataPath: 'user.x',
        fieldName: 'txt_x',
        reason: 'missing-data',
      },
      {
        dataPath: 'user.y',
        fieldName: 'txt_y',
        reason: 'transliterated',
        detail: 'replaced 1 non-WinAnsi char(s) [ü]',
      },
    ];
    const lines = formatWarningsForLog(fakeWarnings);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("missing data at path 'user.x'");
    expect(lines[0]).toContain('txt_x');
    expect(lines[1]).toContain('txt_y');
    expect(lines[1]).toContain('replaced 1 non-WinAnsi');
  });
});

// ─── Oracle P2-A (W4 review) — per-field transform application ─────────────
//
// Regression guard: before P2-A landed, the /render handler hard-coded
// `transform: 'none'` on every field row it read from D1, so passing a
// transform like `format-date-de` from YAML was a silent no-op. These tests
// pin fillForm's behaviour at the *render-core* boundary: when the FormMapping
// carries a real transform, the output PDF must contain the transformed
// value, not the raw input.

describe('fillForm — Oracle P2-A transform application', () => {
  // Re-use mantelPdf's `txt_first_name` text widget for date/currency cases
  // and `chk_married` for boolean. Citation/source-path are irrelevant to
  // the render core — only `transform` matters here.
  function mappingWith(
    transform: FormMapping['fields'][number]['transform'],
    opts?: {
      pdfField?: string;
      sourcePath?: string;
      type?: 'text' | 'number' | 'date' | 'checkbox';
    },
  ): FormMapping {
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
          pdfField: opts?.pdfField ?? 'txt_first_name',
          sourcePath: opts?.sourcePath ?? 'value',
          type: opts?.type ?? 'text',
          transform,
          citation: 'test',
        },
      ],
    };
  }

  async function readTextField(pdfBytes: Uint8Array, fieldName: string): Promise<string> {
    const pdf = await PDFDocument.load(pdfBytes);
    const form = pdf.getForm();
    return form.getTextField(fieldName).getText() ?? '';
  }

  it("format-date-de turns an ISO timestamp into German DD.MM.YYYY (was silently 'none' before P2-A)", async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: mappingWith('format-date-de', { type: 'date' }),
      data: { value: '2026-06-03T12:00:00.000Z' },
    });
    expect(result.filledFieldCount).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(await readTextField(result.pdfBytes, 'txt_first_name')).toBe('03.06.2026');
  });

  it('format-currency-eur formats a number as a EUR string', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: mappingWith('format-currency-eur', { type: 'number' }),
      data: { value: 1234.5 },
    });
    expect(result.filledFieldCount).toBe(1);
    // Output is a non-empty currency-shaped string with EUR sign and the
    // integer part; locale-specific separators are validated more loosely
    // so the test is portable across Node ICU builds.
    const out = await readTextField(result.pdfBytes, 'txt_first_name');
    expect(out).toMatch(/1[\.,\s]?234/);
    expect(out).toContain('€');
  });

  it("boolean-x maps truthy to 'X' on a checkbox field", async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: mappingWith('boolean-x', {
        pdfField: 'chk_married',
        type: 'checkbox',
      }),
      data: { value: true },
    });
    expect(result.filledFieldCount).toBe(1);
    expect(result.warnings).toEqual([]);
    // Checkbox round-trip: re-parse and assert the box is now checked.
    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getForm().getCheckBox('chk_married').isChecked()).toBe(true);
  });

  it("transform: 'none' is the inert default (raw value written verbatim)", async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: mappingWith('none', { type: 'text' }),
      data: { value: 'Hauptstrasse 1' },
    });
    expect(result.filledFieldCount).toBe(1);
    expect(await readTextField(result.pdfBytes, 'txt_first_name')).toBe('Hauptstrasse 1');
  });

  it('floor / round transforms produce integer strings (regression: previously both no-ops via hard-coded none)', async () => {
    const floored = await fillForm({
      pdfBytes: mantelPdf,
      mapping: mappingWith('floor', { type: 'number' }),
      data: { value: 42.9 },
    });
    expect(await readTextField(floored.pdfBytes, 'txt_first_name')).toBe('42');

    const rounded = await fillForm({
      pdfBytes: mantelPdf,
      mapping: mappingWith('round', { type: 'number' }),
      data: { value: 42.5 },
    });
    expect(await readTextField(rounded.pdfBytes, 'txt_first_name')).toBe('43');
  });

  it('format-date-iso turns a Date into ISO YYYY-MM-DD (complements format-date-de)', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: mappingWith('format-date-iso', { type: 'date' }),
      data: { value: '2026-06-03T12:00:00.000Z' },
    });
    expect(await readTextField(result.pdfBytes, 'txt_first_name')).toBe('2026-06-03');
  });

  it('format-currency-no-symbol formats a number without the € sign', async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: mappingWith('format-currency-no-symbol', { type: 'number' }),
      data: { value: 1234.5 },
    });
    const out = await readTextField(result.pdfBytes, 'txt_first_name');
    expect(out).toMatch(/1[\.,\s]?234/);
    expect(out).not.toContain('€');
  });

  it("boolean-x maps falsy to '' (unchecked) on a checkbox field", async () => {
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: mappingWith('boolean-x', {
        pdfField: 'chk_married',
        type: 'checkbox',
      }),
      data: { value: false },
    });
    expect(result.filledFieldCount).toBe(1);
    const pdf = await PDFDocument.load(result.pdfBytes);
    expect(pdf.getForm().getCheckBox('chk_married').isChecked()).toBe(false);
  });

  it("transform errors surface as 'transform-failed' warnings, not exceptions (resilience guarantee)", async () => {
    // boolean-x throws if the value isn't a boolean. The fill core MUST
    // catch and warn so one bad field cannot kill the whole render.
    const result = await fillForm({
      pdfBytes: mantelPdf,
      mapping: mappingWith('boolean-x', {
        pdfField: 'chk_married',
        type: 'checkbox',
      }),
      data: { value: 'not-a-boolean' },
    });
    expect(result.filledFieldCount).toBe(0);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]?.reason).toBe('transform-failed');
    expect(result.warnings[0]?.detail).toContain('boolean-x');
  });
});
