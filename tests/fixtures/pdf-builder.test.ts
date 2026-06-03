/**
 * pdf-builder.test.ts — Unit tests for the dynamic test-fixture PDF builder.
 *
 * Verifies that buildSynthPdfWithAcroForm and buildSynthPdfCoordOnly produce
 * valid, small PDFs that round-trip through pdf-lib's AcroForm reader.
 */

import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  buildSynthPdfWithAcroForm,
  buildSynthPdfCoordOnly,
  defaultMantelStyleFields,
} from './pdf-builder';

const MAX_FIXTURE_BYTES = 15_000;

describe('pdf-builder (W4 T3.0)', () => {
  it('buildSynthPdfWithAcroForm() returns a valid PDF (magic header) under 15KB', async () => {
    const bytes = await buildSynthPdfWithAcroForm();

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
    // %PDF magic header — guards downstream consumers that sniff by signature.
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
    // Bloat guard: empty-form fixtures should stay tiny.
    expect(bytes.length).toBeLessThan(MAX_FIXTURE_BYTES);
  });

  it('round-trips defaultMantelStyleFields(): 5 fields with expected names', async () => {
    const fields = defaultMantelStyleFields();
    const bytes = await buildSynthPdfWithAcroForm({ fields });

    const pdf = await PDFDocument.load(bytes);
    const form = pdf.getForm();
    const got = form.getFields();

    expect(got.length).toBe(5);

    const names = form.getFields().map((f) => f.getName());
    expect(names).toContain('txt_first_name');
    expect(names).toContain('txt_last_name');
    expect(names).toContain('txt_tax_id');
    expect(names).toContain('txt_address_line1');
    expect(names).toContain('chk_married');
  });

  it('preserves text-field defaultValue on round-trip', async () => {
    const bytes = await buildSynthPdfWithAcroForm({
      fields: [
        {
          name: 'txt_greeting',
          kind: 'text',
          x: 50,
          y: 700,
          width: 200,
          height: 20,
          defaultValue: 'Guten Tag',
        },
      ],
    });

    const pdf = await PDFDocument.load(bytes);
    const tf = pdf.getForm().getTextField('txt_greeting');
    expect(tf.getText()).toBe('Guten Tag');
  });

  it('checkbox defaultValue "true" round-trips as checked', async () => {
    const bytes = await buildSynthPdfWithAcroForm({
      fields: [
        {
          name: 'chk_agree',
          kind: 'checkbox',
          x: 50,
          y: 650,
          width: 14,
          height: 14,
          defaultValue: 'true',
        },
      ],
    });

    const pdf = await PDFDocument.load(bytes);
    const cb = pdf.getForm().getCheckBox('chk_agree');
    expect(cb.isChecked()).toBe(true);
  });

  it('places a field on the requested page in a multi-page document', async () => {
    const bytes = await buildSynthPdfWithAcroForm({
      pageCount: 3,
      fields: [
        {
          name: 'txt_on_last_page',
          kind: 'text',
          x: 100,
          y: 500,
          width: 150,
          height: 20,
          page: 2,
        },
      ],
    });

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);

    const form = pdf.getForm();
    const field = form.getTextField('txt_on_last_page');
    const widgets = field.acroField.getWidgets();
    expect(widgets.length).toBe(1);

    const widgetPageRef = widgets[0].P();
    const pages = pdf.getPages();
    let foundIndex = -1;
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].ref === widgetPageRef) {
        foundIndex = i;
        break;
      }
    }
    expect(foundIndex).toBe(2);
  });

  it('buildSynthPdfCoordOnly() produces a valid PDF with 0 AcroForm fields', async () => {
    const bytes = await buildSynthPdfCoordOnly();

    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
    expect(bytes.length).toBeLessThan(MAX_FIXTURE_BYTES);

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getForm().getFields().length).toBe(0);
  });
});
