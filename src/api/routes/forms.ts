import { eq } from 'drizzle-orm';
// Oracle P1-1 (W4 review): hard caps on R2-fetched source PDFs — guards
//   against unbounded memory + CPU when the upstream R2 object is huge
//   or has too many pages.
// Oracle P1-2 (W4 review): hono body-limit on POST /render rejects
//   oversized request bodies BEFORE the route handler parses JSON.
// Oracle P1-6 (W4 review): country/form path-params validated against
//   FormMappingSchema.shape so the canonical enum is the single source
//   of truth (no drift between the regex here and the rest of the app).
// Oracle P1-8 (W4 review): pdf-lib + render helpers are dynamically
//   imported inside POST /render so GET /:c/:y/:f (mapping metadata
//   only, no PDF rendering) does NOT pay the cold-start cost.
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
 *   - Oracle P0-1 (W4 review): watermark:false gated to admin via
 *     `requireAdminIfWatermarkOff()` mounted BEFORE rateLimit so refused
 *     misuse doesn't burn a quota slot. Every off-watermark render also
 *     writes a dedicated audit_log row (source='render-watermark-off')
 *     for post-hoc tracing.
 *   - Oracle P0-2 (W4 review): refuses to render mappings whose active
 *     rows still carry TBD_* placeholder pdf field names — the legal /
 *     audit anchor must be a real widget, not a stub.
 *   - Oracle P0-4 (W4 review): embeds mapping provenance (version, hash,
 *     country/year/form, render timestamp, user-id hash) into the PDF's
 *     built-in metadata via pdf-lib's set* methods so the artifact is
 *     self-describing after leaving the worker.
 *   - Oracle P0-5 (W4 review): uses `eqAllActive([...])` instead of
 *     `withActiveFilter(and(...))` so the (country, form, year) narrowing
 *     can never silently degrade to a global match.
 *   - Oracle P1-1 (W4 review): rejects R2-sourced PDFs that exceed
 *     MAX_PDF_BYTES (size) or MAX_PDF_PAGES (page count) with 502 +
 *     X-Render-Reject-Reason header so the failure mode is structured.
 *   - Oracle P1-2 (W4 review): request bodies > 256 KiB are refused with
 *     413 body_too_large BEFORE the admin gate / rateLimit run.
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
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { createDb } from '../../db';
import { currentMappingVersion, eqAllActive } from '../../db/queries/form-mappings';
import { auditLog, formFieldMappings } from '../../db/schema';
// Oracle P1-8 (W4 review): fillForm + synth helpers are imported dynamically
// inside the POST /render handler — they pull in pdf-lib (~600 KiB) which the
// GET path does NOT need. Keeping these top-level types-only.
import type { PDFTooLargeError as PDFTooLargeErrorType, fillForm } from '../../forms/render/fill';
import type {
  buildSynthPdfWithAcroForm as BuildSynthPdfWithAcroFormType,
  defaultMantelStyleFields as DefaultMantelStyleFieldsType,
  FieldSpec,
} from '../../forms/render/synth';
import { type Field, type FormMapping, FormMappingSchema } from '../../forms/types';
import type { Bindings, Variables } from '../index';
import { rateLimit } from '../middleware/rate-limit';
import { requireAdminIfWatermarkOff } from '../middleware/require-admin-if-watermark-off';
import { MAX_HASH_BYTES, sha256Hex } from '../middleware/sha256';

export const formsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Oracle P1-1 / P1-2 caps ─────────────────────────────────────────────────
// MAX_PDF_BYTES: R2 source PDFs over 10 MiB are refused — production tax
//   forms are O(few hundred KiB); anything bigger is either a misuploaded
//   asset or a malicious blob.
// MAX_PDF_PAGES: 50 is generous (the longest real form we ship has ~30 pp);
//   refuses bombs that would force pdf-lib to allocate page graphs for
//   thousands of pages.
// MAX_RENDER_BODY_BYTES: 256 KiB — render bodies are O(few KiB) of user
//   data; anything bigger is refused with 413 before the JSON parser runs.
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
const MAX_RENDER_BODY_BYTES = 256 * 1024;

// ── Zod path-param schema ───────────────────────────────────────────────────

// Oracle P1-6 (W4 review): country + form must match the canonical enum
// exported by FormMappingSchema. Previously the regex /^[A-Z]{2}$/ accepted
// any 2-letter code (e.g. ZZ) and the route then cast it to FormMapping's
// narrower union, papering over the mismatch. Pulling the enum in here
// means the path-param validator now refuses unsupported countries at the
// edge with a structured Zod error — no silent fall-through.
const pathParamsSchema = z.object({
  country: FormMappingSchema.shape.country,
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
  // Oracle P0-5 (W4 review): use eqAllActive([...]) — the helper throws on
  // an empty predicate list so the (country, form, year) narrowing can
  // never silently degrade to a "match every active row" query.
  const rows = await db
    .select()
    .from(formFieldMappings)
    .where(
      eqAllActive([
        eq(formFieldMappings.country, country),
        eq(formFieldMappings.formType, form),
        eq(formFieldMappings.taxYear, year),
      ]),
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
  // Oracle P1-2 (W4 review): bodyLimit runs first — a 300 KiB JSON body
  // gets refused with 413 + structured JSON before the admin gate clones
  // the body, before rateLimit consumes a slot, and before the route
  // handler ever runs. Cap is generous: real render bodies are O(few KiB).
  bodyLimit({
    maxSize: MAX_RENDER_BODY_BYTES,
    onError: (c) => c.json({ error: 'body_too_large', limitBytes: MAX_RENDER_BODY_BYTES }, 413),
  }),
  // Oracle P0-1 (W4 review): admin gate runs BEFORE rateLimit so a refused
  // non-admin watermark:false call does not burn one of the user's daily
  // 10 render slots. The middleware peeks at body via Request.clone() and
  // is a no-op for any body that doesn't carry `watermark: false`.
  requireAdminIfWatermarkOff(),
  rateLimit({
    windowSeconds: RENDER_WINDOW_SECONDS,
    max: RENDER_MAX_PER_WINDOW,
    keyPrefix: 'rl:render',
  }),
  async (c) => {
    // Oracle P1-8 (W4 review): load the pdf-lib-heavy render helpers
    // lazily so GET /api/forms/:c/:y/:f (which only returns JSON mapping
    // metadata) never pulls in the ~600 KiB pdf-lib bundle. Both modules
    // are needed in this handler so we load them in parallel.
    const [fillModule, synthModule] = await Promise.all([
      import('../../forms/render/fill'),
      import('../../forms/render/synth'),
    ]);
    const fillFormFn: typeof fillForm = fillModule.fillForm;
    const PDFTooLargeError: typeof PDFTooLargeErrorType = fillModule.PDFTooLargeError;
    const buildSynthPdfWithAcroForm: typeof BuildSynthPdfWithAcroFormType =
      synthModule.buildSynthPdfWithAcroForm;
    const defaultMantelStyleFields: typeof DefaultMantelStyleFieldsType =
      synthModule.defaultMantelStyleFields;

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
    // Oracle P0-5 (W4 review): eqAllActive([...]) replaces the prior
    // withActiveFilter(and(...)!) so an empty narrowing list throws loudly
    // instead of silently widening the query.
    const rows = await db
      .select()
      .from(formFieldMappings)
      .where(
        eqAllActive([
          eq(formFieldMappings.country, country),
          eq(formFieldMappings.formType, form),
          eq(formFieldMappings.taxYear, year),
        ]),
      );
    if (rows.length === 0) {
      return c.json({ error: 'no_active_mapping_fields', country, year, form }, 422);
    }

    // 4b. Oracle P0-2 (W4 review): refuse to render mappings whose active
    //     acroform rows still carry TBD_* placeholder field names. A
    //     placeholder means the mapping hasn't been verified against a real
    //     PDF — rendering it would silently produce a doc with no fields
    //     filled (best case) or fill into a stale widget that no longer
    //     matches the legal layout (worst case). 422 with a sample of the
    //     offending names lets the operator pinpoint the gap.
    const placeholders = rows.filter(
      (r) => r.fieldKind === 'acroform' && r.fieldName.startsWith('TBD_'),
    );
    if (placeholders.length > 0) {
      c.header('X-Render-Mapping-Status', 'placeholder');
      return c.json(
        {
          error: 'mapping_unverified',
          country,
          year,
          form,
          placeholderFieldCount: placeholders.length,
          sample: placeholders.slice(0, 3).map((r) => r.fieldName),
        },
        422,
      );
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
      // Oracle P1-6 (W4 review): `country` is already narrowed to the
      // canonical FormMappingSchema enum by pathParamsSchema, so no cast
      // is required here. If a future country is added to the app it
      // ships in one place (FormMappingSchema) and this route picks it
      // up automatically.
      country,
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
    // Oracle P1-1 (W4 review): when R2 returns an object we enforce a
    //    hard 10 MiB size cap BEFORE allocating an arrayBuffer; oversized
    //    objects return a structured 502 + X-Render-Reject-Reason
    //    header so the failure mode is observable. Page-count enforcement
    //    happens later via fillForm({maxPages}) — see below.
    const r2Key = rows.find((r) => r.pdfR2Key)?.pdfR2Key ?? null;
    let pdfBytes: Uint8Array | null = null;
    let pdfFromR2 = false;
    if (r2Key) {
      try {
        const obj = await c.env.R2.get(r2Key);
        if (obj) {
          // Oracle P1-1: refuse objects exceeding MAX_PDF_BYTES before
          // we materialise them in memory.
          const size = (obj as { size?: number }).size;
          if (typeof size === 'number' && size > MAX_PDF_BYTES) {
            c.header('X-Render-Reject-Reason', 'r2_size');
            return c.json(
              {
                error: 'source_pdf_too_large',
                sizeBytes: size,
                limitBytes: MAX_PDF_BYTES,
              },
              502,
            );
          }
          pdfBytes = new Uint8Array(await obj.arrayBuffer());
          pdfFromR2 = true;
        }
      } catch (_err) {
        // Swallow — fall through to synth.
        pdfBytes = null;
        pdfFromR2 = false;
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
    // Oracle P0-1 (W4 review): watermarkOff is computed once and used to
    // (a) write the post-render audit_log row, (b) flip the
    // X-Render-Watermark response header. By the time we get here the
    // requireAdminIfWatermarkOff() middleware has already verified the
    // caller is an admin if watermarkOff is true.
    // Oracle P0-4 (W4 review): userIdHash is a short (16-hex-char) prefix
    // of the SHA-256 of the user id — enough entropy to be collision-
    // resistant for audit but short enough to live inside PDF Keywords
    // without bloating it. The session is always present here because the
    // rateLimit middleware refuses anon with 401 above.
    const watermarkOff = body.watermark === false;
    const session = c.get('session');
    const sessionUserId = session?.user?.id ?? '';
    const userIdHash = sessionUserId ? (await sha256Hex(sessionUserId)).slice(0, 16) : 'anonymous';
    const renderedAt = new Date().toISOString();

    // Oracle P1-1 (W4 review): pass maxPages ONLY when the source bytes
    // came from R2. The synth fallback is our own builder and is already
    // capped by its `pageCount` arg, so re-enforcing here would just
    // double-check our own code.
    let result: Awaited<ReturnType<typeof fillForm>>;
    try {
      result = await fillFormFn({
        pdfBytes,
        mapping,
        data: body.data,
        watermark: body.watermark,
        ...(pdfFromR2 ? { maxPages: MAX_PDF_PAGES } : {}),
        // Oracle P0-4: embed mapping provenance + render trace into the PDF
        // metadata slots so the artifact carries its origin everywhere.
        metadata: {
          mappingVersion: version.version,
          mappingHash: version.contentHash,
          country,
          taxYear: year,
          formType: form,
          renderedAt,
          userIdHash,
        },
      });
    } catch (err) {
      if (err instanceof PDFTooLargeError) {
        c.header('X-Render-Reject-Reason', 'r2_pages');
        return c.json(
          {
            error: 'source_pdf_too_many_pages',
            pageCount: err.pageCount,
            limit: err.limit,
          },
          502,
        );
      }
      throw err;
    }

    // 7b. Oracle P0-1: every off-watermark render leaves a dedicated audit
    //     trail. Fire-and-forget via executionCtx.waitUntil when available
    //     (matches the global audit middleware's pattern); falls back to
    //     synchronous await in test envs without Workers runtime.
    if (watermarkOff && c.env?.DB) {
      const inputHash = await sha256Hex(
        `${country}/${year}/${form}|v${version.version}|${version.contentHash}|watermark:off`,
      );
      const slice =
        result.pdfBytes.byteLength > MAX_HASH_BYTES
          ? result.pdfBytes.slice(0, MAX_HASH_BYTES)
          : result.pdfBytes;
      const resultHash = await sha256Hex(slice);
      const promise = db
        .insert(auditLog)
        .values({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          userIdOrNull: sessionUserId || null,
          route: new URL(c.req.url).pathname,
          method: 'POST',
          inputHash,
          resultHash,
          statusCode: 200,
          source: 'render-watermark-off',
        })
        .then(
          () => {},
          (err: unknown) => {
            // biome-ignore lint/suspicious/noConsoleLog: audit write failure must surface
            console.error('watermark-off audit write failed', err);
          },
        );
      let hasWaitUntil = false;
      try {
        hasWaitUntil = typeof c.executionCtx?.waitUntil === 'function';
      } catch {
        // Not in Workers runtime — fall through to await.
      }
      if (hasWaitUntil) {
        // biome-ignore lint/style/noNonNullAssertion: probed via try above
        c.executionCtx!.waitUntil(promise);
      } else {
        await promise;
      }
    }

    // 8. Respond with PDF bytes + diagnostic headers. Cache-Control is
    //    `no-store, private` because every render embeds user data.
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', `attachment; filename="${country}-${year}-${form}-draft.pdf"`);
    c.header('X-Render-Warnings', String(result.warnings.length));
    c.header('X-Render-Filled-Fields', String(result.filledFieldCount));
    c.header('X-Render-Mapping-Version', String(version.version));
    c.header('X-Render-Mapping-Hash', version.contentHash);
    c.header('X-Render-Watermark', watermarkOff ? 'off' : 'on');
    c.header('Cache-Control', 'no-store, private');
    return c.body(result.pdfBytes, 200);
  },
);
