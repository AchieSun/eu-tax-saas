/**
 * form-mappings.test.ts — Unit tests for the form_field_mappings query helpers.
 *
 * Tests that the soft-delete chokepoint helpers generate correct SQL
 * and filter out soft-deleted rows.
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb } from '../index';
import { formFieldMappings } from '../schema';
import { activeFormMappings, eqAllActive, withActiveFilter } from './form-mappings';

describe('activeFormMappings', () => {
  it('generates SQL with deleted_at IS NULL filter', () => {
    const db = createDb({} as any);
    const query = activeFormMappings(db);
    const { sql } = query.toSQL();
    const lower = sql.toLowerCase();
    expect(lower).toContain('deleted_at');
    expect(lower).toContain('is null');
  });

  it('SQL contains WHERE deleted_at IS NULL clause', () => {
    const db = createDb({} as any);
    const query = activeFormMappings(db);
    const { sql } = query.toSQL();
    const lower = sql.toLowerCase();
    expect(lower).toMatch(/where\s+.*?deleted_at.*?is\s+null/i);
  });

  it('withActiveFilter combines deleted_at IS NULL with extra condition', () => {
    const db = createDb({} as any);
    const query = db
      .select()
      .from(formFieldMappings)
      .where(withActiveFilter(eq(formFieldMappings.country, 'DE')));
    const { sql } = query.toSQL();
    const lower = sql.toLowerCase();
    expect(lower).toContain('deleted_at');
    expect(lower).toContain('is null');
    expect(lower).toContain('country');
    expect(lower).toContain('?');
  });

  it('activeFormMappings query selects overlay coordinate columns (W4 T0.3)', () => {
    const db = createDb({} as any);
    const { sql } = activeFormMappings(db).toSQL();
    const lower = sql.toLowerCase();
    expect(lower).toContain('x_coord');
    expect(lower).toContain('y_coord');
    expect(lower).toContain('font_size');
    expect(lower).toContain('field_kind');
  });
});

// ── Oracle P0-5 (W4 review) ────────────────────────────────────────────
describe('eqAllActive (Oracle P0-5)', () => {
  it('throws when called with an empty predicate list (cross-form leak guard)', () => {
    // Even though deletedAt-only filtering would technically return "active"
    // rows, the helper must refuse to widen the query implicitly. Loud
    // throw beats silent leak across (country, form, year) buckets.
    expect(() => eqAllActive([])).toThrow(/at least one narrowing predicate/);
  });

  it('emits SQL that ANDs deleted_at IS NULL with every supplied predicate', () => {
    const db = createDb({} as never);
    const query = db
      .select()
      .from(formFieldMappings)
      .where(
        eqAllActive([
          eq(formFieldMappings.country, 'DE'),
          eq(formFieldMappings.formType, 'mantelbogen'),
          eq(formFieldMappings.taxYear, 2024),
        ]),
      );
    const { sql, params } = query.toSQL();
    const lower = sql.toLowerCase();
    expect(lower).toContain('deleted_at');
    expect(lower).toContain('is null');
    expect(lower).toContain('country');
    expect(lower).toContain('form_type');
    expect(lower).toContain('tax_year');
    // Three positional ?'s for the three eq() predicates.
    expect((sql.match(/\?/g) ?? []).length).toBe(3);
    expect(params).toEqual(['DE', 'mantelbogen', 2024]);
  });

  it('cross-form leak guard: querying for DE/mantelbogen does NOT match ES/modelo_100 params', () => {
    // SQL-shape test — confirms the WHERE clause binds the country + form
    // parameters tightly. If a future refactor accidentally dropped a
    // narrowing predicate, the param array would shrink and this assertion
    // would catch it before any production query leaks rows across forms.
    const db = createDb({} as never);
    const deQuery = db
      .select()
      .from(formFieldMappings)
      .where(
        eqAllActive([
          eq(formFieldMappings.country, 'DE'),
          eq(formFieldMappings.formType, 'mantelbogen'),
          eq(formFieldMappings.taxYear, 2024),
        ]),
      );
    const esQuery = db
      .select()
      .from(formFieldMappings)
      .where(
        eqAllActive([
          eq(formFieldMappings.country, 'ES'),
          eq(formFieldMappings.formType, 'modelo_100'),
          eq(formFieldMappings.taxYear, 2024),
        ]),
      );
    expect(deQuery.toSQL().params).toEqual(['DE', 'mantelbogen', 2024]);
    expect(esQuery.toSQL().params).toEqual(['ES', 'modelo_100', 2024]);
    // Different param tuples → cannot return overlapping rows.
    expect(deQuery.toSQL().params).not.toEqual(esQuery.toSQL().params);
  });

  it('withActiveFilter is a backward-compat wrapper around eqAllActive', () => {
    const db = createDb({} as never);
    const a = db
      .select()
      .from(formFieldMappings)
      .where(withActiveFilter(eq(formFieldMappings.country, 'DE')))
      .toSQL();
    const b = db
      .select()
      .from(formFieldMappings)
      .where(eqAllActive([eq(formFieldMappings.country, 'DE')]))
      .toSQL();
    expect(a.sql).toBe(b.sql);
    expect(a.params).toEqual(b.params);
  });
});
