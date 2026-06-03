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
  generateIngestSqlWithVersions,
  emitVersionInsert,
  emitVersionIdUpdate,
  mappingToSql,
  sqlEscape,
  sqlValue,
  parseCliArgs,
} from './ingest-form-mappings';
import { canonicalJSONHash } from '../src/forms/hash';
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

// ─── W4 T0.5 — mapping versions ─────────────────────────────────────────────

describe('generateIngestSqlWithVersions — version row + version_id back-fill', () => {
  // Fixed clock so the generated SQL is byte-deterministic across calls.
  const FIXED_NOW = 1_780_000_000_000;

  it('fresh ingest emits a version-insert + field INSERTs + version_id back-fill UPDATE', async () => {
    const sql = await generateIngestSqlWithVersions([fixtureMapping], FIXED_NOW);
    const hash = await canonicalJSONHash(fixtureMapping);

    // 1. Version-insert statement is present, scoped to (DE, test-form, 2024)
    //    and carries the canonical content_hash + created_at = FIXED_NOW.
    expect(sql).toContain('INSERT INTO form_mapping_versions');
    expect(sql).toContain(`'${hash}'`);
    expect(sql).toContain(String(FIXED_NOW));
    expect(sql).toContain("country = 'DE'");
    expect(sql).toContain("form_type = 'test-form'");
    expect(sql).toContain('tax_year = 2024');
    // 2. Idempotency guard baked in (WHERE NOT EXISTS w/ latest-hash check).
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).toContain('MAX(version)');
    // 3. Field-row INSERTs still emitted (one per field) and column shape
    //    is UNCHANGED — version_id is set by the trailing UPDATE.
    const fieldInserts = sql.match(/INSERT INTO form_field_mappings/g) ?? [];
    expect(fieldInserts.length).toBe(fixtureMapping.fields.length);
    // 4. UPDATE form_field_mappings ... SET version_id = (SELECT id ...) is
    //    emitted after the field INSERTs.
    expect(sql).toMatch(
      /UPDATE form_field_mappings SET version_id = \(SELECT id FROM form_mapping_versions/,
    );
    // 5. The back-fill targets the same (country, form_type, tax_year) tuple
    //    and skips soft-deleted rows.
    expect(sql).toContain('deleted_at IS NULL');
    // 6. Transaction wrapping preserved.
    expect(sql.match(/BEGIN TRANSACTION;/g)?.length).toBe(1);
    expect(sql.match(/^COMMIT;$/gm)?.length).toBe(1);
  });

  it('re-ingesting IDENTICAL content produces byte-identical SQL with the same hash and the NOT-EXISTS guard preventing duplicate rows', async () => {
    // Same input + same clock → byte-identical output. The NOT EXISTS guard
    // in `emitVersionInsert` is what prevents a second version row from being
    // written when this SQL is executed against an already-populated D1.
    const sqlA = await generateIngestSqlWithVersions([fixtureMapping], FIXED_NOW);
    const sqlB = await generateIngestSqlWithVersions([fixtureMapping], FIXED_NOW);
    expect(sqlA).toBe(sqlB);

    // Sanity: re-ordering object keys at the YAML→object boundary must not
    // change the emitted hash (covered exhaustively in hash.test.ts; we
    // re-check end-to-end here that ingest plumbing preserves that).
    const reorderedFixture: FormMapping = {
      fields: fixtureMapping.fields,
      form: fixtureMapping.form,
      formTitle: fixtureMapping.formTitle,
      sourceUrl: fixtureMapping.sourceUrl,
      sourceVersion: fixtureMapping.sourceVersion,
      year: fixtureMapping.year,
      country: fixtureMapping.country,
    };
    const sqlReordered = await generateIngestSqlWithVersions(
      [reorderedFixture],
      FIXED_NOW,
    );
    const hash = await canonicalJSONHash(fixtureMapping);
    expect(sqlReordered).toContain(`'${hash}'`);
    expect(sqlA).toContain(`'${hash}'`);

    // The NOT-EXISTS guard literally references the same hash, so when the
    // latest stored row's content_hash matches, the INSERT ... SELECT yields
    // zero rows and no version row is appended.
    expect(sqlA).toMatch(
      /WHERE NOT EXISTS \(SELECT 1 FROM form_mapping_versions WHERE [^)]+content_hash = '[0-9a-f]{64}'/,
    );
  });

  it('re-ingesting CHANGED content emits a different hash; back-fill UPDATE then re-points field rows at the new version', async () => {
    const mutated: FormMapping = {
      ...fixtureMapping,
      fields: [
        {
          ...fixtureMapping.fields[0],
          // Flip a leaf value — must change the canonical hash.
          citation: 'BMF Mantelbogen 2024 page 1 — REVISED',
        } as FormMapping['fields'][number],
        fixtureMapping.fields[1],
      ],
    };

    const hashOriginal = await canonicalJSONHash(fixtureMapping);
    const hashMutated = await canonicalJSONHash(mutated);
    expect(hashOriginal).not.toBe(hashMutated);

    const sqlOriginal = await generateIngestSqlWithVersions(
      [fixtureMapping],
      FIXED_NOW,
    );
    const sqlMutated = await generateIngestSqlWithVersions([mutated], FIXED_NOW);

    // The new SQL carries the new hash, not the old one.
    expect(sqlMutated).toContain(`'${hashMutated}'`);
    expect(sqlMutated).not.toContain(`'${hashOriginal}'`);

    // Both runs emit the same back-fill UPDATE (it points at "latest
    // version" via subquery, so the same DDL works for v1 and v2 alike).
    const backfillRe =
      /UPDATE form_field_mappings SET version_id = \(SELECT id FROM form_mapping_versions WHERE country = 'DE' AND form_type = 'test-form' AND tax_year = 2024 ORDER BY version DESC LIMIT 1\)/;
    expect(sqlOriginal).toMatch(backfillRe);
    expect(sqlMutated).toMatch(backfillRe);

    // emitVersionInsert directly: changed input → different statement bytes.
    const stmtOriginal = emitVersionInsert(
      fixtureMapping,
      hashOriginal,
      FIXED_NOW,
    );
    const stmtMutated = emitVersionInsert(mutated, hashMutated, FIXED_NOW);
    expect(stmtOriginal).not.toBe(stmtMutated);
  });

  it('emitVersionInsert validates inputs and yields deterministic, escape-safe SQL', async () => {
    const hash = await canonicalJSONHash(fixtureMapping);

    // Determinism: same inputs → byte-identical statement.
    const a = emitVersionInsert(fixtureMapping, hash, FIXED_NOW);
    const b = emitVersionInsert(fixtureMapping, hash, FIXED_NOW);
    expect(a).toBe(b);

    // Hash is a 64-char hex SHA-256 digest — anything else must be rejected
    // (catches us if a caller ever passes a truncated / base64 / labelled
    // hash by mistake).
    expect(() => emitVersionInsert(fixtureMapping, 'not-a-hash', FIXED_NOW)).toThrow(
      /64-char hex/,
    );
    expect(() =>
      emitVersionInsert(fixtureMapping, hash.toUpperCase(), FIXED_NOW),
    ).toThrow(/64-char hex/);

    // nowMs must be a non-negative integer.
    expect(() => emitVersionInsert(fixtureMapping, hash, -1)).toThrow(/non-negative/);
    expect(() => emitVersionInsert(fixtureMapping, hash, 1.5)).toThrow(/non-negative/);

    // emitVersionIdUpdate is a single UPDATE statement scoped by the tuple
    // and the soft-delete filter.
    const upd = emitVersionIdUpdate(fixtureMapping);
    expect(upd.startsWith('UPDATE form_field_mappings SET version_id = ')).toBe(true);
    expect(upd).toContain("country = 'DE'");
    expect(upd).toContain("form_type = 'test-form'");
    expect(upd).toContain('tax_year = 2024');
    expect(upd).toContain('deleted_at IS NULL');
    expect(upd.trim().endsWith(';')).toBe(true);
  });
});

// ─── W4 T1.3b — DE Mantelbogen end-to-end SQL emission ──────────────────────

describe('generateIngestSqlWithVersions — DE 2024 Mantelbogen (W4 T1.3b)', () => {
  const FIXED_NOW = 1_780_000_000_000;

  // 20-field mapping mirroring app/src/forms/DE/2024/mantelbogen.yml. Inlined
  // here so the test does not need filesystem I/O (this file is the unit-test
  // for the pure emitter); end-to-end YAML loading is covered by load.test.ts.
  const mantelbogenMapping: FormMapping = {
    country: 'DE',
    year: 2024,
    form: 'mantelbogen',
    formTitle: 'Einkommensteuer Hauptvordruck (Mantelbogen) ESt 1 A 2024',
    sourceUrl:
      'https://www.formulare-bfinv.de/ffw/action/invoke.do?id=034037_24',
    sourceVersion:
      'BMF 2024 Rev 2024ESt1A011NET (Sep 2024) — coordinates UNVERIFIED until real PDF acquired',
    fields: Array.from({ length: 20 }, (_, i) => ({
      kind: 'acroform' as const,
      pdfField: `TBD_field_${i + 1}`,
      sourcePath: `user.profile.field${i + 1}`,
      type: 'text' as const,
      transform: 'none' as const,
      citation: `§ 25 EStG — Zeile ${i + 1} (T1.3b)`,
    })),
  };

  it('emits version-insert + ≥20 field INSERTs + version_id UPDATE in one transaction', async () => {
    const sql = await generateIngestSqlWithVersions(
      [mantelbogenMapping],
      FIXED_NOW,
    );

    // 1. Single version-insert statement scoped to (DE, mantelbogen, 2024).
    expect(sql.match(/INSERT INTO form_mapping_versions/g)?.length).toBe(1);
    expect(sql).toContain("country = 'DE'");
    expect(sql).toContain("form_type = 'mantelbogen'");
    expect(sql).toContain('tax_year = 2024');

    // 2. At least 20 field INSERTs (one per documented Mantelbogen field).
    const fieldInserts = sql.match(/INSERT INTO form_field_mappings/g) ?? [];
    expect(fieldInserts.length).toBeGreaterThanOrEqual(20);

    // 3. Trailing version_id back-fill UPDATE present and tuple-scoped.
    expect(sql).toMatch(
      /UPDATE form_field_mappings SET version_id = \(SELECT id FROM form_mapping_versions WHERE country = 'DE' AND form_type = 'mantelbogen' AND tax_year = 2024 ORDER BY version DESC LIMIT 1\)/,
    );

    // 4. One BEGIN / COMMIT pair wraps everything.
    expect(sql.match(/BEGIN TRANSACTION;/g)?.length).toBe(1);
    expect(sql.match(/^COMMIT;$/gm)?.length).toBe(1);
  });
});
