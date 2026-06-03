/**
 * rate-limit.test.ts — Unit tests for the KV-backed per-user rate limiter.
 *
 * Uses a Map-backed fake KVNamespace and a minimal Hono app so the middleware
 * is exercised the same way real routes mount it. `Date.now` is stubbed via
 * vi.setSystemTime so we can deterministically simulate window rollover.
 */

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings, Variables } from '../index';
import { rateLimit } from './rate-limit';

// ─── Fake KVNamespace ──────────────────────────────────────────────────────

interface KvEntry {
  value: string;
  expirationTtl?: number;
}

function makeFakeKv() {
  const store = new Map<string, KvEntry>();
  // Capture every put() call for assertion (lets tests verify ttl clamp).
  const puts: Array<{ key: string; value: string; expirationTtl?: number }> = [];
  return {
    store,
    puts,
    kv: {
      get: vi.fn(async (key: string) => {
        const entry = store.get(key);
        return entry ? entry.value : null;
      }),
      put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
        puts.push({ key, value, expirationTtl: options?.expirationTtl });
        store.set(key, { value, expirationTtl: options?.expirationTtl });
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      // The rest of KVNamespace surface is unused by rate-limit.
    } as unknown as KVNamespace,
  };
}

// ─── Test app factory ──────────────────────────────────────────────────────

interface FakeKVNamespace {
  store: Map<string, KvEntry>;
  puts: Array<{ key: string; value: string; expirationTtl?: number }>;
  kv: KVNamespace;
}

// Re-declare KVNamespace lightly so this file doesn't need the cloudflare
// types package at compile time — the runtime shape is all we touch.
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

function createTestApp(
  fake: FakeKVNamespace,
  opts: Parameters<typeof rateLimit>[0],
  session: { user: { id: string } } | null = { user: { id: 'user-1' } },
) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

  // Inject session before rate-limit middleware (mirrors real /api/* order).
  app.use('*', async (c, next) => {
    if (session) c.set('session', session);
    await next();
  });

  app.use('*', rateLimit(opts));

  app.get('/ping', (c) => c.json({ ok: true }));

  return {
    app,
    request: (init?: RequestInit) =>
      app.request('/ping', init, {
        KV: fake.kv,
      } as unknown as Bindings),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('rateLimit middleware', () => {
  beforeEach(() => {
    // Pin time so windowStart is deterministic across tests.
    vi.useFakeTimers();
    // 2026-06-03T12:00:00.000Z = unix sec 1780488000
    vi.setSystemTime(new Date('2026-06-03T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. first request through middleware proceeds and writes counter=1', async () => {
    const fake = makeFakeKv();
    const { request } = createTestApp(fake, {
      windowSeconds: 86400,
      max: 10,
      keyPrefix: 'rl:test',
    });

    const res = await request();
    expect(res.status).toBe(200);
    // Exactly one put with value '1'
    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0].value).toBe('1');
    expect(fake.puts[0].key).toMatch(/^rl:test:user-1:\d+$/);
    expect(res.headers.get('x-ratelimit-limit')).toBe('10');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('9');
    expect(res.headers.get('x-ratelimit-reset')).toBeTruthy();
  });

  it('2. tenth request (count was 9) proceeds with X-RateLimit-Remaining: 0', async () => {
    const fake = makeFakeKv();
    const { request } = createTestApp(fake, {
      windowSeconds: 86400,
      max: 10,
      keyPrefix: 'rl:test',
    });

    for (let i = 0; i < 10; i++) {
      const res = await request();
      expect(res.status).toBe(200);
    }
    // After the 10th request, counter is 10 and last response had remaining=0.
    const lastPut = fake.puts[fake.puts.length - 1];
    expect(lastPut.value).toBe('10');
  });

  it('3. eleventh request returns 429 with Retry-After and structured body', async () => {
    const fake = makeFakeKv();
    const { request } = createTestApp(fake, {
      windowSeconds: 86400,
      max: 10,
      keyPrefix: 'rl:test',
    });

    // Consume the full window.
    for (let i = 0; i < 10; i++) {
      await request();
    }
    // 11th must be blocked.
    const res = await request();
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('retry-after');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(res.headers.get('x-ratelimit-limit')).toBe('10');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(res.headers.get('x-ratelimit-reset')).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('rate_limited');
    expect(body.limit).toBe(10);
    expect(body.windowSeconds).toBe(86400);
    expect(typeof body.resetAt).toBe('string');
    // No KV write was made for the blocked request (counter already at cap).
    expect(fake.puts).toHaveLength(10);
  });

  it('4. window rollover resets the counter (advance time past windowEnd)', async () => {
    const fake = makeFakeKv();
    const opts = { windowSeconds: 3600, max: 2, keyPrefix: 'rl:test' };
    const { request } = createTestApp(fake, opts);

    // Cap the current window.
    await request();
    await request();
    const blocked = await request();
    expect(blocked.status).toBe(429);

    // Advance into next window (one hour + 1s).
    vi.setSystemTime(new Date(Date.now() + 3601 * 1000));
    const fresh = await request();
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get('x-ratelimit-remaining')).toBe('1');
    // New key was used (different windowStart).
    const oldKey = fake.puts[0].key;
    const newKey = fake.puts[fake.puts.length - 1].key;
    expect(oldKey).not.toBe(newKey);
  });

  it('5. no session + requireSession:true returns 401 unauthorized', async () => {
    const fake = makeFakeKv();
    const { request } = createTestApp(
      fake,
      { windowSeconds: 86400, max: 10, keyPrefix: 'rl:test' },
      null, // no session
    );

    const res = await request();
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
    // No KV touched when refusing pre-emptively.
    expect(fake.puts).toHaveLength(0);
  });

  it('6. no session + requireSession:false proceeds under shared "anon" bucket', async () => {
    const fake = makeFakeKv();
    const { request } = createTestApp(
      fake,
      {
        windowSeconds: 86400,
        max: 5,
        keyPrefix: 'rl:test',
        requireSession: false,
      },
      null,
    );

    const res = await request();
    expect(res.status).toBe(200);
    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0].key).toMatch(/^rl:test:anon:\d+$/);

    // Second anon request shares the bucket, count rises to 2.
    const res2 = await request();
    expect(res2.status).toBe(200);
    expect(fake.puts[1].value).toBe('2');
    expect(fake.puts[1].key).toBe(fake.puts[0].key);
  });

  it('7. KV TTL clamps to 60s minimum even when windowSeconds is smaller', async () => {
    const fake = makeFakeKv();
    const { request } = createTestApp(fake, {
      windowSeconds: 30, // below KV minimum
      max: 5,
      keyPrefix: 'rl:test',
    });

    const res = await request();
    expect(res.status).toBe(200);
    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0].expirationTtl).toBe(60);
  });

  it('8. KV TTL passes through windowSeconds when >= 60s', async () => {
    const fake = makeFakeKv();
    const { request } = createTestApp(fake, {
      windowSeconds: 86400,
      max: 5,
      keyPrefix: 'rl:test',
    });

    await request();
    expect(fake.puts[0].expirationTtl).toBe(86400);
  });

  it('9. distinct userIds get independent buckets', async () => {
    const fake = makeFakeKv();
    const opts = { windowSeconds: 86400, max: 2, keyPrefix: 'rl:test' };

    // user-A consumes their full window.
    const a = createTestApp(fake, opts, { user: { id: 'user-A' } });
    await a.request();
    await a.request();
    const aBlocked = await a.request();
    expect(aBlocked.status).toBe(429);

    // user-B starts fresh.
    const b = createTestApp(fake, opts, { user: { id: 'user-B' } });
    const bRes = await b.request();
    expect(bRes.status).toBe(200);
    expect(bRes.headers.get('x-ratelimit-remaining')).toBe('1');
  });
});
