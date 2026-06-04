// Oracle P1-7 (W4 review): tests for D1-atomic rate-limit middleware.
/**
 * rate-limit-d1.test.ts — Unit tests for the D1-backed atomic rate limiter.
 *
 * Uses a Map-backed fake that SIMULATES SQLite's `INSERT … ON CONFLICT
 * (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`
 * — i.e. each call increments exactly once, even when invoked
 * concurrently from JS (JS is single-threaded so the fake's increment
 * is trivially atomic; the assertion is that the middleware actually
 * uses this atomic path and the cap math is correct).
 *
 * The headline test (test 4) fires (max + 5) concurrent requests via
 * `Promise.all` and asserts EXACTLY `max` succeed with 200 and EXACTLY
 * `5` are rejected with 429 — this proves there's no read-then-write
 * race window in the middleware itself (the KV version cannot pass this
 * test reliably; the D1 version always does).
 */

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings, Variables } from '../index';

// ── Mock D1 (createDb) ─────────────────────────────────────────────────────
//
// We mock the `createDb` factory in `../../db` so the middleware's
// `db.insert(rateLimitCounters).values(...).onConflictDoUpdate(...).returning(...)`
// chain hits an in-memory Map. Each (key, windowStart) pair owns a single
// row whose `count` is incremented atomically per `.returning(...)` call.

interface CounterRow {
  key: string;
  windowStart: number;
  count: number;
  expiresAt: number;
}

let mockStore: Map<string, CounterRow>;
let mockD1ShouldThrow: boolean;
let upsertCalls: Array<{ key: string; windowStart: number }>;

function resetMockStore() {
  mockStore = new Map();
  mockD1ShouldThrow = false;
  upsertCalls = [];
}

function rowKey(key: string, windowStart: number) {
  return `${key}::${windowStart}`;
}

vi.mock('../../db', () => {
  // The middleware does:
  //   db.insert(table).values(row).onConflictDoUpdate({target, set}).returning({count})
  // We return a thenable builder so `await` on the final `.returning(...)`
  // resolves to the simulated row(s).
  const insert = vi.fn((_table: unknown) => ({
    values: vi.fn((row: CounterRow) => ({
      onConflictDoUpdate: vi.fn((_opts: unknown) => ({
        returning: vi.fn(async (_cols?: unknown) => {
          if (mockD1ShouldThrow) {
            throw new Error('simulated D1 failure');
          }
          const k = rowKey(row.key, row.windowStart);
          upsertCalls.push({ key: row.key, windowStart: row.windowStart });
          const existing = mockStore.get(k);
          if (existing) {
            // ON CONFLICT branch — increment.
            existing.count += 1;
            mockStore.set(k, existing);
            return [{ count: existing.count }];
          }
          // INSERT branch — count starts at the supplied value (1 in the
          // middleware) and the row is created.
          mockStore.set(k, { ...row });
          return [{ count: row.count }];
        }),
      })),
    })),
  }));
  return {
    createDb: vi.fn(() => ({ insert })),
  };
});

// Import AFTER vi.mock so the middleware picks up the mocked `createDb`.
import { rateLimitD1 } from './rate-limit-d1';

// ── Test app factory ───────────────────────────────────────────────────────

function createTestApp(
  opts: Parameters<typeof rateLimitD1>[0],
  session: { user: { id: string } } | null = { user: { id: 'user-1' } },
) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (session) c.set('session', session);
    await next();
  });
  app.use('*', rateLimitD1(opts));
  app.get('/ping', (c) => c.json({ ok: true }));
  // DB binding is opaque to the mock — `createDb` is mocked above.
  return {
    app,
    request: (init?: RequestInit) => app.request('/ping', init, { DB: {} } as unknown as Bindings),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('rateLimitD1 middleware (Oracle P1-7)', () => {
  beforeEach(() => {
    resetMockStore();
    vi.useFakeTimers();
    // 2026-06-03T12:00:00.000Z = unix sec 1780488000
    vi.setSystemTime(new Date('2026-06-03T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. first request increments to 1, returns 200, headers expose remaining = max - 1', async () => {
    const { request } = createTestApp({
      windowSeconds: 86400,
      max: 10,
      keyPrefix: 'rl:test',
    });
    const res = await request();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ratelimit-limit')).toBe('10');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('9');
    expect(res.headers.get('x-ratelimit-reset')).toBeTruthy();
    // Exactly one row was upserted with count=1.
    expect(mockStore.size).toBe(1);
    const [row] = mockStore.values();
    expect(row.count).toBe(1);
    expect(row.key).toBe('rl:test:user-1');
  });

  it('2. Nth request where N === max returns 200 with X-RateLimit-Remaining = 0', async () => {
    const { request } = createTestApp({
      windowSeconds: 86400,
      max: 10,
      keyPrefix: 'rl:test',
    });
    let lastRes: Response | undefined;
    for (let i = 0; i < 10; i++) {
      lastRes = await request();
      expect(lastRes.status).toBe(200);
    }
    expect(lastRes?.headers.get('x-ratelimit-remaining')).toBe('0');
    const [row] = mockStore.values();
    expect(row.count).toBe(10);
  });

  it('3. N+1 request returns 429 with Retry-After + body.error = rate_limited', async () => {
    const { request } = createTestApp({
      windowSeconds: 86400,
      max: 10,
      keyPrefix: 'rl:test',
    });
    for (let i = 0; i < 10; i++) {
      await request();
    }
    const blocked = await request();
    expect(blocked.status).toBe(429);
    const retryAfter = blocked.headers.get('retry-after');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(blocked.headers.get('x-ratelimit-limit')).toBe('10');
    expect(blocked.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(blocked.headers.get('x-ratelimit-reset')).toBeTruthy();
    const body = (await blocked.json()) as Record<string, unknown>;
    expect(body.error).toBe('rate_limited');
    expect(body.limit).toBe(10);
    expect(body.windowSeconds).toBe(86400);
    expect(typeof body.resetAt).toBe('string');
  });

  it('4. ATOMICITY — concurrent burst of (max + 5) requests: exactly `max` are 200, exactly 5 are 429', async () => {
    const max = 10;
    const burst = max + 5;
    const { request } = createTestApp({
      windowSeconds: 86400,
      max,
      keyPrefix: 'rl:test',
    });
    // Fire all requests concurrently via Promise.all. The mock's upsert
    // is single-row atomic (Map.set is atomic in single-threaded JS), so
    // counts increment 1..burst and the middleware must reject those
    // where count > max.
    const results = await Promise.all(Array.from({ length: burst }, () => request()));
    const status200 = results.filter((r) => r.status === 200).length;
    const status429 = results.filter((r) => r.status === 429).length;
    expect(status200).toBe(max);
    expect(status429).toBe(5);
    // The DB saw exactly `burst` upserts (no read-then-write skips).
    expect(upsertCalls.length).toBe(burst);
    // Final stored count equals total requests (each upsert ran once).
    const [row] = mockStore.values();
    expect(row.count).toBe(burst);
  });

  it('5. distinct userIds get independent buckets (user A maxed, user B fresh)', async () => {
    const opts = { windowSeconds: 86400, max: 2, keyPrefix: 'rl:test' };
    const a = createTestApp(opts, { user: { id: 'user-A' } });
    await a.request();
    await a.request();
    const aBlocked = await a.request();
    expect(aBlocked.status).toBe(429);

    const b = createTestApp(opts, { user: { id: 'user-B' } });
    const bRes = await b.request();
    expect(bRes.status).toBe(200);
    expect(bRes.headers.get('x-ratelimit-remaining')).toBe('1');
    // Two distinct rows in the store now.
    expect(mockStore.size).toBe(2);
  });

  it('6. window rollover resets the counter (advance time past windowEnd)', async () => {
    const { request } = createTestApp({
      windowSeconds: 3600,
      max: 2,
      keyPrefix: 'rl:test',
    });
    await request();
    await request();
    const blocked = await request();
    expect(blocked.status).toBe(429);

    // Advance ONE hour + 1s into the next window.
    vi.setSystemTime(new Date(Date.now() + 3601 * 1000));
    const fresh = await request();
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get('x-ratelimit-remaining')).toBe('1');
    // A new row exists for the new windowStart bucket.
    expect(mockStore.size).toBe(2);
    const counts = [...mockStore.values()].map((r) => r.count).sort();
    expect(counts).toEqual([1, 3]); // old bucket maxed at 3 (count>max blocks), new bucket at 1
  });

  it('7. no session + requireSession defaults true returns 401 unauthorized', async () => {
    const { request } = createTestApp(
      { windowSeconds: 86400, max: 10, keyPrefix: 'rl:test' },
      null,
    );
    const res = await request();
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
    // No upsert ran when refusing pre-emptively.
    expect(upsertCalls.length).toBe(0);
  });

  it('8. D1 throws → 503 rate_limit_unavailable (fail-CLOSED, not fail-open)', async () => {
    mockD1ShouldThrow = true;
    const { request } = createTestApp({
      windowSeconds: 86400,
      max: 10,
      keyPrefix: 'rl:test',
    });
    // Suppress the error log so test output stays clean.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request();
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('rate_limit_unavailable');
    errorSpy.mockRestore();
  });

  it('9. no session + requireSession:false proceeds under shared "anon" bucket', async () => {
    const { request } = createTestApp(
      { windowSeconds: 86400, max: 5, keyPrefix: 'rl:test', requireSession: false },
      null,
    );
    const r1 = await request();
    expect(r1.status).toBe(200);
    const r2 = await request();
    expect(r2.status).toBe(200);
    // Both calls share the anon bucket.
    expect(mockStore.size).toBe(1);
    const [row] = mockStore.values();
    expect(row.count).toBe(2);
    expect(row.key).toBe('rl:test:anon');
  });

  it('10. constructor validation — bad inputs throw early', () => {
    expect(() => rateLimitD1({ windowSeconds: 0, max: 10, keyPrefix: 'x' })).toThrow(
      /windowSeconds/,
    );
    expect(() => rateLimitD1({ windowSeconds: 60, max: 0, keyPrefix: 'x' })).toThrow(/max/);
    expect(() => rateLimitD1({ windowSeconds: 60, max: 10, keyPrefix: '' })).toThrow(/keyPrefix/);
  });

  it('11. expires_at is set to windowEnd + grace (60s) for sweeper safety', async () => {
    const { request } = createTestApp({
      windowSeconds: 3600,
      max: 5,
      keyPrefix: 'rl:test',
    });
    await request();
    const [row] = mockStore.values();
    // 2026-06-03T12:00:00Z → unix 1780488000. windowSeconds=3600, so
    // windowStart=1780488000 (already aligned), windowEnd=1780491600,
    // expiresAt should be 1780491600 + 60 = 1780491660.
    expect(row.expiresAt).toBe(1780491660);
  });
});
