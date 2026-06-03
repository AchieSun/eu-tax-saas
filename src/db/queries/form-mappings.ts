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

import { isNull, and, type SQL } from 'drizzle-orm';
import type { createDb } from '../index';
import { formFieldMappings } from '../schema';

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
