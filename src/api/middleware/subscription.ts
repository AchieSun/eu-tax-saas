/**
 * subscription.ts — subscription paywall middleware + shared access lookup.
 *
 * Product scope (paywall wave):
 *   - F3 PDF generation: `watermark: false` (clean, submission-ready PDF)
 *     becomes a Pro feature. Free users keep watermarked drafts under the
 *     existing 10/day D1 quota.
 *   - F4 full strategy report: `POST /api/strategies/ai-recommend` (LLM
 *     C-tier recommendations) and `POST /api/strategies/persist` (saving a
 *     report) become Pro features. The rule-based `POST /evaluate` stays
 *     free — it is the acquisition funnel.
 *
 * "Pro" = `users.role === 'admin'` (staff bypass) OR
 *         `users.subscription_status === 'active'`.
 * `past_due` is deliberately NOT granted access: Creem webhooks flip the
 * status via `subscription.past_due`, and grace-period handling is a
 * business decision we don't want to encode silently. When dunning is
 * designed, flip the check here in ONE place.
 *
 * Failure mode: the access lookup is fail-closed — if D1 throws we return
 * 503 `subscription_check_unavailable` instead of default-allowing. Both
 * gated surfaces are the paid product; fail-open would hand out Pro for
 * free exactly when the billing DB is having a bad day.
 *
 * Wire format (uniform so the frontend keys on it everywhere):
 *   401 { error: 'unauthorized' }            — not signed in
 *   402 { error: 'subscription_required', feature, subscriptionStatus,
 *          checkoutHint, message }           — signed in, not Pro
 *   503 { error: 'subscription_check_unavailable' }  — DB failure (fail-closed)
 *
 * t3 spec additions: every 402 also carries `checkoutHint` (where the UI
 * should send the user to subscribe) and a human-readable `message`.
 */

import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { createDb } from '../../db';
import { users } from '../../db/schema';
import type { Bindings, Variables } from '../index';

/** Frontend route the upgrade CTA should navigate to (AccountPage hosts checkout). */
export const CHECKOUT_HINT = '/app#account';
/** Uniform human-readable message on every paywall 402. */
export const SUBSCRIPTION_MESSAGE = '订阅后解锁完整功能';

// ─── Shared access lookup ───────────────────────────────────────────────────

export interface UserAccess {
  role: string;
  subscriptionStatus: string;
}

/**
 * Fetch the two columns that decide Pro access for a user.
 * Returns `null` when the users row is missing (deleted account, session
 * pointing at a ghost id) — callers treat null as not-Pro.
 */
export async function fetchUserAccess(
  db: ReturnType<typeof createDb>,
  userId: string,
): Promise<UserAccess | null> {
  const [row] = await db
    .select({ role: users.role, subscriptionStatus: users.subscriptionStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return { role: row.role, subscriptionStatus: row.subscriptionStatus };
}

/** Admin (staff) or active subscriber → has Pro access. */
export function isPro(access: UserAccess | null): boolean {
  if (!access) return false;
  return access.role === 'admin' || access.subscriptionStatus === 'active';
}

// ─── requireActiveSubscription ───────────────────────────────────────────────

export interface RequireSubscriptionOptions {
  /**
   * Stable feature slug echoed in the 402 body (`feature`) so the frontend
   * can tailor the upgrade copy per surface, e.g. 'ai-strategy-report'.
   */
  feature: string;
}

/**
 * Hard gate: the downstream handler runs only for Pro users.
 * Mount BEFORE any rate-limit middleware so a refused 402 does not burn a
 * quota slot (same philosophy as the F3 watermark gate).
 */
export function requireActiveSubscription(opts: RequireSubscriptionOptions) {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const userId = c.get('session')?.user?.id;
    if (!userId) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    let access: UserAccess | null;
    try {
      const db = createDb(c.env.DB);
      access = await fetchUserAccess(db, userId);
    } catch (err) {
      console.error('requireActiveSubscription: access lookup failed', err);
      return c.json({ ok: false, error: 'subscription_check_unavailable' }, 503);
    }

    if (!isPro(access)) {
      return c.json(
        {
          ok: false,
          error: 'subscription_required',
          feature: opts.feature,
          subscriptionStatus: access?.subscriptionStatus ?? 'free',
          checkoutHint: CHECKOUT_HINT,
          message: SUBSCRIPTION_MESSAGE,
        },
        402,
      );
    }

    return next();
  });
}

// ─── requireProIfWatermarkOff ────────────────────────────────────────────────

/**
 * Gate the `watermark: false` lever on POST /api/forms/:c/:y/:f/render.
 *
 * Evolution of the Oracle P0-1 (W4 review) `requireAdminIfWatermarkOff`:
 * admin-only became Pro (admin OR active subscriber) when the paywall
 * shipped. Behaviour for non-qualified callers is unchanged in spirit —
 * refuse BEFORE the rate-limit middleware consumes a quota slot — but the
 * refusal is now the uniform paywall 402 so the frontend can key on it.
 *
 * **Ordering invariant (Oracle P1-NEW-5, W5-A followup):** this middleware
 * assumes a `bodyLimit({maxSize})` ran in front of it. The body clone here
 * (`c.req.raw.clone()`) works because hono caches the body in
 * `c.req.bodyCache` — the downstream handler's `c.req.json()` call later in
 * the chain re-reads from that cache rather than draining the stream a
 * second time. If you remount this middleware AHEAD of `bodyLimit`,
 * oversized bodies will be fully buffered here before bodyLimit gets to
 * reject them. See `forms.test.ts` for the E2E regression test that pins
 * this ordering.
 *
 * The middleware clones the request to peek at the body without consuming
 * the stream (Hono hands the same stream to the downstream handler, which
 * still needs to parse JSON). Body parsing here is defensively wrapped:
 *   - missing body / non-JSON              → pass through, handler will 400
 *   - body without `watermark` key         → pass through (default ON)
 *   - body.watermark !== false             → pass through (ON or override)
 *   - body.watermark === false + Pro       → pass through
 *   - body.watermark === false + non-Pro   → 402 subscription_required
 */
export function requireProIfWatermarkOff() {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    // 1. Cheap pre-check on method/content-type — only POST JSON bodies can
    //    carry `watermark`. Anything else falls straight through.
    if (c.req.method !== 'POST') return next();
    const ct = c.req.header('content-type') ?? '';
    if (!ct.toLowerCase().includes('application/json')) return next();

    // 2. Clone the underlying Request so reading the body here doesn't
    //    drain it for the downstream handler.
    let body: unknown = null;
    try {
      const cloned = c.req.raw.clone();
      // 1 MB cap — the render bodies in production are O(few KB); a body
      //    larger than this is either malicious or broken and we hand it to
      //    the downstream handler unchanged for normal validation rejection.
      const len = Number.parseInt(c.req.header('content-length') ?? '0', 10);
      if (Number.isFinite(len) && len > 1_048_576) return next();
      body = await cloned.json();
    } catch {
      // Not JSON or empty — let the route's own Zod parser produce 400.
      return next();
    }

    // 3. Only act when the caller explicitly opted out.
    const watermarkOff =
      body !== null &&
      typeof body === 'object' &&
      (body as { watermark?: unknown }).watermark === false;
    if (!watermarkOff) return next();

    // 4. Resolve session + access. Anon → 402 as well: the paywall error is
    //    uniform, and anon callers never see the toggle in the UI anyway
    //    (the render endpoint requires a session for every watermark mode).
    const userId = c.get('session')?.user?.id;
    if (!userId) {
      return c.json(
        {
          ok: false,
          error: 'subscription_required',
          feature: 'watermark-free-pdf',
          subscriptionStatus: 'free',
          checkoutHint: CHECKOUT_HINT,
          message: SUBSCRIPTION_MESSAGE,
        },
        402,
      );
    }
    let access: UserAccess | null;
    try {
      const db = createDb(c.env.DB);
      access = await fetchUserAccess(db, userId);
    } catch (err) {
      console.error('requireProIfWatermarkOff: access lookup failed', err);
      return c.json({ ok: false, error: 'subscription_check_unavailable' }, 503);
    }

    if (!isPro(access)) {
      return c.json(
        {
          ok: false,
          error: 'subscription_required',
          feature: 'watermark-free-pdf',
          subscriptionStatus: access?.subscriptionStatus ?? 'free',
          checkoutHint: CHECKOUT_HINT,
          message: SUBSCRIPTION_MESSAGE,
        },
        402,
      );
    }

    return next();
  });
}
