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

import { isNull, and, desc, eq, type SQL } from 'drizzle-orm';
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
 * Combine the soft-delete filter with caller-supplied conditions in a single `.where()`.
 * Use this when you need AND with the soft-delete filter at the same level
 * (e.g. when you cannot chain because you need both conditions in one `.where()` call).
 */
export function withActiveFilter(extra: SQL): SQL {
  // biome-ignore lint/style/noNonNullAssertion: and() with two args always returns SQL, not undefined
  return and(isNull(formFieldMappings.deletedAt), extra)!;
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
