/**
 * ingest-form-mappings.ts — W4 T1.4
 *
 * Pure SQL emitter: reads every production YAML mapping under
 * `app/src/forms/<COUNTRY>/<YEAR>/<form>.yml` and prints an idempotent
 * `INSERT ... ON CONFLICT ... DO UPDATE` script to stdout (or `--out FILE`).
 *
 * The emitted SQL is intended to be fed into D1:
 *
 *   pnpm ingest:form-mappings -- --out /tmp/forms.sql
 *   wrangler d1 execute eu-tax-saas-db --local --file=/tmp/forms.sql
 *
 * Design notes:
 *   - We never connect to D1 from here. Same emitter style as ingest-pdf.ts.
 *   - Idempotency comes from the `idx_form_field_unique` unique index defined
 *     in src/db/schema.ts: (country, form_type, tax_year, field_name).
 *     The ON CONFLICT clause MUST match these four columns in this order.
 *   - The CLI does NOT use `loadAllMappings()` directly because that helper
 *     relies on Vite's `import.meta.glob`, which is unavailable under raw
 *     `tsx` / Node. Instead we walk the filesystem and delegate parsing to
 *     `parseFormMapping()` from src/forms/load.ts (a pure helper).
 *   - `generateIngestSql()` is exported and pure — it is the unit under test.
 *
 * SQL safety: all string values are escaped (single quotes doubled) and null
 * bytes are rejected. Values originate from author-written YAML, but defence
 * in depth is cheap.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { canonicalJSONHash } from '../src/forms/hash';
import { parseFormMapping } from '../src/forms/load';
import type { FormMapping } from '../src/forms/types';

// ─── SQL value helpers ──────────────────────────────────────────────────────

/**
 * SQLite string literal escape: wrap in single quotes and double any embedded
 * single quote. Reject embedded null bytes — sqlite truncates on \0 and we
 * never want a silent half-string write into D1.
 */
export function sqlEscape(s: string): string {
  if (s.includes('\0')) {
    throw new Error(`SQL injection guard: null byte in value '${s.slice(0, 40)}'`);
  }
  return `'${s.replace(/'/g, "''")}'`;
}

/** Format a JS value as a SQL literal. */
export function sqlValue(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`Non-finite number cannot be serialised to SQL: ${v}`);
    }
    return String(v);
  }
  return sqlEscape(v);
}

// ─── Field name derivation ──────────────────────────────────────────────────

/**
 * Derive a stable `field_name` value for a coordinate field. AcroForm fields
 * already have a `pdfField` name; coordinate fields don't, so we synthesise
 * one from `sourcePath` so the row remains addressable and the unique index
 * (country, form_type, tax_year, field_name) keeps holding.
 */
function fieldNameOf(field: FormMapping['fields'][number]): string {
  if (field.kind === 'acroform') return field.pdfField;
  // coord_user_profile_address_city
  return `coord_${field.sourcePath.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

// ─── Per-mapping SQL ────────────────────────────────────────────────────────

/**
 * Emit one `INSERT ... ON CONFLICT ... DO UPDATE` statement per field.
 *
 * Columns covered (NOT NULL ones must be present):
 *   id                  text PK         (deterministic composite key)
 *   country             text NOT NULL
 *   form_type           text NOT NULL   ← YAML `form`
 *   tax_year            integer NOT NULL ← YAML `year`
 *   field_name          text NOT NULL
 *   data_path           text NOT NULL   ← YAML `sourcePath`
 *   field_type          text NOT NULL DEFAULT 'text' ← YAML `type`
 *   page_number         integer NULL
 *   x_coord             real NULL
 *   y_coord             real NULL
 *   font_size           real NULL
 *   field_kind          text NOT NULL DEFAULT 'acroform' ← YAML `kind`
 *   transform           text NOT NULL DEFAULT 'none'    ← YAML `transform`
 *                       (Oracle P2-A: source of truth for render-time
 *                       value formatting. Skipping this column would silently
 *                       degrade every numeric/date/boolean field back to
 *                       `'none'`, so `format-date-de` becomes a no-op.)
 *   deleted_at          integer NULL    (Unix ms — set to NULL to undelete)
 *
 * Columns intentionally left to DB defaults / nulls:
 *   field_label, box_number, notes, pdf_r2_key, pdf_sha256, page_count
 *   (`pdf_r2_key`, `pdf_sha256`, `page_count` are owned by ingest-pdf.ts;
 *   we must NOT overwrite them on conflict.)
 */
export function mappingToSql(mapping: FormMapping): string[] {
  const lines: string[] = [];
  for (const field of mapping.fields) {
    const isAcroform = field.kind === 'acroform';
    const fieldName = fieldNameOf(field);
    const dataPath = field.sourcePath;
    const fieldType = field.type;
    const pageNumber = isAcroform ? 'NULL' : sqlValue(field.page);
    const xCoord = isAcroform ? 'NULL' : sqlValue(field.x);
    const yCoord = isAcroform ? 'NULL' : sqlValue(field.y);
    const fontSize = field.fontSize !== undefined ? sqlValue(field.fontSize) : 'NULL';
    // Oracle P2-A (W4 review): backfill `transform` from the YAML. The
    // Zod `TransformSchema` defaults to `'none'` at parse time, so this
    // is always a valid enum value — no extra validation needed. Until
    // this landed, the route hard-coded `'none'` per field which silently
    // turned `format-date-de` etc. into no-ops.
    const transform = sqlValue(field.transform);
    // Deterministic composite id so re-runs hit the same row.
    const id = `${mapping.country}-${mapping.year}-${mapping.form}-${fieldName}`;

    lines.push(
      `INSERT INTO form_field_mappings (id, country, form_type, tax_year, field_name, data_path, field_type, page_number, x_coord, y_coord, font_size, field_kind, transform, deleted_at) VALUES (${sqlEscape(id)}, ${sqlEscape(mapping.country)}, ${sqlEscape(mapping.form)}, ${mapping.year}, ${sqlEscape(fieldName)}, ${sqlEscape(dataPath)}, ${sqlEscape(fieldType)}, ${pageNumber}, ${xCoord}, ${yCoord}, ${fontSize}, ${sqlEscape(field.kind)}, ${transform}, NULL) ON CONFLICT(country, form_type, tax_year, field_name) DO UPDATE SET data_path = excluded.data_path, field_type = excluded.field_type, page_number = excluded.page_number, x_coord = excluded.x_coord, y_coord = excluded.y_coord, font_size = excluded.font_size, field_kind = excluded.field_kind, transform = excluded.transform, deleted_at = NULL;`,
    );
  }
  return lines;
}

// ─── Top-level SQL composition ──────────────────────────────────────────────

/**
 * Pure: turn an array of validated FormMappings into a complete idempotent
 * SQL script wrapped in a single transaction. Exported for unit tests.
 */
export function generateIngestSql(mappings: FormMapping[]): string {
  const fieldTotal = mappings.reduce((s, m) => s + m.fields.length, 0);
  const header = [
    '-- Auto-generated by app/scripts/ingest-form-mappings.ts',
    `-- ${mappings.length} mapping(s), ${fieldTotal} field(s) total`,
    '-- Idempotent: safe to re-run. ON CONFLICT updates + undeletes (deleted_at = NULL).',
    '-- Unique key: (country, form_type, tax_year, field_name) — see schema.ts idx_form_field_unique.',
    '',
    'BEGIN TRANSACTION;',
    '',
  ];
  const body: string[] = [];
  for (const m of mappings) {
    body.push(`-- ${m.country} ${m.year} ${m.form} (${m.fields.length} field(s))`);
    body.push(...mappingToSql(m));
    body.push('');
  }
  const footer = ['COMMIT;', ''];
  return [...header, ...body, ...footer].join('\n');
}

// ─── W4 T0.5 — version row + version_id back-fill (pure SQL emitters) ──────

/**
 * Emit the SQL that, executed against D1, conditionally inserts a new row
 * into `form_mapping_versions` for `mapping` with `contentHash`.
 *
 * Semantics enforced in SQL (no DB roundtrip needed at emit time):
 *   - `version` = (current MAX(version) for the (country, form_type, tax_year)
 *     tuple) + 1, falling back to 1 when no prior row exists.
 *   - If the LATEST existing row for this tuple already has `content_hash`
 *     equal to `contentHash`, **no row is inserted** (idempotent re-ingest).
 *   - `created_at` is taken from `nowMs` (caller passes Date.now() — kept
 *     injectable so tests get deterministic output).
 *
 * Returns one SQL statement; the new row's id can be retrieved by
 * `(SELECT id FROM form_mapping_versions WHERE country=… ORDER BY version DESC LIMIT 1)`
 * — which is exactly what `emitVersionIdUpdate()` uses to back-fill the
 * `version_id` column on the field rows.
 */
export function emitVersionInsert(
  mapping: FormMapping,
  contentHash: string,
  nowMs: number,
): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    throw new Error(
      `emitVersionInsert: contentHash must be a 64-char hex SHA-256 digest, got '${contentHash.slice(0, 32)}…'`,
    );
  }
  if (!Number.isInteger(nowMs) || nowMs < 0) {
    throw new Error(`emitVersionInsert: nowMs must be a non-negative integer, got ${nowMs}`);
  }
  const country = sqlEscape(mapping.country);
  const formType = sqlEscape(mapping.form);
  const taxYear = mapping.year;
  const hash = sqlEscape(contentHash);
  // SQLite trick: INSERT ... SELECT ... WHERE NOT EXISTS lets us bake the
  // "skip if latest hash matches" guard into a single statement, so the
  // emitted script stays connection-free.
  return `INSERT INTO form_mapping_versions (country, form_type, tax_year, version, content_hash, created_at) SELECT ${country}, ${formType}, ${taxYear}, COALESCE((SELECT MAX(version) FROM form_mapping_versions WHERE country = ${country} AND form_type = ${formType} AND tax_year = ${taxYear}), 0) + 1, ${hash}, ${nowMs} WHERE NOT EXISTS (SELECT 1 FROM form_mapping_versions WHERE country = ${country} AND form_type = ${formType} AND tax_year = ${taxYear} AND content_hash = ${hash} AND version = (SELECT MAX(version) FROM form_mapping_versions WHERE country = ${country} AND form_type = ${formType} AND tax_year = ${taxYear}));`;
}

/**
 * Emit the SQL that back-fills the `version_id` column on every
 * `form_field_mappings` row belonging to `mapping`, pointing them at the
 * currently-latest version for the same (country, form_type, tax_year) tuple.
 *
 * Designed to run AFTER `emitVersionInsert()` in the same transaction:
 *   - If a new version row was just inserted → field rows get the new id.
 *   - If the version row was skipped (identical content) → field rows get
 *     the same id they already had → effective no-op.
 *
 * We do NOT touch soft-deleted rows (deleted_at IS NOT NULL); their
 * `version_id` is left as-is to preserve audit history.
 */
export function emitVersionIdUpdate(mapping: FormMapping): string {
  const country = sqlEscape(mapping.country);
  const formType = sqlEscape(mapping.form);
  const taxYear = mapping.year;
  return `UPDATE form_field_mappings SET version_id = (SELECT id FROM form_mapping_versions WHERE country = ${country} AND form_type = ${formType} AND tax_year = ${taxYear} ORDER BY version DESC LIMIT 1) WHERE country = ${country} AND form_type = ${formType} AND tax_year = ${taxYear} AND deleted_at IS NULL;`;
}

/**
 * Version-aware variant of `generateIngestSql`. Wraps the per-mapping
 * field-INSERTs with:
 *   1. `emitVersionInsert(mapping, hash, nowMs)` — conditional version row
 *   2. existing field-row INSERTs (unchanged column list, idempotent)
 *   3. `emitVersionIdUpdate(mapping)` — back-fill version_id on field rows
 *
 * The result is one BEGIN/COMMIT transaction. Hashes are computed with
 * `canonicalJSONHash()` so they are stable across key-order permutations.
 */
export async function generateIngestSqlWithVersions(
  mappings: FormMapping[],
  nowMs: number,
): Promise<string> {
  const fieldTotal = mappings.reduce((s, m) => s + m.fields.length, 0);
  const header = [
    '-- Auto-generated by app/scripts/ingest-form-mappings.ts (W4 T0.5 version-aware)',
    `-- ${mappings.length} mapping(s), ${fieldTotal} field(s) total`,
    '-- Idempotent: safe to re-run. New version row inserted only when content hash changes.',
    '-- Unique key: (country, form_type, tax_year, field_name) — see schema.ts idx_form_field_unique.',
    '',
    'BEGIN TRANSACTION;',
    '',
  ];
  const body: string[] = [];
  for (const m of mappings) {
    const hash = await canonicalJSONHash(m);
    body.push(`-- ${m.country} ${m.year} ${m.form} (${m.fields.length} field(s)) hash=${hash}`);
    body.push(emitVersionInsert(m, hash, nowMs));
    body.push(...mappingToSql(m));
    body.push(emitVersionIdUpdate(m));
    body.push('');
  }
  const footer = ['COMMIT;', ''];
  return [...header, ...body, ...footer].join('\n');
}

// ─── Filesystem loader (Node, no Vite) ──────────────────────────────────────

/**
 * Recursively collect every `*.yml` file under `root` except those in
 * `__fixtures__` directories. Returns absolute paths.
 *
 * We do this in pure Node rather than reusing `loadAllMappings()` from
 * src/forms/load.ts because that helper relies on Vite's `import.meta.glob`,
 * which is not available under raw `tsx`. Parsing is still delegated to
 * `parseFormMapping()` so the schema / validation chokepoint is preserved.
 */
export async function collectYamlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__fixtures__') continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.yml')) {
        out.push(full);
      }
    }
  }
  await walk(root);
  out.sort(); // deterministic order
  return out;
}

/**
 * Load + validate every production mapping under `formsRoot` from disk.
 */
export async function loadProductionMappings(formsRoot: string): Promise<FormMapping[]> {
  const files = await collectYamlFiles(formsRoot);
  const mappings: FormMapping[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    try {
      mappings.push(parseFormMapping(content));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to parse ${file}: ${msg}`);
    }
  }
  return mappings;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

export interface CliOptions {
  outPath: string | null;
  formsRoot: string;
}

export function parseCliArgs(args: string[], scriptDir: string): CliOptions {
  const outIdx = args.indexOf('--out');
  let outPath: string | null = null;
  if (outIdx !== -1) {
    const v = args[outIdx + 1];
    if (!v || v.startsWith('--')) {
      throw new Error('Missing value for --out');
    }
    outPath = resolve(v);
  }
  // Default forms root: <scriptDir>/../src/forms
  const rootIdx = args.indexOf('--forms-root');
  const formsRoot =
    rootIdx !== -1 && args[rootIdx + 1]
      ? resolve(args[rootIdx + 1])
      : resolve(scriptDir, '..', 'src', 'forms');
  return { outPath, formsRoot };
}

export async function main(args: string[], scriptDir: string): Promise<void> {
  const opts = parseCliArgs(args, scriptDir);
  const mappings = await loadProductionMappings(opts.formsRoot);
  // W4 T0.5: version-aware emission. `Date.now()` is captured once per run
  // so every version row from the same ingest shares the same `created_at`.
  const sql = await generateIngestSqlWithVersions(mappings, Date.now());
  if (opts.outPath) {
    await writeFile(opts.outPath, sql);
    // Status goes to stderr so stdout stays pure SQL when piped.
    console.error(`Wrote SQL for ${mappings.length} mapping(s) to ${opts.outPath}`);
  } else {
    process.stdout.write(sql);
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

const thisFile = fileURLToPath(import.meta.url);
const thisDir = dirname(thisFile);
const invokedAs = argv[1] ?? '';
const isMain =
  invokedAs === thisFile ||
  invokedAs.replace(/\\/g, '/').endsWith('ingest-form-mappings.ts') ||
  invokedAs.replace(/\\/g, '/').endsWith('ingest-form-mappings.js');

if (isMain) {
  main(process.argv.slice(2), thisDir).catch((e) => {
    console.error('Error:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
