/**
 * POST /api/waitlist contract tests (landing-page email capture).
 *
 * Four required branches (spec): registered / already_registered /
 * invalid email / rate-limited - plus the concurrent-insert race
 * (onConflictDoNothing returns zero rows) and the normalization pin.
 *
 * createDb is mocked (same pattern as strategies.test.ts): the select
 * chain resolves to `mockExistingEmail`, the rate-limit upsert resolves
 * to `mockRateCount`, and the waitlist insert resolves to
 * `mockInsertConflict ? [] : [{ id }]`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockExistingEmail = false;
let mockInsertConflict = false;
let mockRateCount = 1;
/**
 * Every `insert().values()` call in order. The rate-limit upsert always
 * runs first (middleware), so a waitlist insert - when the handler gets
 * that far - is always the LAST entry.
 */
let insertCalls: Array<Record<string, unknown>> = [];

const lastInsertValues = (): Record<string, unknown> | undefined => insertCalls.at(-1);
const waitlistInsertRan = (): boolean => insertCalls.length > 1;

vi.mock('../../db', () => ({
  createDb: vi.fn(() => {
    const valuesReturn = Object.assign(Promise.resolve(undefined), {
      onConflictDoUpdate: vi.fn(() => ({
        returning: vi.fn(async () => [{ count: mockRateCount }]),
      })),
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () => (mockInsertConflict ? [] : [{ id: 'wl-new-id' }])),
      })),
    });
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => (mockExistingEmail ? [{ id: 'wl-existing-id' }] : [])),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((v: Record<string, unknown>) => {
          insertCalls.push(v);
          return valuesReturn;
        }),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => undefined),
        })),
      })),
    };
  }),
}));

import { Hono } from 'hono';
import type { Bindings, Variables } from '../index';
import { waitlistRoutes } from './waitlist';

const TEST_ENV = { DB: {} } as unknown as Parameters<typeof waitlistRoutes.request>[2];

function createTestApp() {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.route('/api/waitlist', waitlistRoutes);
  return app;
}

function postEmail(app: ReturnType<typeof createTestApp>, body: unknown) {
  return app.request(
    '/api/waitlist',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': '203.0.113.7',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    TEST_ENV,
  );
}

beforeEach(() => {
  mockExistingEmail = false;
  mockInsertConflict = false;
  mockRateCount = 1;
  insertCalls = [];
});

describe('POST /api/waitlist', () => {
  it('registers a new email -> 201 registered + D1 insert with normalized values', async () => {
    const app = createTestApp();
    const res = await postEmail(app, { email: 'USER@Example.COM' });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('registered');

    // Normalization + source attribution on the inserted row.
    expect(lastInsertValues()).toMatchObject({
      email: 'user@example.com',
      source: 'devto-article',
    });
    expect(typeof lastInsertValues()?.id).toBe('string');
    expect(typeof lastInsertValues()?.createdAt).toBe('number');
    // Per-IP daily quota headers are attached by the rate limiter.
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
  });

  it('attribution: a whitelisted ref tags the inserted row', async () => {
    const app = createTestApp();
    const res = await postEmail(app, {
      email: 'nomad@example.com',
      source: 'producthunt',
    });

    expect(res.status).toBe(201);
    expect(lastInsertValues()).toMatchObject({
      email: 'nomad@example.com',
      source: 'producthunt',
    });
  });

  it('attribution: an unwhitelisted ref falls back to the default funnel', async () => {
    const app = createTestApp();
    const res = await postEmail(app, {
      email: 'sneaky@example.com',
      source: 'garbage-ref',
    });

    expect(res.status).toBe(201);
    expect(lastInsertValues()).toMatchObject({
      email: 'sneaky@example.com',
      source: 'devto-article',
    });
  });

  it('duplicate email -> 200 already_registered (no second insert)', async () => {
    mockExistingEmail = true;
    const app = createTestApp();
    const res = await postEmail(app, { email: 'user@example.com' });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('already_registered');
    // Fast path: select hit, insert never ran for the waitlist row.
    expect(waitlistInsertRan()).toBe(false);
  });

  it('concurrent-insert race (onConflictDoNothing returns no rows) -> 200 already_registered', async () => {
    mockInsertConflict = true;
    const app = createTestApp();
    const res = await postEmail(app, { email: 'user@example.com' });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('already_registered');
  });

  it.each([
    ['not an email', { email: 'not-an-email' }],
    ['missing email', {}],
    ['non-JSON body', '{broken'],
    ['empty body', ''],
  ])('invalid input (%s) -> 422 with uniform error copy', async (_label, body) => {
    const app = createTestApp();
    const res = await postEmail(app, body);

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe('validation');
    expect(json.message).toBe('Enter a valid email address.');
    // Invalid submissions never reach the waitlist write.
    expect(waitlistInsertRan()).toBe(false);
  });

  it('6th request from the same IP within the window -> 429 rate_limited', async () => {
    mockRateCount = 6;
    const app = createTestApp();
    const res = await postEmail(app, { email: 'user@example.com' });

    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: string; limit: number };
    expect(json.error).toBe('rate_limited');
    expect(json.limit).toBe(5);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    // Blocked before the handler: no waitlist insert.
    expect(waitlistInsertRan()).toBe(false);
  });
});
