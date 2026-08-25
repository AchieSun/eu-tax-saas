/**
 * Beta paywall-exemption tests (BETA_ALL_PRO).
 *
 * Pins the two-state contract of the open-beta override:
 *   - BETA_ALL_PRO on  -> every SIGNED-IN user passes both gates
 *                        (requireActiveSubscription + watermark-off),
 *                        anonymous callers still get 401/402, and the
 *                        D1 access lookup is never reached.
 *   - BETA_ALL_PRO off -> behaviour identical to the pre-beta paywall
 *                        (free user -> 402, active subscriber -> pass).
 *
 * The route-level 402 tests in strategies.test.ts / forms.test.ts run
 * without BETA_ALL_PRO, so they already pin the "off" state end-to-end;
 * this file owns the switch itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// What the users-table select resolves to inside the (mocked) access
// lookup. `null` = missing row; only read when the Beta override is OFF.
let mockUserAccess: { role: string; subscriptionStatus: string } | null = {
  role: 'user',
  subscriptionStatus: 'free',
};

vi.mock('../../db', () => ({
  createDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (mockUserAccess === null ? [] : [mockUserAccess])),
        })),
      })),
    })),
  })),
}));

import { Hono } from 'hono';
import type { Bindings, Variables } from '../index';
import { isBetaAllPro, requireActiveSubscription, requireProIfWatermarkOff } from './subscription';

type TestApp = Hono<{ Bindings: Bindings; Variables: Variables }>;

function gatedApp(
  middleware:
    | ReturnType<typeof requireActiveSubscription>
    | ReturnType<typeof requireProIfWatermarkOff>,
): TestApp {
  const app: TestApp = new Hono();
  app.use('*', async (c, next) => {
    const session = c.req.header('x-test-user');
    if (session) c.set('session', { user: { id: session } });
    await next();
  });
  app.use('/gate', middleware);
  app.post('/gate', (c) => c.json({ ok: true }));
  app.get('/gate', (c) => c.json({ ok: true }));
  return app;
}

function call(app: TestApp, env: Partial<Bindings>, userId?: string, body?: unknown) {
  return app.request(
    '/gate',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'x-test-user': userId } : {}),
      },
      body: JSON.stringify(body ?? {}),
    },
    { DB: {}, ...env } as Bindings,
  );
}

beforeEach(() => {
  mockUserAccess = { role: 'user', subscriptionStatus: 'free' };
});

// ─── isBetaAllPro ────────────────────────────────────────────────────────────

describe('isBetaAllPro', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
    ['', false],
    ['TRUE', false],
    ['yes', false],
    [undefined, false],
  ])('BETA_ALL_PRO=%j -> %s', (flag, expected) => {
    expect(isBetaAllPro({ BETA_ALL_PRO: flag })).toBe(expected);
  });
});

// ─── requireActiveSubscription ───────────────────────────────────────────────

describe('requireActiveSubscription x BETA_ALL_PRO', () => {
  const gate = requireActiveSubscription({ feature: 'beta-test' });

  it('Beta ON: free user (even a missing users row) passes without touching D1', async () => {
    mockUserAccess = null; // would be non-Pro if the lookup ran
    const res = await call(gatedApp(gate), { BETA_ALL_PRO: 'true' }, 'free-user-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('Beta ON: anonymous caller still gets 401 (sign-up is the funnel)', async () => {
    const res = await call(gatedApp(gate), { BETA_ALL_PRO: 'true' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('unauthorized');
  });

  it('Beta OFF (unset): free user gets the unchanged 402 contract', async () => {
    const res = await call(gatedApp(gate), {}, 'free-user-2');
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      error: string;
      feature: string;
      subscriptionStatus: string;
      checkoutHint: string;
    };
    expect(body.error).toBe('subscription_required');
    expect(body.feature).toBe('beta-test');
    expect(body.subscriptionStatus).toBe('free');
    expect(body.checkoutHint).toBe('/app#account');
  });

  it('Beta OFF: active subscriber passes as before', async () => {
    mockUserAccess = { role: 'user', subscriptionStatus: 'active' };
    const res = await call(gatedApp(gate), { BETA_ALL_PRO: 'false' }, 'sub-user-1');
    expect(res.status).toBe(200);
  });
});

// ─── requireProIfWatermarkOff ────────────────────────────────────────────────

describe('requireProIfWatermarkOff x BETA_ALL_PRO', () => {
  const gate = requireProIfWatermarkOff();

  it('Beta ON: free user with watermark:false passes without touching D1', async () => {
    mockUserAccess = null; // would be non-Pro if the lookup ran
    const res = await call(gatedApp(gate), { BETA_ALL_PRO: 'true' }, 'free-user-1', {
      watermark: false,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('Beta ON: anonymous watermark:false caller still gets 402 (unchanged anon behaviour)', async () => {
    const res = await call(gatedApp(gate), { BETA_ALL_PRO: 'true' }, undefined, {
      watermark: false,
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe('subscription_required');
  });

  it('Beta OFF: free user with watermark:false gets the unchanged 402', async () => {
    const res = await call(gatedApp(gate), {}, 'free-user-2', { watermark: false });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; feature: string };
    expect(body.error).toBe('subscription_required');
    expect(body.feature).toBe('watermark-free-pdf');
  });

  it('Beta ON: watermark omitted falls through without gating', async () => {
    const res = await call(gatedApp(gate), { BETA_ALL_PRO: 'true' }, 'free-user-3', {
      some: 'payload',
    });
    expect(res.status).toBe(200);
  });
});
