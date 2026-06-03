/**
 * ingest-form-mappings.test.ts — W4 T1.4
 *
 * Unit tests for the pure SQL emitter in ingest-form-mappings.ts.
 *
 * We never exercise D1, wrangler, or the filesystem walk (covered transitively
 * by the loader's own tests). What we lock down here is the shape and safety
 * of the emitted SQL: header counts, transaction wrapping, ON CONFLICT clause,
 * undelete, quote escaping, null-byte rejection, and coordinate vs AcroForm
 * column population.
 */

import { describe, it, expect } from 'vitest';
import {
  generateIngestSql,
  mappingToSql,
  sqlEscape,
  sqlValue,
  parseCliArgs,
} from './ingest-form-mappings';
import type { FormMapping } from '../src/forms/types';

// ─── Fixture ────────────────────────────────────────────────────────────────

const fixtureMapping: FormMapping = {
  country: 'DE',
  year: 2024,
  form: 'test-form',
  formTitle: 'Test Form',
  sourceUrl: 'https://example.com/test.pdf',
  sourceVersion: 'TEST-v1',
  fields: [
    {
      kind: 'acroform',
      pdfField: 'TaxpayerName',
      sourcePath: 'user.profile.name',
      type: 'text',
      transform: 'none',
      citation: 'BMF Mantelbogen 2024 page 1',
    },
    {
      kind: 'coordinate',
      sourcePath: 'user.profile.address.city',
      type: 'text',
      transform: 'none',
      citation: 'BMF Mantelbogen 2024 page 2 box 33',
      page: 1,
      x: 150.5,
      y: 700,
      fontSize: 10,
    },
  ],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('sqlEscape / sqlValue', () => {
  it('wraps strings in single quotes and doubles internal quotes', () => {
    expect(sqlEscape("O'Brien")).toBe("'O''Brien'");
    expect(sqlEscape('plain')).toBe("'plain'");
  });

  it('rejects null bytes', () => {
    expect(() => sqlEscape('evil\0value')).toThrow(/null byte/i);
  });

  it('formats numbers, NULL, and undefined', () => {
    expect(sqlValue(null)).toBe('NULL');
    expect(sqlValue(undefined)).toBe('NULL');
    expect(sqlValue(42)).toBe('42');
    expect(sqlValue(150.5)).toBe('150.5');
    expect(sqlValue('hi')).toBe("'hi'");
  });

  it('rejects non-finite numbers', () => {
    expect(() => sqlValue(Number.NaN)).toThrow(/non-finite/i);
    expect(() => sqlValue(Number.POSITIVE_INFINITY)).toThrow(/non-finite/i);
  });
});

describe('generateIngestSql — structural invariants', () => {
  it('emits an INSERT per field', () => {
    const sql = generateIngestSql([fixtureMapping]);
    const inserts = sql.match(/INSERT INTO form_field_mappings/g) ?? [];
    expect(inserts.length).toBe(2);
  });

  it('wraps the script in a single BEGIN/COMMIT transaction', () => {
    const sql = generateIngestSql([fixtureMapping]);
    expect(sql.match(/BEGIN TRANSACTION;/g)?.length).toBe(1);
    expect(sql.match(/^COMMIT;$/gm)?.length).toBe(1);
  });

  it('uses ON CONFLICT keyed on the unique index columns', () => {
    const sql = generateIngestSql([fixtureMapping]);
    // Must match schema.ts: idx_form_field_unique on
    // (country, form_type, tax_year, field_name)
    expect(sql).toContain(
      'ON CONFLICT(country, form_type, tax_year, field_name) DO UPDATE',
    );
  });

  it('undeletes existing rows on conflict (deleted_at = NULL)', () => {
    const sql = generateIngestSql([fixtureMapping]);
    expect(sql).toContain('deleted_at = NULL');
  });

  it('produces a header with the mapping and field counts', () => {
    const sql = generateIngestSql([fixtureMapping]);
    expect(sql).toMatch(/-- 1 mapping\(s\), 2 field\(s\) total/);
  });

  it('handles empty input gracefully (header + empty txn, no INSERTs)', () => {
    const sql = generateIngestSql([]);
    expect(sql).toMatch(/-- 0 mapping\(s\), 0 field\(s\) total/);
    expect(sql).toContain('BEGIN TRANSACTION;');
    expect(sql).toContain('COMMIT;');
    expect(sql).not.toContain('INSERT INTO form_field_mappings');
  });

  it('does NOT touch pdf_r2_key / pdf_sha256 / page_count on UPDATE', () => {
    // These columns are owned by ingest-pdf.ts. We must not clobber them
    // when re-running the YAML→D1 sync.
    const sql = generateIngestSql([fixtureMapping]);
    const updateClause = sql.slice(sql.indexOf('DO UPDATE SET'));
    expect(updateClause).not.toMatch(/pdf_r2_key\s*=/);
    expect(updateClause).not.toMatch(/pdf_sha256\s*=/);
    expect(updateClause).not.toMatch(/page_count\s*=/);
  });
});

describe('generateIngestSql — value safety', () => {
  it('escapes single quotes in string values', () => {
    const mapping: FormMapping = {
      ...fixtureMapping,
      fields: [
        {
          kind: 'acroform',
          pdfField: "Field's Name",
          sourcePath: 'user.profile.name',
          type: 'text',
          transform: 'none',
          citation: "Test's citation",
        },
      ],
    };
    const sql = generateIngestSql([mapping]);
    expect(sql).toContain("'Field''s Name'");
  });

  it('rejects null byte injection in field names', () => {
    const mapping: FormMapping = {
      ...fixtureMapping,
      fields: [
        {
          kind: 'acroform',
          pdfField: 'Evil\0Field',
          sourcePath: 'user.profile.name',
          type: 'text',
          transform: 'none',
          citation: 'test',
        },
      ],
    };
    expect(() => generateIngestSql([mapping])).toThrow(/null byte/i);
  });
});

describe('generateIngestSql — acroform vs coordinate columns', () => {
  it('populates x_coord / y_coord / page_number on coordinate fields, NULLs them on AcroForm', () => {
    const lines = generateIngestSql([fixtureMapping]).split('\n');

    const acroLine = lines.find((l) => l.includes("'TaxpayerName'"));
    expect(acroLine).toBeDefined();
    // Coordinate columns and font_size should be NULL for AcroForm.
    // VALUES segment shape (positions for page_number, x, y, font_size):
    //   ..., NULL, NULL, NULL, NULL, 'acroform', NULL)
    expect(acroLine!).toMatch(/NULL,\s*NULL,\s*NULL,\s*NULL,\s*'acroform',\s*NULL\)/);

    const coordLine = lines.find((l) => l.includes('150.5'));
    expect(coordLine).toBeDefined();
    expect(coordLine!).toContain('150.5');
    expect(coordLine!).toContain('700');
    expect(coordLine!).toContain("'coordinate'");
  });

  it('synthesises a deterministic field_name for coordinate fields', () => {
    const sql = generateIngestSql([fixtureMapping]);
    // user.profile.address.city -> coord_user_profile_address_city
    expect(sql).toContain("'coord_user_profile_address_city'");
  });

  it('uses a deterministic composite id so re-runs hit the same row', () => {
    const sql1 = generateIngestSql([fixtureMapping]);
    const sql2 = generateIngestSql([fixtureMapping]);
    // Same input → byte-identical output (except for environmental timestamps,
    // which we deliberately did not include).
    expect(sql1).toBe(sql2);
    expect(sql1).toContain("'DE-2024-test-form-TaxpayerName'");
    expect(sql1).toContain("'DE-2024-test-form-coord_user_profile_address_city'");
  });
});

describe('mappingToSql — column ordering matches schema', () => {
  it('lists columns in the exact order the VALUES clause expects', () => {
    const stmts = mappingToSql(fixtureMapping);
    expect(stmts.length).toBe(2);
    for (const stmt of stmts) {
      expect(stmt).toContain(
        '(id, country, form_type, tax_year, field_name, data_path, field_type, ' +
          'page_number, x_coord, y_coord, font_size, field_kind, deleted_at)',
      );
    }
  });
});

describe('parseCliArgs', () => {
  it('defaults outPath to null and forms-root to <scriptDir>/../src/forms', () => {
    const opts = parseCliArgs([], '/repo/app/scripts');
    expect(opts.outPath).toBeNull();
    // resolve() normalises separators per-platform — check the tail.
    expect(opts.formsRoot.replace(/\\/g, '/')).toMatch(/\/repo\/app\/src\/forms$/);
  });

  it('parses --out as an absolute path', () => {
    const opts = parseCliArgs(['--out', 'forms.sql'], '/repo/app/scripts');
    expect(opts.outPath).not.toBeNull();
    expect(opts.outPath!.endsWith('forms.sql')).toBe(true);
  });

  it('throws when --out has no value or another flag follows', () => {
    expect(() => parseCliArgs(['--out'], '/scripts')).toThrow(/Missing value/);
    expect(() => parseCliArgs(['--out', '--something'], '/scripts')).toThrow(
      /Missing value/,
    );
  });
});
