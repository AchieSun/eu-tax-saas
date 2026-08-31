/**
 * waitlist.ts - POST /api/waitlist landing-page email capture.
 *
 * Spec: marketing/landing-page-spec.md (screen 5). The DEV.to article
 * funnels readers here; visitors who aren't ready to pay leave an email
 * and get exactly one notification when the engine is finished and the
 * price is about to move from €29 to €99. Sending that notification is
 * a separate future task - this endpoint only captures.
 *
 * Wire contract:
 *   201 { status: 'registered' }          - new row inserted
 *   200 { status: 'already_registered' }  - email exists (or lost a
 *                                           concurrent-insert race)
 *   422 { error: 'validation', message }  - body is not a valid email
 *   429 rate-limit body                    - > 5 requests / IP / day
 *   503 { error: 'waitlist_unavailable' } - D1 failure (fail-closed:
 *                                           we never claim a capture
 *                                           that wasn't persisted)
 *
 * Anti-enumeration: the two success bodies differ ONLY in the semantic
 * `status` field (needed so the UI can say "you're on the list" without
 * lying to repeat visitors); all error copy is identical regardless of
 * whether an address is already stored, so the endpoint can't be probed
 * to discover who signed up.
 *
 * Rate limit: rateLimitD1 keys on the session user id, and this endpoint
 * is anonymous by design, so the `ipBucket` middleware below synthesizes
 * `ip:<client-ip>` pseudo-sessions - same pattern as /api/public/compare.
 * 5 requests / IP / 86400s is plenty for a one-field form while capping
 * cleanup-free abuse of the D1 writes.
 */

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { createDb } from '../../db';
import { waitlist } from '../../db/schema';
import type { Bindings, Variables } from '../index';
import { rateLimitD1 } from '../middleware/rate-limit-d1';

const WAITLIST_SOURCES = ['devto-article', 'nomadgate', 'producthunt', 'landing'] as const;
type WaitlistSource = (typeof WAITLIST_SOURCES)[number];

const WaitlistBodySchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254).email(),
  // Optional traffic-source tag (e.g. ?ref=nomadgate / ?ref=ph). Kept loose
  // (string) so a garbage ref does NOT fail the whole registration — it is
  // whitelisted server-side below and anything unknown falls back to the
  // default funnel. Never trust the client blindly.
  source: z.string().max(32).optional(),
});

/** Uniform error copy - identical for every invalid submission (anti-enumeration). */
const INVALID_EMAIL_MESSAGE = 'Enter a valid email address.';
/** Default funnel when no (or unverified) ref is provided. */
const WAITLIST_SOURCE_DEFAULT: WaitlistSource = 'devto-article';

/** Server-side whitelist — unknown refs are dropped to the default funnel. */
function resolveSource(raw: string | undefined): WaitlistSource {
  if (raw === undefined) return WAITLIST_SOURCE_DEFAULT;
  return (WAITLIST_SOURCES as readonly string[]).includes(raw)
    ? (raw as WaitlistSource)
    : WAITLIST_SOURCE_DEFAULT;
}

/**
 * Per-IP pseudo-session so rateLimitD1 (which keys on session user id)
 * buckets anonymous traffic per client IP instead of one shared 'anon'
 * bucket. Mirrors ipBucket in src/landing/compare.ts.
 */
const ipBucket = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
  const direct = c.req.header('cf-connecting-ip')?.trim();
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = direct || forwarded || 'unknown';
  c.set('session', { user: { id: `ip:${ip}` } });
  await next();
});

export const waitlistRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

waitlistRoutes.use('/', ipBucket);
waitlistRoutes.use('/', rateLimitD1({ keyPrefix: 'waitlist', windowSeconds: 86_400, max: 5 }));

waitlistRoutes.post('/', async (c) => {
  // 1. Validate. Invalid bodies never reach D1 (and the rate limiter has
  //    already run, so junk traffic can't hammer the DB for free).
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = WaitlistBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'validation', message: INVALID_EMAIL_MESSAGE }, 422);
  }
  const email = parsed.data.email;
  const source = resolveSource(parsed.data.source);

  const db = createDb(c.env.DB);
  try {
    // 2. Fast path - already on the list.
    const [existing] = await db
      .select({ id: waitlist.id })
      .from(waitlist)
      .where(eq(waitlist.email, email))
      .limit(1);
    if (existing) {
      return c.json({ status: 'already_registered' }, 200);
    }

    // 3. Insert. onConflictDoNothing + returning() arbitrates the
    //    concurrent-duplicate race without throwing: a lost race returns
    //    zero rows and is reported as already_registered.
    const inserted = await db
      .insert(waitlist)
      .values({
        id: crypto.randomUUID(),
        email,
        createdAt: Date.now(),
        source,
      })
      .onConflictDoNothing({ target: waitlist.email })
      .returning({ id: waitlist.id });

    if (inserted.length === 0) {
      return c.json({ status: 'already_registered' }, 200);
    }
    return c.json({ status: 'registered' }, 201);
  } catch (err) {
    // Fail-closed: never acknowledge a capture that wasn't persisted.
    console.error('waitlist: D1 write failed', err);
    return c.json({ error: 'waitlist_unavailable' }, 503);
  }
});
