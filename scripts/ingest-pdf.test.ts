/**
 * ingest-pdf.test.ts — Unit tests for the PDF ingestion script.
 *
 * Tests sha256 stability, page count extraction, metadata extraction,
 * dry-run logic, and CLI argument parsing.
 * Does NOT test real R2/D1 uploads.
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

// Import functions under test
import {
  extractPageCount,
  extractMetadata,
  generateRegisterSql,
  parseCliArgs,
  ingest,
} from './ingest-pdf';
import type { IngestArgs, PdfMetadata } from './ingest-pdf';

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** Create a minimal valid-ish PDF buffer with a given page count */
function makeMinimalPdf(pageCount: number): Buffer {
  const header = '%PDF-1.4\n';
  const body = `1 0 obj\n<< /Type /Pages /Kids [] /Count ${pageCount} >>\nendobj\n`;
  const trailer = '%%EOF';
  return Buffer.from(header + body + trailer);
}

/** A real-ish PDF buffer (binary) with a Pages dict containing /Count */
function makeRealisticPdf(pageCount: number): Buffer {
  const content = Buffer.from(
    [
      '%PDF-1.7',
      '1 0 obj',
      `<< /Type /Pages /Kids [2 0 R 3 0 R] /Count ${pageCount} >>`,
      'endobj',
      '2 0 obj',
      '<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] >>',
      'endobj',
      '3 0 obj',
      '<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] >>',
      'endobj',
      'xref',
      'trailer',
      '<< /Size 4 /Root 1 0 R >>',
      '%%EOF',
    ].join('\n'),
    'binary',
  );
  return content;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('extractPageCount', () => {
  it('returns correct page count from minimal PDF', () => {
    const buf = makeMinimalPdf(3);
    expect(extractPageCount(buf)).toBe(3);
  });

  it('returns correct page count from realistic PDF', () => {
    const buf = makeRealisticPdf(7);
    expect(extractPageCount(buf)).toBe(7);
  });

  it('returns 1 for PDF with no /Count attribute', () => {
    const buf = Buffer.from('%PDF-1.4\n%%EOF');
    expect(extractPageCount(buf)).toBe(1);
  });

  it('returns max /Count when multiple /Count values exist', () => {
    // PDF with /Count in both Pages dict and individual page dicts
    const buf = Buffer.from(
      '%PDF-1.4\n/Type /Pages /Kids [] /Count 5\n/Type /Page /Count 2\n%%EOF',
      'binary',
    );
    expect(extractPageCount(buf)).toBe(5);
  });
});

describe('sha256 stability', () => {
  it('produces the same hash for the same buffer', () => {
    const buf = makeMinimalPdf(3);
    const hash1 = createHash('sha256').update(buf).digest('hex');
    const hash2 = createHash('sha256').update(buf).digest('hex');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different buffers', () => {
    const buf1 = makeMinimalPdf(1);
    const buf2 = makeMinimalPdf(2);
    const hash1 = createHash('sha256').update(buf1).digest('hex');
    const hash2 = createHash('sha256').update(buf2).digest('hex');
    expect(hash1).not.toBe(hash2);
  });
});

describe('extractMetadata', () => {
  const args: IngestArgs = {
    country: 'DE',
    year: 2024,
    form: 'mantelbogen',
    pdfPath: '/fake/path.pdf',
    dryRun: true,
  };

  it('returns correct r2Key and sha256', () => {
    const buf = makeMinimalPdf(5);
    const meta = extractMetadata(args, buf);

    expect(meta.r2Key).toBe('tax-forms/DE/2024/mantelbogen.pdf');
    expect(meta.sha256).toBe(createHash('sha256').update(buf).digest('hex'));
    expect(meta.pageCount).toBe(5);
    expect(meta.sizeBytes).toBe(buf.length);
  });

  it('returns consistent metadata for same input', () => {
    const buf = makeMinimalPdf(3);
    const meta1 = extractMetadata(args, buf);
    const meta2 = extractMetadata(args, buf);

    expect(meta1.sha256).toBe(meta2.sha256);
    expect(meta1.r2Key).toBe(meta2.r2Key);
    expect(meta1.pageCount).toBe(meta2.pageCount);
  });
});

describe('dry-run mode', () => {
  it('does not call uploadToR2 when dryRun is true', async () => {
    const uploadMock = vi.fn();
    const buf = makeMinimalPdf(3);

    // Write a temp file for ingest to read
    const { writeFile, unlink } = await import('node:fs/promises');
    const tmpPath = `scripts/__test_temp_${randomUUID()}.pdf`;
    await writeFile(tmpPath, buf);

    try {
      const result = await ingest(
        { country: 'DE', year: 2024, form: 'mantelbogen', pdfPath: tmpPath, dryRun: true },
        uploadMock,
      );

      expect(uploadMock).not.toHaveBeenCalled();
      expect(result.sha256).toBe(createHash('sha256').update(buf).digest('hex'));
      expect(result.r2Key).toBe('tax-forms/DE/2024/mantelbogen.pdf');
      expect(result.pageCount).toBe(3);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  });
});

describe('generateRegisterSql', () => {
  it('generates valid SQL with correct values', () => {
    const args: IngestArgs = { country: 'PT', year: 2024, form: 'modelo3', pdfPath: '/x.pdf', dryRun: false };
    const meta: PdfMetadata = {
      sha256: 'abc123',
      r2Key: 'tax-forms/PT/2024/modelo3.pdf',
      pageCount: 10,
      sizeBytes: 999,
    };

    const sql = generateRegisterSql(args, meta);

    expect(sql).toContain('INSERT INTO form_field_mappings');
    expect(sql).toContain("'PT'");
    expect(sql).toContain("'modelo3'");
    expect(sql).toContain('2024');
    expect(sql).toContain("'tax-forms/PT/2024/modelo3.pdf'");
    expect(sql).toContain("'abc123'");
    expect(sql).toContain('10');
    expect(sql).toContain('ON CONFLICT (country, form_type, tax_year, field_name)');
    expect(sql).toContain('__pdf__');
  });

  it('includes deleted_at = NULL to undelete on re-ingest', () => {
    const args: IngestArgs = { country: 'DE', year: 2024, form: 'mantelbogen', pdfPath: '/x.pdf', dryRun: false };
    const meta: PdfMetadata = {
      sha256: 'abc',
      r2Key: 'tax-forms/DE/2024/mantelbogen.pdf',
      pageCount: 3,
      sizeBytes: 100,
    };

    const sql = generateRegisterSql(args, meta);

    expect(sql).toMatch(/deleted_at\s*=\s*NULL/i);
  });

  it('escapes single quotes in values', () => {
    const args: IngestArgs = { country: "D'E", year: 2024, form: "mantel'bogen", pdfPath: '/x.pdf', dryRun: false };
    const meta: PdfMetadata = {
      sha256: "sha'256",
      r2Key: "tax-forms/D'E/2024/mantel'bogen.pdf",
      pageCount: 1,
      sizeBytes: 100,
    };

    const sql = generateRegisterSql(args, meta);

    // Single quotes should be doubled for SQL escaping
    expect(sql).toContain("'D''E'");
    expect(sql).toContain("'mantel''bogen'");
    expect(sql).toContain("'sha''256'");
  });
});

describe('parseCliArgs', () => {
  it('parses valid arguments correctly', () => {
    const result = parseCliArgs([
      '--country', 'DE',
      '--year', '2024',
      '--form', 'mantelbogen',
      '--pdf', './samples/de.pdf',
      '--dry-run',
    ]);

    expect(result.country).toBe('DE');
    expect(result.year).toBe(2024);
    expect(result.form).toBe('mantelbogen');
    expect(result.pdfPath).toBe('./samples/de.pdf');
    expect(result.dryRun).toBe(true);
  });

  it('sets dryRun to false when flag is absent', () => {
    const result = parseCliArgs([
      '--country', 'NL',
      '--year', '2024',
      '--form', 'aangifte',
      '--pdf', './samples/nl.pdf',
    ]);

    expect(result.dryRun).toBe(false);
  });

  it('throws when required args are missing', () => {
    expect(() => parseCliArgs(['--country', 'DE'])).toThrow('Missing required arguments');
  });
});
