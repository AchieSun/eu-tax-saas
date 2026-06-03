/**
 * form-mappings.test.ts — Unit tests for the form_field_mappings query helpers.
 *
 * Tests that the soft-delete chokepoint helpers generate correct SQL
 * and filter out soft-deleted rows.
 */

import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { activeFormMappings, withActiveFilter } from './form-mappings';
import { createDb } from '../index';
import { formFieldMappings } from '../schema';

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
