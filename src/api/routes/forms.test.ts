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
  // Oracle P2-A (W4 review): per-field render transform. Migration 0005
  // added this column with `NOT NULL DEFAULT 'none'`, so existing test
  // fixtures that don't set it explicitly still behave as before.
  transform: string;
}

let mockVersion: VersionRow | null = null;
let mockFields: FieldRow[] = [];

function resetMocks() {
  mockVersion = null;
  mockFields = [];
  resetDbMocks();
}

// Mock the helpers the route imports from db/queries/form-mappings:
//   - `currentMappingVersion(db, country, form, year)` → version row or null
//   - `eqAllActive(predicates)` → opaque SQL composite (we just pass-through;
//     the in-memory mock fakes the `deletedAt IS NULL` narrowing itself)
//   - `withActiveFilter(extra)` → kept for tests that still reach for it
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
  // Pass-throughs: the real impls return SQL; the route just hands it to
  // .where() which our mock ignores.
  eqAllActive: vi.fn((preds: unknown) => preds),
  withActiveFilter: vi.fn((extra: unknown) => extra),
}));

// Drizzle chain mock — supports:
//   - db.select().from(table).where(cond) → Promise<rows[]>
//   - db.select(cols).from(users).where(cond).limit(N) → Promise<rows[]>
//     (used by requireAdminIfWatermarkOff() for role lookup)
//   - db.insert(auditLog).values(row) → Promise<void>
//     (used by the watermark-off audit row write)
//   - db.insert(rateLimitCounters).values(row).onConflictDoUpdate(...).returning(...)
//     → Promise<[{count: number}]>
//     (Oracle P1-7: used by rateLimitD1 middleware for atomic counter upsert.
//      Simulates SQLite's INSERT…ON CONFLICT DO UPDATE per-row atomicity.)
let mockUserRoles: Map<string, 'admin' | 'user'> = new Map();
const insertedAuditRows: Array<Record<string, unknown>> = [];
// Oracle P1-7 (W4 review): per-(key, windowStart) counter rows for
// rateLimitD1. The map key is `${key}::${windowStart}`. We mutate counts
// in place so concurrent upserts see the latest value (mimics SQLite's
// row-level atomicity).
const mockRateLimitRows: Map<string, { key: string; windowStart: number; count: number }> =
  new Map();

function resetDbMocks() {
  mockUserRoles = new Map();
  insertedAuditRows.length = 0;
  mockRateLimitRows.clear();
}

vi.mock('../../db', () => {
  // `from(table)` returns an object that resolves to either the field rows
  // or the users role row depending on which table was passed. We detect
  // "users" by sniffing the proxy's own internal id; the simplest reliable
  // approach is checking whether the chain ends with .limit() — only the
  // users role lookup calls .limit(1) before awaiting.
  const makeChain = (resolver: () => Promise<unknown>) => {
    const where = vi.fn(async (_cond: unknown) => resolver());
    const limit = vi.fn(async (_n: number) => resolver());
    return {
      where: vi.fn((_cond: unknown) => ({
        limit,
        // Allow direct `await` too (for the field-row path that has no .limit()).
        // biome-ignore lint/suspicious/noThenProperty: thenable shape is required to mimic drizzle's awaitable query builder
        then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          resolver().then(onFulfilled, onRejected),
      })),
      // Direct .where invocation that immediately awaits (no .limit())
      __where: where,
    };
  };

  const fromFieldMappings = () => Promise.resolve(mockFields.filter((r) => r.deletedAt === null));
  // Users-role lookups: pull from mockUserRoles. The session id is keyed by
  // the value in the WHERE clause — but our mock doesn't unpack SQL, so we
  // collapse to "first matching role". Tests inject either zero or one row.
  const fromUsers = () => {
    const entries = [...mockUserRoles.entries()];
    if (entries.length === 0) return Promise.resolve([]);
    const [, role] = entries[0] as [string, string];
    return Promise.resolve([{ role }]);
  };

  let nextResolver: () => Promise<unknown> = fromFieldMappings;
  const from = vi.fn((table: unknown) => {
    // Heuristic table sniff: drizzle table objects expose a Symbol.for('drizzle:Name')
    const name = String((table as { [k: symbol]: unknown })[Symbol.for('drizzle:Name')] ?? '');
    nextResolver = name === 'users' ? fromUsers : fromFieldMappings;
    return makeChain(() => nextResolver());
  });
  const select = vi.fn((_cols?: unknown) => ({ from }));

  // db.insert(table).values(row) — capture audit rows; ignore others.
  // Oracle P1-7 (W4 review): also handles the rateLimitD1 upsert chain
  //   .insert(table).values(row).onConflictDoUpdate({...}).returning({...})
  // which returns [{count}].
  const insert = vi.fn((table: unknown) => {
    const tableName = String((table as { [k: symbol]: unknown })[Symbol.for('drizzle:Name')] ?? '');
    return {
      values: vi.fn((row: Record<string, unknown>) => {
        if (tableName === 'audit_log') {
          insertedAuditRows.push(row);
          // audit_log path is awaited directly — return a thenable.
          return Promise.resolve();
        }
        if (tableName === 'rate_limit_counters') {
          // rateLimitD1 upsert path — chainable to onConflictDoUpdate().returning().
          const key = String(row.key);
          const windowStart = Number(row.windowStart);
          const mapKey = `${key}::${windowStart}`;
          return {
            onConflictDoUpdate: vi.fn((_opts: unknown) => ({
              returning: vi.fn(async (_cols?: unknown) => {
                const existing = mockRateLimitRows.get(mapKey);
                if (existing) {
                  existing.count += 1;
                  mockRateLimitRows.set(mapKey, existing);
                  return [{ count: existing.count }];
                }
                const initial = { key, windowStart, count: Number(row.count) || 1 };
                mockRateLimitRows.set(mapKey, initial);
                return [{ count: initial.count }];
              }),
            })),
          };
        }
        // Default: swallow.
        return Promise.resolve();
      }),
    };
  });

  return {
    createDb: vi.fn(() => ({ select, insert })),
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
    // Oracle P2-A (W4 review): default to 'none' so existing tests
    // (which don't care about render-time value transforms) keep their
    // pre-P2-A behaviour. Tests that exercise the new pipeline override
    // this via the `overrides` arg.
    transform: 'none',
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
 *
 * Oracle P1-1 (W4 review): `overrideSize` lets tests assert the size-cap
 * branch (the route reads `obj.size` before allocating the arrayBuffer);
 * when omitted we report the true byte length.
 */
function makeFakeR2(bytes: Uint8Array | null = null, overrideSize?: number) {
  return {
    get: vi.fn(async (_key: string) => {
      if (!bytes) return null;
      return {
        size: overrideSize ?? bytes.byteLength,
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
    // Oracle P1-7 (W4 review): rate-limit row never written for a refused request.
    expect(fakeKv.puts).toHaveLength(0);
    expect(mockRateLimitRows.size).toBe(0);
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
    // Oracle P1-7 (W4 review): /render is now backed by rateLimitD1, so
    // the counter row should live in the D1 rate_limit_counters table —
    // not in KV. Verify both.
    expect(fakeKv.puts).toHaveLength(0);
    expect(mockRateLimitRows.size).toBe(1);
    const [row] = mockRateLimitRows.values();
    expect(row.count).toBe(11);
    expect(row.key).toBe('rl:render:user-1');
  });

  it('7a. ATOMICITY — parallel burst of 15 reqs: exactly 10 are 200, exactly 5 are 429 (Oracle P1-7)', async () => {
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
    // 15 concurrent renders against the 10/day cap — the D1-atomic
    // rateLimitD1 must reject EXACTLY 5 of them, never more, never less.
    // The KV-based variant cannot pass this test reliably because two
    // parallel reqs can both read count=N and both write count=N+1.
    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        postJson(
          app,
          '/api/forms/DE/2024/mantelbogen/render',
          { data: { user: { firstName: 'Alice' } } },
          { KV: fakeKv.kv, R2: fakeR2 },
        ),
      ),
    );
    const status200 = results.filter((r) => r.status === 200).length;
    const status429 = results.filter((r) => r.status === 429).length;
    expect(status200).toBe(10);
    expect(status429).toBe(5);
    // Only ONE row in D1 (single user × single window), final count = 15.
    expect(mockRateLimitRows.size).toBe(1);
    const [row] = mockRateLimitRows.values();
    expect(row.count).toBe(15);
  });

  it('8. watermark:false (admin) produces a PDF that does NOT contain "DRAFT" text + audit row + header', async () => {
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
    // Oracle P0-1 (W4 review): admin role required for watermark:false.
    mockUserRoles.set('user-1', 'admin');
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
    expect(res.headers.get('x-render-watermark')).toBe('off');
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
    // Exactly one audit row for the off-watermark render.
    expect(insertedAuditRows).toHaveLength(1);
    expect(insertedAuditRows[0]?.source).toBe('render-watermark-off');
    expect(insertedAuditRows[0]?.statusCode).toBe(200);
    expect(insertedAuditRows[0]?.userIdOrNull).toBe('user-1');
  });

  it('8a. watermark:false (non-admin) returns 403 watermark_off_admin_only + no audit row + no quota burn', async () => {
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
    mockUserRoles.set('user-1', 'user'); // explicitly non-admin
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } }, watermark: false },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('watermark_off_admin_only');
    // Oracle P1-7 (W4 review): No audit row + no rate-limit row (gate runs BEFORE rateLimitD1).
    expect(insertedAuditRows).toHaveLength(0);
    expect(fakeKv.puts).toHaveLength(0);
    expect(mockRateLimitRows.size).toBe(0);
  });

  it('8b. watermark:false (anon) returns 403 watermark_off_admin_only (gate runs before rateLimit)', async () => {
    mockVersion = makeVersion();
    mockFields = [makeField({ fieldKind: 'acroform', xCoord: null, yCoord: null })];
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp(null); // no session
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: {}, watermark: false },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('watermark_off_admin_only');
    expect(fakeKv.puts).toHaveLength(0);
    expect(mockRateLimitRows.size).toBe(0);
  });

  it('8c. watermark omitted (any user) → 200 + X-Render-Watermark: on + no extra audit row', async () => {
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
    mockUserRoles.set('user-1', 'user'); // non-admin still fine because no opt-out
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } } }, // no watermark field
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-render-watermark')).toBe('on');
    expect(insertedAuditRows).toHaveLength(0);
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

  // ── Oracle P0-2 (W4 review): TBD_* placeholder refusal ───────────────
  it('13. mapping with any TBD_* acroform field returns 422 mapping_unverified + X-Render-Mapping-Status: placeholder', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_real_field',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        xCoord: null,
        yCoord: null,
      }),
      makeField({
        id: 'tbd-1',
        fieldName: 'TBD_unknown_widget',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.foo',
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
      { data: {} },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(422);
    expect(res.headers.get('x-render-mapping-status')).toBe('placeholder');
    const body = (await res.json()) as {
      error?: string;
      placeholderFieldCount?: number;
      sample?: string[];
    };
    expect(body.error).toBe('mapping_unverified');
    expect(body.placeholderFieldCount).toBe(1);
    expect(body.sample).toEqual(['TBD_unknown_widget']);
  });

  it('14. mapping with NO TBD_* fields still renders 200 (TBD check is additive)', async () => {
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
    expect(res.headers.get('x-render-mapping-status')).toBeNull();
  });

  it('15. coordinate field named TBD_xxx is NOT refused (only acroform placeholders matter)', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'TBD_coord_anchor',
        fieldKind: 'coordinate',
        fieldType: 'text',
        dataPath: 'user.firstName',
        xCoord: 100,
        yCoord: 100,
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
  });

  // ── Oracle P1-1 (W4 review): R2 source-PDF size + page-count caps ────
  it('16. rejects R2 object exceeding MAX_PDF_BYTES with 502 source_pdf_too_large + X-Render-Reject-Reason: r2_size', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_first_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        pdfR2Key: 'tax-forms/DE/2024/huge.pdf',
        xCoord: null,
        yCoord: null,
      }),
    ];
    const fakeKv = makeFakeKv();
    // Body bytes are irrelevant — the route checks obj.size first.
    const tinyBytes = await buildSynthPdfWithAcroForm({
      fields: [{ name: 'txt_first_name', kind: 'text', x: 100, y: 700, width: 200, height: 18 }],
    });
    const fakeR2 = makeFakeR2(tinyBytes, 11_000_000);
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } } },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(502);
    expect(res.headers.get('x-render-reject-reason')).toBe('r2_size');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('source_pdf_too_large');
    expect(body.sizeBytes).toBe(11_000_000);
    expect(body.limitBytes).toBe(10 * 1024 * 1024);
  });

  it('17. rejects R2 object with too many pages (>50) with 502 source_pdf_too_many_pages + X-Render-Reject-Reason: r2_pages', async () => {
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_first_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        pdfR2Key: 'tax-forms/DE/2024/longform.pdf',
        xCoord: null,
        yCoord: null,
      }),
    ];
    const fakeKv = makeFakeKv();
    // 51-page synth PDF — over the 50-page MAX_PDF_PAGES cap.
    const longPdf = await buildSynthPdfWithAcroForm({
      pageCount: 51,
      fields: [{ name: 'txt_first_name', kind: 'text', x: 100, y: 700, width: 200, height: 18 }],
    });
    const fakeR2 = makeFakeR2(longPdf);
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: { user: { firstName: 'Alice' } } },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(502);
    expect(res.headers.get('x-render-reject-reason')).toBe('r2_pages');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('source_pdf_too_many_pages');
    expect(body.pageCount).toBe(51);
    expect(body.limit).toBe(50);
  });

  // ── Oracle P1-2 (W4 review): request-body size cap + audit-log ────
  it('18. rejects POST body > 256 KiB with 413 body_too_large', async () => {
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
    // ~300 KiB payload — over the 256 KiB cap.
    const huge = { data: { user: { firstName: 'A'.repeat(300 * 1024) } } };
    const res = await postJson(app, '/api/forms/DE/2024/mantelbogen/render', huge, {
      KV: fakeKv.kv,
      R2: fakeR2,
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('body_too_large');
    expect(body.limitBytes).toBe(256 * 1024);
    // Oracle P1-7 (W4 review): bodyLimit refuses BEFORE rateLimitD1 — no
    // KV write AND no D1 rate-limit row should exist.
    expect(fakeKv.puts).toHaveLength(0);
    expect(mockRateLimitRows.size).toBe(0);
  });

  // ── Oracle P1-6 (W4 review): country narrowed by FormMappingSchema ──
  it('19. rejects unsupported country code ZZ on POST with 400 validation', async () => {
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/ZZ/2024/mantelbogen/render',
      { data: {} },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('validation');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('20. rejects unsupported country code ZZ on GET with 400 validation', async () => {
    const app = createTestApp();
    const res = await request(app, '/api/forms/ZZ/2024/mantelbogen');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('validation');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  // ── Oracle P1-3 (W4 review): X-Render-Warning-Detail ────────────────
  it('21. POST /render emits X-Render-Warning-Detail as JSON-encoded array when warnings exist', async () => {
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
    const detailRaw = res.headers.get('x-render-warning-detail');
    expect(detailRaw).toBeTruthy();
    const detail = JSON.parse(detailRaw ?? '{}') as {
      items: Array<{ dataPath: string; fieldName: string; reason: string }>;
      truncated: boolean;
      total: number;
    };
    expect(detail.total).toBe(1);
    expect(detail.truncated).toBe(false);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]?.dataPath).toBe('user.missingPath');
    expect(detail.items[0]?.fieldName).toBe('txt_first_name');
    expect(detail.items[0]?.reason).toBe('missing-data');
  });

  it('22. X-Render-Warning-Detail truncates to 10 entries with truncated:true', async () => {
    mockVersion = makeVersion();
    // 11 coordinate fields each pointing at a missing path → 11 warnings,
    // exceeding the 10-item cap so we exercise the truncation branch.
    // Coordinate fields skip AcroForm widget creation in the synth fallback,
    // keeping the test fast and avoiding any preset-name collisions.
    mockFields = Array.from({ length: 11 }, (_, idx) =>
      makeField({
        id: `f${idx}`,
        fieldName: `coord_field_${idx}`,
        fieldKind: 'coordinate',
        fieldType: 'text',
        dataPath: `user.missing_${idx}`,
        pageNumber: 0,
        xCoord: 50 + idx * 10,
        yCoord: 700 - idx * 20,
        fontSize: 10,
      }),
    );
    const fakeKv = makeFakeKv();
    const fakeR2 = makeFakeR2();
    const app = createPostTestApp();
    const res = await postJson(
      app,
      '/api/forms/DE/2024/mantelbogen/render',
      { data: {} }, // no data → every field warns
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-render-warnings')).toBe('11');
    const detail = JSON.parse(res.headers.get('x-render-warning-detail') ?? '{}') as {
      items: unknown[];
      truncated: boolean;
      total: number;
    };
    expect(detail.total).toBe(11);
    expect(detail.truncated).toBe(true);
    expect(detail.items).toHaveLength(10);
  }, 20000);

  it('23. X-Render-Warning-Detail items=[] truncated:false when no warnings', async () => {
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
    expect(res.headers.get('x-render-warnings')).toBe('0');
    const detail = JSON.parse(res.headers.get('x-render-warning-detail') ?? '{}') as {
      items: unknown[];
      truncated: boolean;
      total: number;
    };
    expect(detail.total).toBe(0);
    expect(detail.truncated).toBe(false);
    expect(detail.items).toEqual([]);
  });

  // ── Oracle P2-A (W4 review): per-field transform from D1 → /render ────
  //
  // Regression guard for the legal-correctness bug fixed by migration 0005:
  // the /render handler used to hard-code `transform: 'none'` on every
  // field, so `format-date-de` was a silent no-op (German tax forms got
  // ISO timestamps). These tests pin the wire: D1 row's `transform`
  // column flows through to fillForm and the rendered PDF carries the
  // transformed value.

  it("24. POST /render applies field.transform=format-date-de from D1 row (renders '03.06.2026' not ISO)", async () => {
    const { PDFDocument } = await import('pdf-lib');
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_first_name', // re-using the synth widget slot for assertion
        fieldKind: 'acroform',
        fieldType: 'date',
        dataPath: 'user.profile.dateOfBirth',
        transform: 'format-date-de', // ← the column under test
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
      {
        data: {
          user: { profile: { dateOfBirth: '2026-06-03T12:00:00.000Z' } },
        },
      },
      { KV: fakeKv.kv, R2: fakeR2 },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    const pdfBytes = new Uint8Array(await res.arrayBuffer());
    const pdf = await PDFDocument.load(pdfBytes);
    const value = pdf.getForm().getTextField('txt_first_name').getText() ?? '';
    // Before P2-A: '2026-06-03T12:00:00.000Z' (raw input, transform dropped).
    // After  P2-A: '03.06.2026' (format-date-de applied).
    expect(value).toBe('03.06.2026');
  }, 20000);

  it("25. POST /render coerces an unknown/garbage transform value to 'none' instead of throwing 500", async () => {
    const { PDFDocument } = await import('pdf-lib');
    mockVersion = makeVersion();
    mockFields = [
      makeField({
        fieldName: 'txt_first_name',
        fieldKind: 'acroform',
        fieldType: 'text',
        dataPath: 'user.firstName',
        // Simulates a manual D1 edit / future schema drift writing a value
        // that's not in TransformSchema. Route must degrade to 'none'
        // (raw passthrough) — never throw, never 500.
        transform: 'definitely-not-a-real-transform-id',
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
    const pdfBytes = new Uint8Array(await res.arrayBuffer());
    const pdf = await PDFDocument.load(pdfBytes);
    const value = pdf.getForm().getTextField('txt_first_name').getText() ?? '';
    // Coerced to 'none' → raw value written verbatim.
    expect(value).toBe('Alice');
    // No 'transform-failed' warning (because the coercion happened in the
    // route before fillForm ever saw the bad id).
    expect(res.headers.get('x-render-warnings')).toBe('0');
  }, 20000);
});
