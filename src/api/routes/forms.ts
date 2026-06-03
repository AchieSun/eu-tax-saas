import { and, eq } from 'drizzle-orm';
/**
 * W4 T2.1 — GET /api/forms/:country/:year/:form
 * W4 T3.2 — POST /api/forms/:country/:year/:form/render
 *
 * GET returns the active form mapping (metadata + all active field rows)
 * as JSON with HTTP caching driven by `form_mapping_versions.content_hash`.
 *
 * Caching strategy (GET):
 *   - `ETag` is the version's content_hash (RFC 7232 strong validator, quoted).
 *   - `If-None-Match` short-circuits to 304 with no body when the client
 *     already has the current version, saving a D1 read and bandwidth.
 *   - `Cache-Control: public, max-age=300, stale-while-revalidate=86400`
 *     allows Cloudflare edge + browser caching while keeping revalidation cheap.
 *
 * Read-only GET is anonymous-allowed: no auth middleware (T3.2 render
 * endpoint owns auth + rate limiting + audit).
 *
 * POST /render is the user-facing draft-PDF builder:
 *   - Auth-required (refused 401 by `rateLimit({requireSession:true})`)
 *   - Per-user rate-limited (10/day default via KV-backed sliding bucket)
 *   - Pulls the same active mapping rows as GET, then either fetches the
 *     source PDF from R2 (when pdf_r2_key is set) or falls back to a
 *     synthetic AcroForm built from the field roster.
 *   - Renders via `fillForm(...)` (T3.1a/b/c), returns application/pdf bytes
 *     with diagnostic X-Render-* headers so the UI can surface warnings.
 *   - Cache-Control: no-store, private — every render embeds user data.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../../db';
import { currentMappingVersion, withActiveFilter } from '../../db/queries/form-mappings';
import { formFieldMappings } from '../../db/schema';
import { fillForm } from '../../forms/render/fill';
import {
  type FieldSpec,
  buildSynthPdfWithAcroForm,
  defaultMantelStyleFields,
} from '../../forms/render/synth';
import type { Field, FormMapping } from '../../forms/types';
import type { Bindings, Variables } from '../index';
import { rateLimit } from '../middleware/rate-limit';

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
    return c.json({ error: 'form_mapping_not_found', country, year, form }, 404);
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

// ── POST /:country/:year/:form/render (W4 T3.2) ─────────────────────────────

/**
 * Zod schema for the JSON request body. `data` is the user-supplied bundle
 * that gets resolved against each field's sourcePath inside fillForm. The
 * watermark control mirrors fill.ts's `false | WatermarkOptions` shape so
 * the wire format is a 1:1 mapping with the render core.
 */
const renderBodySchema = z.object({
  data: z.record(z.unknown()),
  watermark: z
    .union([
      z.literal(false),
      z.object({
        text: z.string().optional(),
        opacity: z.number().min(0).max(1).optional(),
        rotationDegrees: z.number().optional(),
      }),
    ])
    .optional(),
});

// Daily free-tier render cap. Tunable per environment; per-user.
const RENDER_WINDOW_SECONDS = 86400;
const RENDER_MAX_PER_WINDOW = 10;

formsRoutes.post(
  '/:country/:year/:form/render',
  rateLimit({
    windowSeconds: RENDER_WINDOW_SECONDS,
    max: RENDER_MAX_PER_WINDOW,
    keyPrefix: 'rl:render',
  }),
  async (c) => {
    // 1. Validate path params (same schema as GET).
    const parsedPath = pathParamsSchema.safeParse({
      country: c.req.param('country'),
      year: c.req.param('year'),
      form: c.req.param('form'),
    });
    if (!parsedPath.success) {
      return c.json({ error: 'validation', issues: parsedPath.error.issues }, 400);
    }
    const { country, year, form } = parsedPath.data;

    // 2. Parse JSON body. Hono's c.req.json() throws on invalid JSON — catch
    //    so we return a 400 instead of a 500.
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch (_err) {
      return c.json({ error: 'validation', issues: [{ message: 'invalid JSON body' }] }, 400);
    }
    const parsedBody = renderBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json({ error: 'validation', issues: parsedBody.error.issues }, 400);
    }
    const body = parsedBody.data;

    const db = createDb(c.env.DB);

    // 3. Lookup current mapping version. 404 if the form has never been
    //    ingested (no rows in form_mapping_versions).
    const version = await currentMappingVersion(db, country, form, year);
    if (!version) {
      return c.json({ error: 'form_mapping_not_found', country, year, form }, 404);
    }

    // 4. Pull active field rows (same query path as GET).
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
    if (rows.length === 0) {
      return c.json({ error: 'no_active_mapping_fields', country, year, form }, 422);
    }

    // 5. Build FormMapping object the render core expects.
    //    NOTE: the DB schema has no `transform` column yet — every field
    //    defaults to 'none'. A follow-up migration will surface the YAML
    //    transform into D1 so this hard-coded default goes away.
    //    NOTE: `citation` is required by the type but `notes` may be null
    //    for legacy rows — fall back to 'unknown' so the type stays sound.
    const fields: Field[] = rows.map((r) => {
      const fieldType = (r.fieldType ?? 'text') as 'text' | 'number' | 'date' | 'checkbox';
      const citation = r.notes ?? 'unknown';
      if (r.fieldKind === 'coordinate') {
        return {
          kind: 'coordinate' as const,
          sourcePath: r.dataPath,
          // CoordinateField excludes 'checkbox' from its type union.
          type: (fieldType === 'checkbox' ? 'text' : fieldType) as 'text' | 'number' | 'date',
          transform: 'none' as const,
          citation,
          page: r.pageNumber ?? 0,
          x: r.xCoord ?? 0,
          y: r.yCoord ?? 0,
          fontSize: r.fontSize ?? 10,
        };
      }
      // AcroForm default.
      const acro: Field = {
        kind: 'acroform' as const,
        pdfField: r.fieldName,
        sourcePath: r.dataPath,
        type: fieldType,
        transform: 'none' as const,
        citation,
        ...(r.fontSize !== null && r.fontSize !== undefined ? { fontSize: r.fontSize } : {}),
      };
      return acro;
    });

    const mapping: FormMapping = {
      // pathParamsSchema regex /^[A-Z]{2}$/ guarantees a 2-letter code,
      // but FormMappingSchema only allows the 5 supported countries — cast
      // here so we don't double-validate; the API contract is that the
      // path-param Zod is authoritative.
      country: country as FormMapping['country'],
      year,
      form,
      formTitle: form,
      sourceUrl: 'https://example.invalid/placeholder',
      sourceVersion: `db-version-${version.version}`,
      fields: fields as FormMapping['fields'],
    };

    // 6. Resolve the source PDF.
    //    Order: R2 (if any row has pdfR2Key set) → synth fallback.
    //    R2 fetch failure (object missing / read error) silently falls
    //    through to synth — the dev environment may not have the asset
    //    uploaded yet, and the synth output is still a valid demo PDF.
    const r2Key = rows.find((r) => r.pdfR2Key)?.pdfR2Key ?? null;
    let pdfBytes: Uint8Array | null = null;
    if (r2Key) {
      try {
        const obj = await c.env.R2.get(r2Key);
        if (obj) {
          pdfBytes = new Uint8Array(await obj.arrayBuffer());
        }
      } catch (_err) {
        // Swallow — fall through to synth.
        pdfBytes = null;
      }
    }
    if (!pdfBytes) {
      // Synth fallback. Convert mapping fields into FieldSpec for the
      // builder so the synthetic PDF carries widgets the fill engine can
      // actually target. Use the Mantel preset coords as a baseline when
      // a field has no x/y of its own.
      const presetByName = new Map(defaultMantelStyleFields().map((f) => [f.name, f]));
      const specs: FieldSpec[] = fields
        .filter((f): f is Extract<Field, { kind: 'acroform' }> => f.kind === 'acroform')
        .map((f, idx) => {
          const preset = presetByName.get(f.pdfField);
          // Stack fields vertically when no preset matches.
          return (
            preset ?? {
              name: f.pdfField,
              kind: f.type === 'checkbox' ? ('checkbox' as const) : ('text' as const),
              x: 80,
              y: 720 - idx * 30,
              width: 200,
              height: 18,
              page: 0,
            }
          );
        });
      // If the mapping is coordinate-only the synth doc has no fields,
      // but the render engine still draws coord fields onto raw pages —
      // perfectly valid.
      pdfBytes = await buildSynthPdfWithAcroForm({ fields: specs });
    }

    // 7. Render.
    const result = await fillForm({
      pdfBytes,
      mapping,
      data: body.data,
      watermark: body.watermark,
    });

    // 8. Respond with PDF bytes + diagnostic headers. Cache-Control is
    //    `no-store, private` because every render embeds user data.
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', `attachment; filename="${country}-${year}-${form}-draft.pdf"`);
    c.header('X-Render-Warnings', String(result.warnings.length));
    c.header('X-Render-Filled-Fields', String(result.filledFieldCount));
    c.header('X-Render-Mapping-Version', String(version.version));
    c.header('X-Render-Mapping-Hash', version.contentHash);
    c.header('Cache-Control', 'no-store, private');
    return c.body(result.pdfBytes, 200);
  },
);
