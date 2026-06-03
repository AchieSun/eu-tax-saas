/**
 * extract-acroform-fields.test.ts — Unit tests for the AcroForm field extraction tool.
 *
 * Creates synthetic PDFs with AcroForm widgets and verifies extraction.
 * Does NOT test against real government PDFs (those are integration tests).
 */

import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { extractAcroFormFields, fieldsToYaml } from './extract-acroform-fields';

// ─── Fixtures ───────────────────────────────────────────────────────────────

async function buildTinyAcroFormPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  const form = pdf.getForm();

  const nameField = form.createTextField('TaxpayerName');
  nameField.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });

  const incomeField = form.createTextField('GrossIncome');
  incomeField.addToPage(page, { x: 50, y: 650, width: 100, height: 20 });

  const cb = form.createCheckBox('JointFiling');
  cb.addToPage(page, { x: 50, y: 600, width: 15, height: 15 });

  return pdf.save();
}

async function buildMultiPageAcroFormPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page1 = pdf.addPage([600, 800]);
  const page2 = pdf.addPage([600, 800]);
  const form = pdf.getForm();

  const field1 = form.createTextField('Page1Field');
  field1.addToPage(page1, { x: 100, y: 500, width: 150, height: 25 });

  const field2 = form.createTextField('Page2Field');
  field2.addToPage(page2, { x: 200, y: 400, width: 120, height: 20 });

  return pdf.save();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AcroForm field extraction CLI (W4 T1.2)', () => {
  it('extracts all AcroForm widgets from a synthetic PDF', async () => {
    const pdfBytes = await buildTinyAcroFormPdf();
    const fields = await extractAcroFormFields(pdfBytes);

    expect(fields.length).toBeGreaterThanOrEqual(3);
    const names = fields.map((f) => f.name);
    expect(names).toContain('TaxpayerName');
    expect(names).toContain('GrossIncome');
    expect(names).toContain('JointFiling');
  });

  it('captures rect coordinates and page index for each widget', async () => {
    const pdfBytes = await buildTinyAcroFormPdf();
    const fields = await extractAcroFormFields(pdfBytes);

    // pdf-lib serialises widget rects with up to ~1pt jitter for stroke half-width
    // and PDF-spec border padding. 2pt tolerance is well within the precision
    // useful for human-authored mappings (font size is typically 10pt+).
    const within2pt = (actual: number, expected: number) =>
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2);

    const nameField = fields.find((f) => f.name === 'TaxpayerName')!;
    expect(nameField).toBeDefined();
    expect(nameField.rect).toHaveLength(4);
    within2pt(nameField.rect[0], 50);
    within2pt(nameField.rect[1], 700);
    within2pt(nameField.rect[2], 200);
    within2pt(nameField.rect[3], 20);
    expect(nameField.page).toBeGreaterThanOrEqual(0);

    const incomeField = fields.find((f) => f.name === 'GrossIncome')!;
    expect(incomeField).toBeDefined();
    within2pt(incomeField.rect[0], 50);
    within2pt(incomeField.rect[1], 650);
    within2pt(incomeField.rect[2], 100);
    within2pt(incomeField.rect[3], 20);
  });

  it('detects page indices correctly for multi-page PDFs', async () => {
    const pdfBytes = await buildMultiPageAcroFormPdf();
    const fields = await extractAcroFormFields(pdfBytes);

    const page1Field = fields.find((f) => f.name === 'Page1Field')!;
    const page2Field = fields.find((f) => f.name === 'Page2Field')!;

    expect(page1Field).toBeDefined();
    expect(page2Field).toBeDefined();
    expect(page1Field.page).toBe(0);
    expect(page2Field.page).toBe(1);
  });

  it('yaml output is human-readable and contains all extracted fields', async () => {
    const pdfBytes = await buildTinyAcroFormPdf();
    const fields = await extractAcroFormFields(pdfBytes);
    const yaml = fieldsToYaml(fields, '/tmp/synthetic.pdf');

    expect(yaml).toContain('extracted_fields:');
    expect(yaml).toContain('TaxpayerName');
    expect(yaml).toContain('GrossIncome');
    expect(yaml).toContain('JointFiling');
    expect(yaml).toContain('# Hand-edit to add');
    expect(yaml).toContain('synthetic.pdf');
  });
});
