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
 * Beta override (`BETA_ALL_PRO` var, see isBetaAllPro below): an opt-in
 * lever that treats every SIGNED-IN user as Pro while it is on. The
 * product normally charges the €29/year founding price (the var defaults
 * to "false"), so this switch exists for promo windows or launch-week
 * "everyone is Pro" moments, not as the default state. Anonymous callers
 * still get 401/402 exactly as before (signing up is the whole point of
 * the funnel). The override short-circuits BEFORE the D1 lookup, so while
 * it is on a signed-in user is admitted even when D1 is down - fail-open
 * here is intentional (nobody is being charged; the alternative would 503
 * the entire product on a DB hiccup). Set BETA_ALL_PRO = "true" in
 * wrangler.toml to enable it; the fail-closed isPro logic below takes
 * over again as soon as it is off.
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

// ─── Beta override ───────────────────────────────────────────────────────────

/**
 * True while the open-beta "everyone is Pro" switch is on.
 *
 * Reads the `BETA_ALL_PRO` wrangler var ('true' or '1' = on, anything
 * else / unset = off). Checked BEFORE the D1 access lookup in both
 * paywall middlewares so overridden traffic never touches the billing
 * query - and so the product stays usable even when D1 hiccups
 * (deliberate fail-open, see the module header). Defaults to off;
 * flip wrangler.toml to "true" for a promo window, no code change
 * needed.
 */
export function isBetaAllPro(env: Pick<Bindings, 'BETA_ALL_PRO'>): boolean {
  const flag = env?.BETA_ALL_PRO;
  return flag === 'true' || flag === '1';
}

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

    // Beta override: every signed-in user is Pro while BETA_ALL_PRO is on.
    // Runs before the D1 lookup (see isBetaAllPro) - anon stays 401 above.
    if (isBetaAllPro(c.env)) {
      return next();
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
    // Beta override: every signed-in user is Pro while BETA_ALL_PRO is on.
    // Runs before the D1 lookup (see isBetaAllPro); anon still 402 above.
    if (isBetaAllPro(c.env)) {
      return next();
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
