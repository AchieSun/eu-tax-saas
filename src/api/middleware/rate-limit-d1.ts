// Oracle P1-7 (W4 review): D1-atomic rate-limit counter.
/**
 * rate-limit-d1.ts — D1-backed per-user fixed-window rate limiter.
 *
 * REPLACES the KV-based `rateLimit()` for endpoints where the cap is
 * legally / financially consequential (e.g. POST /api/forms/:c/:y/:f/render
 * — the daily free-tier render cap). KV is eventually-consistent: two
 * concurrent requests can both read N and both write N+1, allowing the
 * cap to be silently exceeded. Oracle's W4 review (P1-7) called this out
 * and prescribed either Durable Objects or D1 with INSERT…ON CONFLICT.
 * We pick D1 because:
 *   - No extra wrangler binding (DO requires `[durable_objects]`
 *     class + migration config).
 *   - SQLite's `INSERT … ON CONFLICT(...) DO UPDATE SET col = col + 1
 *     RETURNING col` is atomic per row, which is exactly what a fixed-
 *     window counter needs.
 *   - Drizzle's `.onConflictDoUpdate({ target, set, where? }).returning(...)`
 *     compiles down to that exact SQL on D1.
 *
 * Algorithm: identical window math to the KV variant so existing fixtures
 * carry over.
 *   key         = `${keyPrefix}:${userId}`        (or 'anon' if allowed)
 *   windowStart = floor(now / windowSeconds) * windowSeconds   (unix sec)
 *   pk          = (key, windowStart)              ← composite primary key
 *   atomic step = INSERT (key, windowStart, count=1, expiresAt)
 *                 ON CONFLICT (key, windowStart) DO UPDATE
 *                   SET count = count + 1
 *                 RETURNING count
 *
 * Failure mode: if D1 throws we return 503 `rate_limit_unavailable`
 * INSTEAD of default-allowing. The /render endpoint is the user-facing
 * paid surface — silently dropping the cap would let abusers burn the
 * whole monthly D1 + R2 budget. KV's middleware fails-open on KV errors
 * because its quotas are "advisory"; this one is hard.
 *
 * Headers (identical to KV variant for wire compat):
 *   on success: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 *   on 429:     + Retry-After, body { error: 'rate_limited', limit,
 *                                     windowSeconds, resetAt }
 */

import { lt, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { createDb } from '../../db';
import { rateLimitCounters } from '../../db/schema';
import type { Bindings, Variables } from '../index';

// ─── Public types ───────────────────────────────────────────────────────────

export interface RateLimitD1Options {
  /** Window length in seconds (e.g. 86400 for a daily quota). Must be > 0. */
  windowSeconds: number;
  /** Maximum requests per window per user. Must be >= 1. */
  max: number;
  /** Row-key namespace prefix (e.g. 'rl:render'). */
  keyPrefix: string;
  /**
   * If true (default), the middleware refuses anonymous traffic with 401
   * BEFORE consuming a slot. Set to false for endpoints that allow anon
   * usage — those requests will all share the 'anon' bucket.
   */
  requireSession?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Extra seconds added to the row's expires_at so a future sweeper job
 * doesn't race the live window's last few requests.
 */
const EXPIRES_GRACE_SECONDS = 60;

/**
 * Oracle P1-NEW-3 (W5-A followup): probability that any single call also
 * fires a fire-and-forget DELETE of expired counter rows (lazy sweep).
 * At 1% and 10 rows-per-sweep, steady-state under continuous load
 * trends towards zero unbounded growth without adding latency to the
 * 99% of calls that don't sweep.
 */
const SWEEP_PROBABILITY = 0.01;
/**
 * Oracle P1-NEW-3 (W5-A followup): max rows deleted per lazy-sweep call.
 * Bounded so a sweep never becomes a long-running scan; the next sweep
 * will pick up any remaining expired rows.
 */
const SWEEP_BATCH_SIZE = 10;

// ─── Public API ─────────────────────────────────────────────────────────────

export function rateLimitD1(opts: RateLimitD1Options) {
  if (!Number.isFinite(opts.windowSeconds) || opts.windowSeconds <= 0) {
    throw new Error(`rateLimitD1: windowSeconds must be > 0, got ${String(opts.windowSeconds)}`);
  }
  if (!Number.isInteger(opts.max) || opts.max < 1) {
    throw new Error(`rateLimitD1: max must be a positive integer, got ${String(opts.max)}`);
  }
  if (!opts.keyPrefix) {
    throw new Error('rateLimitD1: keyPrefix is required');
  }

  const requireSession = opts.requireSession ?? true;

  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    // 1. Resolve userId (or refuse anon if configured).
    const userId = c.get('session')?.user?.id;
    if (!userId && requireSession) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const bucketUser = userId ?? 'anon';

    // 2. Compute window bucket. IDENTICAL math to the KV variant so the
    //    existing rate-limit.test.ts fixtures map 1:1 onto this middleware.
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(nowSec / opts.windowSeconds) * opts.windowSeconds;
    const windowEnd = windowStart + opts.windowSeconds;
    const key = `${opts.keyPrefix}:${bucketUser}`;
    const expiresAt = windowEnd + EXPIRES_GRACE_SECONDS;

    // 3. Atomic upsert. The composite PK (key, window_start) makes this
    //    a single-row CAS — D1 serialises per-row mutations, so even if
    //    100 requests land in the same millisecond, exactly N get count=N.
    //
    //    Oracle P1-NEW-3 (W5-A followup): cap the stored counter at
    //    `max + 1` via a CASE WHEN inside the upsert so a sustained
    //    flood doesn't grow the integer column without bound. The
    //    middleware's 429 decision still triggers on `count > max` so
    //    behaviour is unchanged; only the row-state ceiling changes.
    //    The +1 buffer is intentional: it lets a "first refusal" be
    //    distinguished from "well past cap" in the row, which a future
    //    pre-write SELECT-peek optimisation could use to short-circuit.
    let count: number;
    try {
      const db = createDb(c.env.DB);
      const rows = await db
        .insert(rateLimitCounters)
        .values({
          key,
          windowStart,
          count: 1,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [rateLimitCounters.key, rateLimitCounters.windowStart],
          set: {
            count: sql`CASE WHEN ${rateLimitCounters.count} >= ${opts.max + 1} THEN ${rateLimitCounters.count} ELSE ${rateLimitCounters.count} + 1 END`,
          },
        })
        .returning({ count: rateLimitCounters.count });
      // Drizzle returns an array; for a single-row upsert with RETURNING
      // SQLite emits exactly one row. Defensive fallback just in case.
      count = rows[0]?.count ?? 1;

      // Oracle P1-NEW-3 (W5-A followup): lazy fire-and-forget sweep of
      // expired counter rows. 1% of calls trigger a bounded DELETE
      // (`LIMIT SWEEP_BATCH_SIZE`) so the table doesn't accumulate
      // stale per-(user, window) rows forever. Voided so the response
      // never waits on it; errors swallowed because a sweep failure is
      // never user-visible — the next sweep retries.
      if (Math.random() < SWEEP_PROBABILITY) {
        void db
          .delete(rateLimitCounters)
          .where(lt(rateLimitCounters.expiresAt, nowSec))
          .limit(SWEEP_BATCH_SIZE)
          .catch(() => {});
      }
    } catch (err) {
      // FAIL-CLOSED: legally consequential endpoint, do not default-allow.
      console.error('rateLimitD1: D1 upsert failed', err);
      return c.json({ error: 'rate_limit_unavailable' }, 503);
    }

    // 4. Block when cap exceeded.
    if (count > opts.max) {
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

    // 5. Run the downstream handler FIRST so it can set its own headers
    //    (some routes emit Cache-Control/Content-Disposition before
    //    returning bytes). We then attach quota headers to c.res afterward.
    await next();

    const remaining = Math.max(0, opts.max - count);
    c.res.headers.set('X-RateLimit-Limit', String(opts.max));
    c.res.headers.set('X-RateLimit-Remaining', String(remaining));
    c.res.headers.set('X-RateLimit-Reset', String(windowEnd));
    return;
  });
}
