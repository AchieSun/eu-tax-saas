/**
 * W4 T2.1 — GET /api/forms/:country/:year/:form integration tests.
 *
 * Mocks the two read-helpers (`currentMappingVersion`, `activeFormMappings`)
 * from `db/queries/form-mappings`, since those helpers have their own unit
 * tests (form-mappings.test.ts) and writing a full sqlite-proxy stub for
 * the version-lookup ORDER BY/LIMIT chain plus the field-row WHERE chain
 * would just duplicate Drizzle's behavior without testing this route.
 *
 * The route logic under test is:
 *   - Zod path-param validation (country, year, form)
 *   - 404 when version is null
 *   - ETag formatting (quoted content_hash)
 *   - If-None-Match → 304 short-circuit (no body, headers present)
 *   - Cache-Control + Vary headers on every cacheable response
 *   - JSON shape (camelCase, version metadata, fields[])
 *   - Field filtering relies on `activeFormMappings` (soft-delete handled
 *     in that helper's own tests); legacy rows with version_id=NULL flow
 *     through unchanged because the helper does NOT filter on version_id.
 */

import { inflateSync } from 'node:zlib';
import { Hono } from 'hono';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSynthPdfWithAcroForm } from '../../forms/render/synth';
import type { Bindings, Variables } from '../index';
import { formsRoutes } from './forms';

// ── Mock state ───────────────────────────────────────────────────────────────

interface VersionRow {
  version: number;
  contentHash: string;
  createdAt: number;
}

interface FieldRow {
  id: string;
  country: string;
  formType: string;
  taxYear: number;
  fieldName: string;
  fieldLabel: string | null;
  dataPath: string;
  fieldType: string;
  pageNumber: number | null;
  boxNumber: string | null;
  notes: string | null;
  pdfR2Key: string | null;
  pdfSha256: string | null;
  pageCount: number | null;
  deletedAt: number | null;
  xCoord: number | null;
  yCoord: number | null;
  fontSize: number | null;
  fieldKind: string;
  versionId: number | null;
}

let mockVersion: VersionRow | null = null;
let mockFields: FieldRow[] = [];

function resetMocks() {
  mockVersion = null;
  mockFields = [];
}

// Mock the two helpers the route imports from db/queries/form-mappings:
//   - `currentMappingVersion(db, country, form, year)` → version row or null
//   - `withActiveFilter(extra)` → opaque SQL composite (we just pass-through)
// And mock `createDb` so `db.select().from(formFieldMappings).where(...)`
// resolves to our in-memory `mockFields` (already filtered for deletedAt).
vi.mock('../../db/queries/form-mappings', () => ({
  currentMappingVersion: vi.fn(
    async (
      _db: unknown,
      country: string,
      formType: string,
      taxYear: number,
    ): Promise<VersionRow | null> => {
      void country;
      void formType;
      void taxYear;
      return mockVersion;
    },
  ),
  // Pass-through: the real impl returns SQL; the route just hands it to
  // .where() which our mock ignores.
  withActiveFilter: vi.fn((extra: unknown) => extra),
}));

vi.mock('../../db', () => {
  // Drizzle chain: db.select().from(table).where(cond) → Promise<rows[]>
  const where = vi.fn(async (_cond: unknown) => {
    // Mimic the real `withActiveFilter` semantics: exclude soft-deleted.
    return mockFields.filter((r) => r.deletedAt === null);
  });
  const from = vi.fn((_table: unknown) => ({ where }));
  const select = vi.fn((_cols?: unknown) => ({ from }));
  return {
    createDb: vi.fn(() => ({ select })),
  };
});

// ── Test app factory ─────────────────────────────────────────────────────────

function createTestApp() {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.route('/api/forms', formsRoutes);
  return app;
}

function request(app: ReturnType<typeof createTestApp>, path: string, init?: RequestInit) {
  return app.request(path, init, { DB: {} } as Bindings);
}

// ── Fixture builders ─────────────────────────────────────────────────────────

function makeVersion(overrides: Partial<VersionRow> = {}): VersionRow {
  return {
    version: 3,
    contentHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    createdAt: 1717420800000, // 2024-06-03T13:20:00.000Z (unix ms)
    ...overrides,
  };
}

function makeField(overrides: Partial<FieldRow> = {}): FieldRow {
  return {
    id: 'fld-1',
    country: 'DE',
    formType: 'mantelbogen',
    taxYear: 2024,
    fieldName: 'income.salary',
    fieldLabel: null,
    dataPath: 'income.salary.annual',
    fieldType: 'number',
    pageNumber: 1,
    boxNumber: null,
    notes: 'BMF 2024-12-15 §1',
    pdfR2Key: null,
    pdfSha256: null,
    pageCount: null,
    deletedAt: null,
    xCoord: 123.5,
    yCoord: 456.25,
    fontSize: 10,
    fieldKind: 'coordinate',
    versionId: 3,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/forms/:country/:year/:form', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('1. returns 200 with mapping JSON for a valid country/year/form', async () => {
    mockVersion = makeVersion();
    mockFields = [makeField()];
    const app = createTestApp();
    const res = await request(app, '/api/forms/DE/2024/mantelbogen');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.country).toBe('DE');
    expect(body.taxYear).toBe(2024);
    expect(body.formType).toBe('mantelbogen');
    expect(body.version).toBe(3);
    expect(body.contentHash).toBe(mockVersion.contentHash);
    expect(body.versionCreatedAt).toBe('2024-06-03T13:20:00.000Z');
    expect(Array.isArray(body.fields)).toBe(true);
    expect((body.fields as unknown[]).length).toBe(1);
    const f = (body.fields as Array<Record<string, unknown>>)[0];
    expect(f.key).toBe('income.salary');
    expect(f.acroName).toBe('income.salary');
    expect(f.xCoord).toBe(123.5);
    expect(f.yCoord).toBe(456.25);
    expect(f.fontSize).toBe(10);
    expect(f.fieldKind).toBe('coordinate');
    expect(f.sourcePath).toBe('income.salary.annual');
    expect(f.citation).toBe('BMF 2024-12-15 §1');
    expect(f.fieldType).toBe('number');
    expect(f.dataPath).toBe('income.salary.annual');
    expect(f.pageNumber).toBe(1);
  });

  it('2. response includes ETag header equal to "<content_hash>" (quoted)', async () => {
    mockVersion = makeVersion();
    mockFields = [makeField()];
    const app = createTestApp();
    const res = await request(app, '/api/forms/DE/2024/mantelbogen');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(`"${mockVersion.contentHash}"`);
  });

  it('3. response includes Cache-Control: public, max-age=300, stale-while-revalidate=86400', async () => {
    mockVersion = makeVersion();
    mockFields = [makeField()];
    const app = createTestApp();
    const res = await request(app, '/api/forms/DE/2024/mantelbogen');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=300, stale-while-revalidate=86400',
    );
  });

  it('4. response includes Vary: Accept-Encoding', async () => {
    mockVersion = makeVersion();
    mockFields = [makeField()];
    const app = createTestApp();
    const res = await request(app, '/api/forms/DE/2024/mantelbogen');
    expect(res.status).toBe(200);
    expect(res.headers.get('vary')).toBe('Accept-Encoding');
  });

  it('5. If-None-Match matching ETag returns 304 with no body + ETag + Cache-Control + Vary', async () => {
    mockVersion = makeVersion();
    mockFields = [makeField()];
    const app = createTestApp();
    const etag = `"${mockVersion.contentHash}"`;
    const res = await request(app, '/api/forms/DE/2024/mantelbogen', {
      headers: { 'If-None-Match': etag },
    });
    expect(res.status).toBe(304);
    // Body must be empty/null on 304.
    const text = await res.text();
    expect(text).toBe('');
    expect(res.headers.get('etag')).toBe(etag);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=300, stale-while-revalidate=86400',
    );
    expect(res.headers.get('vary')).toBe('Accept-Encoding');
  });

  it('6. If-None-Match NOT matching returns 200 fresh body', async () => {
    mockVersion = makeVersion();
    mockFields = [makeField()];
    const app = createTestApp();
    const res = await request(app, '/api/forms/DE/2024/mantelbogen', {
      headers: { 'If-None-Match': '"deadbeef"' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.contentHash).toBe(mockVersion.contentHash);
    expect(Array.isArray(body.fields)).toBe(true);
  });

  it('7. invalid country (lowercase, wrong length) returns 400 with Zod issues', async () => {
    const app = createTestApp();
    // Lowercase
    const res1 = await request(app, '/api/forms/de/2024/mantelbogen');
    expect(res1.status).toBe(400);
    const body1 = (await res1.json()) as Record<string, unknown>;
    expect(body1.error).toBe('validation');
    expect(Array.isArray(body1.issues)).toBe(true);
    expect((body1.issues as unknown[]).length).toBeGreaterThan(0);
    // Wrong length
    const res2 = await request(app, '/api/forms/DEU/2024/mantelbogen');
    expect(res2.status).toBe(400);
    const body2 = (await res2.json()) as Record<string, unknown>;
    expect(body2.error).toBe('validation');
  });

  it('8. invalid year (non-numeric, out of range) returns 400 with Zod issues', async () => {
    const app = createTestApp();
    // Non-numeric — Zod coerce treats this as NaN → fails int check
    const res1 = await request(app, '/api/forms/DE/abcd/mantelbogen');
    expect(res1.status).toBe(400);
    const body1 = (await res1.json()) as Record<string, unknown>;
    expect(body1.error).toBe('validation');
    expect(Array.isArray(body1.issues)).toBe(true);
    // Below min
    const res2 = await request(app, '/api/forms/DE/2019/mantelbogen');
    expect(res2.status).toBe(400);
    // Above max
    const res3 = await request(app, '/api/forms/DE/2100/mantelbogen');
    expect(res3.status).toBe(400);
  });

  it('9. invalid form (uppercase, invalid chars) returns 400 with Zod issues', async () => {
    const app = createTestApp();
    // Uppercase
    const res1 = await request(app, '/api/forms/DE/2024/Mantelbogen');
    expect(res1.status).toBe(400);
    const body1 = (await res1.json()) as Record<string, unknown>;
    expect(body1.error).toBe('validation');
    expect(Array.isArray(body1.issues)).toBe(true);
    // Invalid char: hyphen
    const res2 = await request(app, '/api/forms/DE/2024/mantel-bogen');
    expect(res2.status).toBe(400);
    const body2 = (await res2.json()) as Record<string, unknown>;
    expect(body2.error).toBe('validation');
  });

  it('10. non-existent mapping returns 404 with structured error body', async () => {
    mockVersion = null; // no version exists
    const app = createTestApp();
    const res = await request(app, '/api/forms/PT/2024/irs');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('form_mapping_not_found');
    expect(body.country).toBe('PT');
    expect(body.year).toBe(2024);
    expect(body.form).toBe('irs');
  });

  it('11. soft-deleted field rows are excluded from the fields[] array', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({ id: 'live-1', fieldName: 'income.salary', deletedAt: null }),
      makeField({
        id: 'dead-1',
        fieldName: 'income.removed',
        deletedAt: 1700000000000,
      }),
      makeField({ id: 'live-2', fieldName: 'income.bonus', deletedAt: null }),
    ];
    const app = createTestApp();
    const res = await request(app, '/api/forms/DE/2024/mantelbogen');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fields: Array<{ key: string }> };
    expect(body.fields).toHaveLength(2);
    const keys = body.fields.map((f) => f.key);
    expect(keys).toContain('income.salary');
    expect(keys).toContain('income.bonus');
    expect(keys).not.toContain('income.removed');
  });

  it('12. field rows with NULL version_id (legacy) are included', async () => {
    mockVersion = makeVersion({ version: 1 });
    mockFields = [
      makeField({ id: 'legacy-1', fieldName: 'legacy.field', versionId: null }),
      makeField({ id: 'new-1', fieldName: 'new.field', versionId: 1 }),
    ];
    const app = createTestApp();
    const res = await request(app, '/api/forms/DE/2024/mantelbogen');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fields: Array<{ key: string }> };
    expect(body.fields).toHaveLength(2);
    const keys = body.fields.map((f) => f.key);
    expect(keys).toContain('legacy.field');
    expect(keys).toContain('new.field');
  });

  it('13. field count matches the number of inserted active rows', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({ id: 'a', fieldName: 'a' }),
      makeField({ id: 'b', fieldName: 'b' }),
      makeField({ id: 'c', fieldName: 'c' }),
      makeField({ id: 'd', fieldName: 'd' }),
      makeField({ id: 'e', fieldName: 'e' }),
      // One soft-deleted, must not count
      makeField({ id: 'x', fieldName: 'x', deletedAt: 1700000000000 }),
    ];
    const app = createTestApp();
    const res = await request(app, '/api/forms/DE/2024/mantelbogen');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fields: unknown[] };
    expect(body.fields).toHaveLength(5);
  });
});

// ── POST /api/forms/:c/:y/:f/render (W4 T3.2) ─────────────────────────────

/**
 * Decompress every Contents stream on `pageIdx` and return concatenated
 * latin1 text. Mirrors the helper in src/forms/render/watermark.test.ts —
 * inlined here so this file doesn't depend on test-internal exports.
 */
function decodePageContentStream(pdf: PDFDocument, pageIdx: number): string {
  const page = pdf.getPage(pageIdx);
  const ctx = pdf.context;
  const contents = page.node.Contents();
  if (!contents) return '';

  const items =
    typeof (contents as { asArray?: () => unknown[] }).asArray === 'function'
      ? (contents as { asArray: () => unknown[] }).asArray()
      : [contents];

  let combined = '';
  for (const item of items) {
    const stream = ctx.lookup(item as never) as { contents?: Uint8Array };
    const raw = stream?.contents;
    if (!raw) continue;
    try {
      combined += inflateSync(Buffer.from(raw)).toString('latin1');
    } catch {
      combined += Buffer.from(raw).toString('latin1');
    }
  }
  return combined;
}

/** Pull every Tj literal/hex string operand from a decoded content stream. */
function extractTjStrings(decoded: string): string {
  let out = '';
  for (const m of decoded.matchAll(/\(([^)]*)\)\s*Tj/g)) {
    out += m[1];
  }
  for (const m of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    const hex = m[1];
    let s = '';
    for (let i = 0; i < hex.length; i += 2) {
      s += String.fromCharCode(Number.parseInt(hex.substring(i, i + 2), 16));
    }
    out += s;
  }
  return out;
}

// Minimal KVNamespace stub (Map-backed) — captures every put() so tests
// can assert on counter values.
interface KvPut {
  key: string;
  value: string;
  expirationTtl?: number;
}
function makeFakeKv() {
  const store = new Map<string, string>();
  const puts: KvPut[] = [];
  return {
    store,
    puts,
    kv: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
        puts.push({ key, value, expirationTtl: options?.expirationTtl });
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  };
}

/**
 * R2Bucket stub. When `bytes` is null the get() returns null (forcing the
 * synth fallback); when non-null the route uses them as the source PDF.
 */
function makeFakeR2(bytes: Uint8Array | null = null) {
  return {
    get: vi.fn(async (_key: string) => {
      if (!bytes) return null;
      return {
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    }),
  };
}

// Build a Hono test app with a session-injector middleware so the route's
// rate-limit + auth gates see a logged-in user. Mount formsRoutes the same
// way real production does.
function createPostTestApp(session: { user: { id: string } } | null = { user: { id: 'user-1' } }) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (session) c.set('session', session);
    await next();
  });
  app.route('/api/forms', formsRoutes);
  return app;
}

function postJson(
  app: ReturnType<typeof createPostTestApp>,
  path: string,
  body: unknown,
  env: { KV: unknown; R2: unknown; DB?: unknown },
  extraInit: RequestInit = {},
) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(extraInit.headers ?? {}),
      },
      body: JSON.stringify(body),
      ...extraInit,
    },
    { DB: env.DB ?? {}, KV: env.KV, R2: env.R2 } as unknown as Bindings,
  );
}

describe('POST /api/forms/:country/:year/:form/render', () => {
  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-03T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. without auth returns 401 unauthorized', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_first_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        xCoord: null,
        yCoord: null,
      }),
    ];
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp(null); // no session
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: {} },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
    // KV never written for a refused request.
    expect(fakeKv.puts).toHaveLength(0);
  });

  it('2. authed + valid mapping + minimal data returns 200 with application/pdf body', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_first_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        xCoord: null,
        yCoord: null,
      }),
    ];
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2(); // null → synth fallback
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } } },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // PDF magic: "%PDF"
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
  });

  it('3. invalid country (lowercase) returns 400 validation', async () => {
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/de/2024/mantelbogen/render',
      { data: {} },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('validation');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('4. non-existent form returns 404 form_mapping_not_found', async () => {
    mockVersion = null;
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/PT/2024/irs/render',
      { data: {} },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('form_mapping_not_found');
    expect(body.country).toBe('PT');
    expect(body.year).toBe(2024);
    expect(body.form).toBe('irs');
  });

  it('5. zero active rows returns 422 no_active_mapping_fields', async () => {
    mockVersion = makeVersion();
    mockFields = []; // version exists but no fields
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: {} },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('no_active_mapping_fields');
  });

  it('6. malformed JSON body returns 400 validation', async () => {
    mockVersion = makeVersion();
    mockFields = [makeField({ fieldKind: 'acroform', xCoord: null, yCoord: null })];
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    // Send invalid JSON directly.
    const res = await app.request(
      '/api/forms/DE/2024/mantelbogen/render',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json',
      },
      { DB: {}, KV: fakeKv.kv, R2: fakeR2 } as unknown as Bindings,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('validation');
  });

  it('7. 11 requests in same window — last is 429 with Retry-After header', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_first_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        xCoord: null,
        yCoord: null,
      }),
    ];
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();

    for (let i = 0; i < 10; i++) {
      const ok = await postJson(
        app,
        '/api/forms/DE/2024/mantelbogen/render',
        { data: { user: { firstName: 'Alice' } } },
        { KV: fakeKv.kv, R2: fakeR2 },
      );
      expect(ok.status).toBe(200);
    }

    const blocked = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } } },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await blocked.json()) as Record<string, unknown>;
    expect(body.error).toBe('rate_limited');
  });

  it('8. watermark:false produces a PDF that does NOT contain "DRAFT" text', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_first_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        xCoord: null,
        yCoord: null,
      }),
    ];
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } }, watermark: false },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    let foundDraft = false;
    for (let i = 0; i < pdf.getPageCount(); i++) {
      const text = extractTjStrings(decodePageContentStream(pdf, i));
      if (text.includes('DRAFT')) {
        foundDraft = true;
        break;
      }
    }
    expect(foundDraft).toBe(false);
  });

  it('9. unknown PDF field surfaces as X-Render-Warnings: 1 / Filled-Fields: 0', async () => {
    // The synth fallback builds widgets for every acroform row. To exercise
    // the warning path we declare a field whose pdfField (`field_name`)
    // doesn't appear in defaultMantelStyleFields' preset AND the catch-all
    // fallback's name doesn't match a real widget — easier: use
    // `txt_first_name` (preset) but point sourcePath at a path that has
    // no value, so getByPath returns undefined → warning surfaces.
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_first_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.missingPath',
        xCoord: null,
        yCoord: null,
      }),
    ];
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } } }, // wrong path
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-render-warnings')).toBe('1');
    expect(res.headers.get('x-render-filled-fields')).toBe('0');
  });

  it('10. response carries X-Render-Mapping-Version + X-Render-Mapping-Hash headers', async () => {
    mockVersion = makeVersion({ version: 7 });
    mockFields = [
      makeField({
        fieldName: 'txt_first_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        xCoord: null,
        yCoord: null,
      }),
    ];
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } } },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-render-mapping-version')).toBe('7');
    expect(res.headers.get('x-render-mapping-hash')).toBe(mockVersion?.contentHash);
  });

  it('11. R2-returned bytes are used as the source PDF (proven via distinctive field name)', async () => {
    // Build an R2 source PDF carrying a widget called `txt_r2_unique_name`.
    // Mapping declares the same name. fillForm setText() will succeed
    // (filledFieldCount=1) only if the source bytes came from R2 — the
    // synth fallback would build a different field set and produce a
    // warning instead.
    const r2SourcePdf = await buildSynthPdfWithAcroForm({
      fields: [
        {
          name: 'txt_r2_unique_name',
          kind: 'text',
          x: 100,
          y: 700,
          width: 200,
          height: 18,
        },
      ],
    });
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_r2_unique_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        pdfR2Key: 'tax-forms/DE/2024/mantelbogen.pdf',
        xCoord: null,
        yCoord: null,
      }),
    ];
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2(r2SourcePdf);
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } } },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(200);
    expect(fakeR2.get).toHaveBeenCalledWith('tax-forms/DE/2024/mantelbogen.pdf');
    expect(res.headers.get('x-render-filled-fields')).toBe('1');
    expect(res.headers.get('x-render-warnings')).toBe('0');
  });

  it('12. response sets Cache-Control: no-store, private (no edge caching)', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_first_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        xCoord: null,
        yCoord: null,
      }),
    ];
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } } },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store, private');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="DE-2024-mantelbogen-draft.pdf"',
    );
  });
});
