/**
 * Audit middleware — unit tests.
 *
 * Tests the hash-only audit logging middleware in isolation using a minimal
 * Hono app. Mocks D1 via vi.mock on createDb; verifies the values passed to
 * auditLog insert without hitting real D1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { auditMiddleware } from './audit';

// ── Module-level mocks ─────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockValues = vi.fn();

vi.mock('../../db', () => ({
  createDb: vi.fn(() => ({
    insert: mockInsert,
  })),
}));

// Captures the last values object passed to auditLog insert
interface AuditValues {
  id?: string;
  timestamp?: number;
  userIdOrNull?: string | null;
  route?: string;
  method?: string;
  inputHash?: string | null;
  resultHash?: string | null;
  statusCode?: number;
  source?: string;
}
let lastAuditValues: AuditValues | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  lastAuditValues = null;
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockImplementation((values: AuditValues) => {
    lastAuditValues = values;
    return Promise.resolve();
  });
});

// ── Test app factory ───────────────────────────────────────────────────────

const mockEnv = { DB: {} as never };

function createTestApp(session: unknown = null) {
  const app = new Hono<{ Bindings: { DB: never }; Variables: { session?: { user: { id: string } } } }>();

  // Session mock middleware (runs before audit)
  app.use('*', async (c, next) => {
    if (session) c.set('session', session as { user: { id: string } });
    await next();
  });

  // Audit middleware — mounts on /api/test/*
  app.use('/api/test', auditMiddleware());
  app.use('/api/test/*', auditMiddleware());

  // POST echo route
  app.post('/api/test/echo', async (c) => {
    const body = await c.req.json();
    return c.json(body);
  });

  // GET hello route
  app.get('/api/test/hello', async (c) => c.json({ message: 'hello' }));

  // POST route that always throws
  app.post('/api/test/error', async () => {
    throw new Error('handler exploded');
  });

  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('auditMiddleware', () => {
  it('writes audit row with inputHash for POST requests', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });

    const res = await app.request('/api/test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    }, mockEnv);

    expect(res.status).toBe(200);
    expect(lastAuditValues).not.toBeNull();
    expect(lastAuditValues!.method).toBe('POST');
    expect(lastAuditValues!.inputHash).toBeTruthy();
    expect(typeof lastAuditValues!.inputHash).toBe('string');
    expect((lastAuditValues!.inputHash as string).length).toBe(64); // SHA-256 hex
  });

  it('GET requests skip audit entirely (no D1 row written)', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });

    const res = await app.request('/api/test/hello', undefined, mockEnv);
    expect(res.status).toBe(200);
    // Oracle P1-NEW-2: GET/HEAD short-circuit — no audit row at all.
    expect(lastAuditValues).toBeNull();
  });

  it('sets userIdOrNull to null for anonymous requests', async () => {
    const app = createTestApp(null); // no session

    await app.request('/api/test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 1 }),
    }, mockEnv);

    expect(lastAuditValues).not.toBeNull();
    expect(lastAuditValues!.userIdOrNull).toBeNull();
  });

  it('sets userIdOrNull from session for authenticated requests', async () => {
    const app = createTestApp({ user: { id: 'user-42' } });

    await app.request('/api/test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 1 }),
    }, mockEnv);

    expect(lastAuditValues).not.toBeNull();
    expect(lastAuditValues!.userIdOrNull).toBe('user-42');
  });

  it('writes audit row with statusCode 5xx when handler throws', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });

    const res = await app.request('/api/test/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'error' }),
    }, mockEnv);

    expect(res.status).toBe(500);
    expect(lastAuditValues).not.toBeNull();
    expect(lastAuditValues!.statusCode).toBe(500);
  });

  it('handles large body (>64KB) without crashing', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const largeBody = 'x'.repeat(70_000); // ~70 KB

    const res = await app.request('/api/test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: largeBody }),
    }, mockEnv);

    expect(res.status).toBe(200);
    expect(lastAuditValues).not.toBeNull();
    expect(lastAuditValues!.inputHash).toBeTruthy();
    expect((lastAuditValues!.inputHash as string).length).toBe(64);
  });

  it('records correct route and method metadata (POST)', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });

    await app.request('/api/test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 1 }),
    }, mockEnv);
    expect(lastAuditValues!.route).toBe('/api/test/echo');
    expect(lastAuditValues!.method).toBe('POST');
    expect(lastAuditValues!.source).toBe('api');
  });

  it('oversized body (Content-Length > 1MB) sets inputHash to "oversized" without reading full body', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });

    const res = await app.request('/api/test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '2000000' },
      body: JSON.stringify({ small: 'payload' }),
    }, mockEnv);

    expect(res.status).toBe(200);
    expect(lastAuditValues).not.toBeNull();
    expect(lastAuditValues!.inputHash).toBe('oversized');
  });

  it('100KB body with 64KB cap: only hashes first 64KB, no crash', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const body = JSON.stringify({ data: 'x'.repeat(100 * 1024) });

    const res = await app.request('/api/test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, mockEnv);

    expect(res.status).toBe(200);
    expect(lastAuditValues).not.toBeNull();
    expect(lastAuditValues!.inputHash).toBeTruthy();
    expect((lastAuditValues!.inputHash as string).length).toBe(64);

    // Verify it's the hash of only the first 64KB
    const encoder = new TextEncoder();
    const first64k = encoder.encode(body).subarray(0, 65536);
    const expectedHash = await crypto.subtle.digest('SHA-256', first64k);
    const expectedHex = [...new Uint8Array(expectedHash)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(lastAuditValues!.inputHash).toBe(expectedHex);
  });

  // ── Oracle P1-NEW-1 (W5-A followup) ────────────────────────────────
  it('large response body (>64KB) hashes only the first 64KB slice', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    // Push a 100 KB string back through the echo route so the response
    // body is at least MAX_HASH_BYTES + change. JSON.stringify adds ~12
    // bytes of envelope which is fine — we assert against the slice.
    const largeValue = 'y'.repeat(100 * 1024);
    const res = await app.request('/api/test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: largeValue }),
    }, mockEnv);
    expect(res.status).toBe(200);

    // Re-derive the exact bytes hono returned to verify the slice.
    // app.request returns a fresh response with the same body each call,
    // but the audit middleware has already snapshotted resultHash via
    // its own clone — we re-clone here to compute the expected slice.
    const fullBuf = new Uint8Array(await res.clone().arrayBuffer());
    expect(fullBuf.byteLength).toBeGreaterThan(65536);

    const sliceBuf = fullBuf.slice(0, 65536);
    const expectedDigest = await crypto.subtle.digest('SHA-256', sliceBuf);
    const expectedHex = [...new Uint8Array(expectedDigest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Audit middleware must have hashed only the slice, not the full body.
    expect(lastAuditValues!.resultHash).toBe(expectedHex);

    // Defensive: confirm full-body hash is NOT what got recorded.
    const fullDigest = await crypto.subtle.digest('SHA-256', fullBuf);
    const fullHex = [...new Uint8Array(fullDigest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(lastAuditValues!.resultHash).not.toBe(fullHex);
  });

  // ── Oracle P1-NEW-2 (W5-A followup) ────────────────────────────────
  it('HEAD requests skip audit entirely (no D1 row written)', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    // Hono's default HEAD handling on a GET route still flows through
    // middleware; the short-circuit must catch it.
    const res = await app.request('/api/test/hello', { method: 'HEAD' }, mockEnv);
    // hono may return 200 or 404 for HEAD on a GET-only route; what we
    // assert here is the audit-skip, not the response shape.
    expect([200, 404]).toContain(res.status);
    expect(lastAuditValues).toBeNull();
  });
});
