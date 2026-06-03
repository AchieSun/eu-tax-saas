/**
 * W4 T2.1 — GET /api/forms/:country/:year/:form
 *
 * Returns the active form mapping (metadata + all active field rows) as JSON
 * with HTTP caching driven by `form_mapping_versions.content_hash`.
 *
 * Caching strategy:
 *   - `ETag` is the version's content_hash (RFC 7232 strong validator, quoted).
 *   - `If-None-Match` short-circuits to 304 with no body when the client
 *     already has the current version, saving a D1 read and bandwidth.
 *   - `Cache-Control: public, max-age=300, stale-while-revalidate=86400`
 *     allows Cloudflare edge + browser caching while keeping revalidation cheap.
 *
 * Read-only, anonymous-allowed: no auth middleware (T3.2 render endpoint
 * owns auth + rate limiting + audit).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Bindings, Variables } from '../index';
import { createDb } from '../../db';
import { formFieldMappings } from '../../db/schema';
import {
  currentMappingVersion,
  withActiveFilter,
} from '../../db/queries/form-mappings';

export const formsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Zod path-param schema ───────────────────────────────────────────────────

const pathParamsSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/, 'country must be 2-letter uppercase ISO code'),
  year: z.coerce.number().int().min(2020).max(2099),
  form: z.string().regex(/^[a-z0-9_]{1,64}$/, 'form must be snake_case (a-z0-9_, max 64 chars)'),
});

// ── Cache-control constants ─────────────────────────────────────────────────

const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=86400';
const VARY = 'Accept-Encoding';

// ── GET /:country/:year/:form ───────────────────────────────────────────────

formsRoutes.get('/:country/:year/:form', async (c) => {
  // 1. Validate path params.
  const parsed = pathParamsSchema.safeParse({
    country: c.req.param('country'),
    year: c.req.param('year'),
    form: c.req.param('form'),
  });
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const { country, year, form } = parsed.data;

  const db = createDb(c.env.DB);

  // 2. Lookup current mapping version.
  const version = await currentMappingVersion(db, country, form, year);
  if (!version) {
    return c.json(
      { error: 'form_mapping_not_found', country, year, form },
      404,
    );
  }

  // 3. Compute ETag from content_hash (quoted per RFC 7232).
  const etag = `"${version.contentHash}"`;

  // 4. If-None-Match short-circuit → 304.
  const ifNoneMatch = c.req.header('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    c.header('ETag', etag);
    c.header('Cache-Control', CACHE_CONTROL);
    c.header('Vary', VARY);
    return c.body(null, 304);
  }

  // 5. Fetch all active field rows for this (country, form, year).
  // withActiveFilter() composes `deleted_at IS NULL` with the caller's
  // conditions in a single WHERE clause — required because Drizzle's
  // SQLiteSelect does not allow chaining `.where()` twice.
  const rows = await db
    .select()
    .from(formFieldMappings)
    .where(
      withActiveFilter(
        and(
          eq(formFieldMappings.country, country),
          eq(formFieldMappings.formType, form),
          eq(formFieldMappings.taxYear, year),
        )!,
      ),
    );

  // 6. Build JSON response (camelCase mirrors schema TS column names).
  const fields = rows.map((r) => ({
    key: r.fieldName,
    acroName: r.fieldName,
    xCoord: r.xCoord,
    yCoord: r.yCoord,
    fontSize: r.fontSize,
    fieldKind: r.fieldKind,
    sourcePath: r.dataPath,
    citation: r.notes,
    fieldType: r.fieldType,
    dataPath: r.dataPath,
    pageNumber: r.pageNumber,
  }));

  // 7. Headers (set BEFORE returning).
  c.header('ETag', etag);
  c.header('Cache-Control', CACHE_CONTROL);
  c.header('Vary', VARY);

  return c.json({
    country,
    taxYear: year,
    formType: form,
    version: version.version,
    contentHash: version.contentHash,
    versionCreatedAt: new Date(version.createdAt).toISOString(),
    fields,
  });
});
