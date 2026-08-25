/**
 * Paywall tests — backend middleware (requireActiveSubscription /
 * requireProIfWatermarkOff access logic) + frontend client helpers.
 *
 * The Hono route-level behaviour (402 before rate-limit, feature slugs,
 * past_due refusal) is covered in forms.test.ts / strategies.test.ts.
 * This file pins the shared pure helpers + the /api/me client mapping.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMe, isPro } from '../frontend/paywall/api';
import {
  CHECKOUT_HINT,
  SUBSCRIPTION_MESSAGE,
  type UserAccess,
  isPro as isProServer,
} from './middleware/subscription';

// ── Server-side isPro ────────────────────────────────────────────────────────

describe('isPro (server)', () => {
  const cases: Array<[UserAccess | null, boolean, string]> = [
    [{ role: 'admin', subscriptionStatus: 'free' }, true, 'admin staff bypass'],
    [{ role: 'admin', subscriptionStatus: 'past_due' }, true, 'admin regardless of billing'],
    [{ role: 'user', subscriptionStatus: 'active' }, true, 'active subscriber'],
    [{ role: 'user', subscriptionStatus: 'cancelled' }, false, 'cancelled subscriber'],
    [{ role: 'user', subscriptionStatus: 'past_due' }, false, 'past_due = no grace period'],
    [{ role: 'user', subscriptionStatus: 'free' }, false, 'free user'],
    [null, false, 'missing users row'],
  ];

  for (const [access, expected, label] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(isProServer(access)).toBe(expected);
    });
  }
});

// ── Client-side isPro ────────────────────────────────────────────────────────

describe('isPro (client)', () => {
  it('mirrors the server decision for the same shapes', () => {
    expect(isPro({ userId: 'u1', role: 'admin', subscriptionStatus: 'free' })).toBe(true);
    expect(isPro({ userId: 'u1', role: 'user', subscriptionStatus: 'active' })).toBe(true);
    expect(isPro({ userId: 'u1', role: 'user', subscriptionStatus: 'free' })).toBe(false);
    expect(isPro({ userId: 'u1', role: 'user', subscriptionStatus: 'past_due' })).toBe(false);
    expect(isPro(null)).toBe(false);
    expect(isPro(undefined)).toBe(false);
  });

  // t5 integration fix: BETA_ALL_PRO mirror - while /api/me echoes the
  // override every signed-in user resolves as Pro, in lockstep with the
  // server-side gates (subscription.ts isBetaAllPro).
  it('treats every signed-in user as Pro while betaAllPro is on', () => {
    expect(
      isPro({ userId: 'u1', role: 'user', subscriptionStatus: 'free', betaAllPro: true }),
    ).toBe(true);
    // past_due is admitted too: the server override short-circuits before
    // the D1 lookup, so the UI mirror must not be stricter than the gate.
    expect(
      isPro({ userId: 'u1', role: 'user', subscriptionStatus: 'past_due', betaAllPro: true }),
    ).toBe(true);
    expect(
      isPro({ userId: 'u1', role: 'user', subscriptionStatus: 'free', betaAllPro: false }),
    ).toBe(false);
  });
});

// ── fetchMe mapping ──────────────────────────────────────────────────────────

describe('fetchMe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps 200 body to MeInfo (role + subscriptionStatus + betaAllPro)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          userId: 'u1',
          role: 'user',
          subscriptionStatus: 'active',
          betaAllPro: true,
        }),
      ),
    );
    const me = await fetchMe();
    expect(me).toEqual({
      userId: 'u1',
      role: 'user',
      subscriptionStatus: 'active',
      betaAllPro: true,
    });
  });

  // t5 integration fix: an older /api/me without the field must normalize
  // to betaAllPro: false (never undefined-truthy), keeping the override off.
  it('normalizes a missing betaAllPro field to false', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ userId: 'u1', role: 'user', subscriptionStatus: 'active' }),
        ),
    );
    const me = await fetchMe();
    expect(me?.betaAllPro).toBe(false);
  });

  it('returns null on 401 (signed out)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 })),
    );
    expect(await fetchMe()).toBeNull();
  });

  it('defaults role/subscriptionStatus when body omits them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ userId: 'u1' })));
    const me = await fetchMe();
    expect(me?.role).toBe('user');
    expect(me?.subscriptionStatus).toBe('free');
  });

  it('returns null on network failure (collapsed signed-out state)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await fetchMe()).toBeNull();
  });
});

// ── 402 wire contract (t3) ────────────────────────────────────────────────────

describe('402 contract constants', () => {
  it('checkoutHint points at the account tab that hosts checkout', () => {
    expect(CHECKOUT_HINT).toBe('/app#account');
  });

  it('message is the uniform human-readable upgrade copy', () => {
    expect(SUBSCRIPTION_MESSAGE).toBe('订阅后解锁完整功能');
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
