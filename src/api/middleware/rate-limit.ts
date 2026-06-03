/**
 * rate-limit.ts — Reusable KV-backed per-user fixed-window rate limiter.
 *
 * W4 T3.2 mounts this on POST /api/forms/:c/:y/:f/render to enforce a
 * free-tier daily cap (10 renders / user / day). The middleware is generic
 * over (windowSeconds, max, keyPrefix) so other expensive endpoints can
 * reuse it without copy-paste.
 *
 * Algorithm: fixed-window counter keyed on userId + windowStart bucket.
 *   key = `${keyPrefix}:${userId}:${windowStart}`
 *   windowStart = floor(Date.now()/1000 / windowSeconds) * windowSeconds
 *
 * Consistency: Cloudflare KV is eventually-consistent. Two concurrent
 * reads can both see N and both write N+1 — for a daily free-tier cap this
 * over/under-count by 1 is acceptable. If you need exact-semantics quotas
 * use a Durable Object instead.
 *
 * KV TTL: KV requires `expirationTtl >= 60` seconds. We clamp the supplied
 * windowSeconds up to 60 when writing — the counter still resets at the
 * next window boundary because the key encodes `windowStart`, but the KV
 * entry just lingers an extra few seconds past its conceptual window for
 * short windows. Harmless.
 *
 * Anonymous handling:
 *   - requireSession: true  (default) → no session ⇒ 401 unauthorized
 *   - requireSession: false           → no session ⇒ bucket under
 *                                       userId='anon' (all anon traffic
 *                                       shares one bucket — intentional).
 *
 * Response headers on every cap'd response (both 200-pass and 429-block):
 *   X-RateLimit-Limit      — `max`
 *   X-RateLimit-Remaining  — `max - count - 1`, never negative
 *   X-RateLimit-Reset      — unix-seconds of next window start
 * Plus on 429:
 *   Retry-After            — seconds remaining in the current window
 */

import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../index';

// ─── Public types ───────────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Window length in seconds (e.g. 86400 for a daily quota). Must be > 0. */
  windowSeconds: number;
  /** Maximum requests per window per user. Must be >= 1. */
  max: number;
  /** KV-key namespace prefix (e.g. 'rl:render'). */
  keyPrefix: string;
  /**
   * If true (default), the middleware refuses anonymous traffic with 401
   * BEFORE consuming a slot. Set to false for endpoints that allow anon
   * usage — those requests will all share the 'anon' bucket.
   */
  requireSession?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum KV expirationTtl per Cloudflare KV API contract. */
const KV_MIN_TTL_SECONDS = 60;

// ─── Public API ─────────────────────────────────────────────────────────────

export function rateLimit(opts: RateLimitOptions) {
  if (!Number.isFinite(opts.windowSeconds) || opts.windowSeconds <= 0) {
    throw new Error(`rateLimit: windowSeconds must be > 0, got ${String(opts.windowSeconds)}`);
  }
  if (!Number.isInteger(opts.max) || opts.max < 1) {
    throw new Error(`rateLimit: max must be a positive integer, got ${String(opts.max)}`);
  }
  if (!opts.keyPrefix) {
    throw new Error('rateLimit: keyPrefix is required');
  }

  const requireSession = opts.requireSession ?? true;

  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    // 1. Resolve userId (or refuse anon if configured).
    const userId = c.get('session')?.user?.id;
    if (!userId && requireSession) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const bucketUser = userId ?? 'anon';

    // 2. Compute window bucket.
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(nowSec / opts.windowSeconds) * opts.windowSeconds;
    const windowEnd = windowStart + opts.windowSeconds;
    const key = `${opts.keyPrefix}:${bucketUser}:${windowStart}`;

    // 3. Read current counter.
    const current = await c.env.KV.get(key);
    const count = current ? Number.parseInt(current, 10) : 0;

    // 4. Block when cap exceeded.
    if (count >= opts.max) {
      const retryAfter = Math.max(1, windowEnd - nowSec);
      c.header('Retry-After', String(retryAfter));
      c.header('X-RateLimit-Limit', String(opts.max));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', String(windowEnd));
      return c.json(
        {
          error: 'rate_limited',
          limit: opts.max,
          windowSeconds: opts.windowSeconds,
          resetAt: new Date(windowEnd * 1000).toISOString(),
        },
        429,
      );
    }

    // 5. Increment. KV TTL must be >= 60s — clamp short windows up so the
    //    write doesn't reject. The bucket key itself still rolls over at
    //    the window boundary, so this just leaves stale entries for a few
    //    extra seconds in tiny-window cases.
    const ttl = Math.max(KV_MIN_TTL_SECONDS, opts.windowSeconds);
    await c.env.KV.put(key, String(count + 1), { expirationTtl: ttl });

    // 6. Surface quota state on the response. `remaining` is post-increment.
    const remaining = Math.max(0, opts.max - (count + 1));
    c.header('X-RateLimit-Limit', String(opts.max));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(windowEnd));

    return await next();
  });
}
