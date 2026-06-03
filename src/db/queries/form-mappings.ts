/**
 * form-mappings.ts — Single chokepoint for reading form_field_mappings.
 *
 * ALWAYS use these helpers instead of raw `db.select().from(formFieldMappings)`.
 * They automatically exclude soft-deleted rows (`deletedAt IS NOT NULL`).
 *
 * To add extra conditions:
 *   activeFormMappings(db).where(eq(formFieldMappings.country, 'DE'))
 *
 * For combining with the implicit `deletedAt IS NULL` filter at the same WHERE level:
 *   db.select().from(formFieldMappings).where(withActiveFilter(eq(...)))
 */

import { type SQL, and, desc, eq, isNull } from 'drizzle-orm';
import type { createDb } from '../index';
import { formFieldMappings, formMappingVersions } from '../schema';

type Db = ReturnType<typeof createDb>;

/**
 * Base query builder — returns all active (non-soft-deleted) form field mappings.
 * Automatically filters out rows where `deletedAt` is not NULL.
 *
 * Caller can chain `.where()`, `.orderBy()`, `.limit()`, etc. as usual.
 */
export function activeFormMappings(db: Db) {
  return db.select().from(formFieldMappings).where(isNull(formFieldMappings.deletedAt));
}

/**
 * Variant for selecting specific columns on active rows.
 */
export function activeFormMappingsSelect(
  db: Db,
  columns: Parameters<ReturnType<typeof createDb>['select']>[0],
) {
  return db.select(columns).from(formFieldMappings).where(isNull(formFieldMappings.deletedAt));
}

/**
 * Combine the soft-delete filter with one or more caller-supplied predicates
 * in a single `.where()`. Refuses an empty predicate list at runtime to make
 * silent cross-form leaks impossible — every caller MUST narrow by at least
 * (country, formType, taxYear) or some explicit row identifier.
 *
 * Oracle P0-5 (W4 review): the typing here is strict — `predicates` is
 * `Array<SQL>` so `undefined` results from e.g. `eq()` of a nullable column
 * can't sneak past the typechecker. The runtime check exists for the
 * downstream JS callers that might pass `[]`.
 */
export function eqAllActive(predicates: SQL[]): SQL {
  if (predicates.length === 0) {
    // Programming error — leaving this unguarded would return
    // `isNull(deletedAt)` and silently match EVERY active row across every
    // country/form/year combination. Loud throw beats silent leak.
    throw new Error('eqAllActive: at least one narrowing predicate is required');
  }
  // and() with 2+ defined SQL args always returns a defined SQL. The
  // runtime check above guarantees we have >= 2 args here (deletedAt + 1+
  // caller predicates), so the non-null assertion is mathematically sound.
  // biome-ignore lint/style/noNonNullAssertion: see comment above
  return and(isNull(formFieldMappings.deletedAt), ...predicates)!;
}

/**
 * @deprecated Prefer `eqAllActive([extra])`. Kept as a thin wrapper for
 * backward compatibility with the W4 ingest paths that still pass a single
 * pre-AND'd SQL clob.
 */
export function withActiveFilter(extra: SQL): SQL {
  return eqAllActive([extra]);
}

// ─── W4 T0.5 — mapping version lookup ──────────────────────────────────────

/**
 * Shape returned by `currentMappingVersion()`.
 * Mirrors the columns we actually need downstream (cache seed + audit).
 */
export interface CurrentMappingVersion {
  version: number;
  contentHash: string;
  createdAt: number; // unix ms
}

/**
 * Return the latest version row for a given (country, formType, taxYear)
 * tuple, or `null` if the form has never been ingested.
 *
 * Used by the W4 cache layer: the returned `contentHash` is the cache-key
 * seed for ETag headers and Workers Cache lookups, so the cache invalidates
 * automatically when ingest writes a new version.
 *
 * NOTE: this query does NOT filter out anything — every row in
 * `form_mapping_versions` is meaningful. Soft-delete on `form_field_mappings`
 * is a separate concern.
 */
export async function currentMappingVersion(
  db: Db,
  country: string,
  formType: string,
  taxYear: number,
): Promise<CurrentMappingVersion | null> {
  const rows = await db
    .select({
      version: formMappingVersions.version,
      contentHash: formMappingVersions.contentHash,
      createdAt: formMappingVersions.createdAt,
    })
    .from(formMappingVersions)
    .where(
      and(
        eq(formMappingVersions.country, country),
        eq(formMappingVersions.formType, formType),
        eq(formMappingVersions.taxYear, taxYear),
      ),
    )
    .orderBy(desc(formMappingVersions.version))
    .limit(1);
  return rows[0] ?? null;
}
