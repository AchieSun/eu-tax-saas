/**
 * require-admin-if-watermark-off.ts — Oracle P0-1 (W4 review).
 *
 * Gate the `watermark: false` lever on POST /api/forms/:c/:y/:f/render to
 * admin users only. Non-admins (including anon) get 403
 * `watermark_off_admin_only` BEFORE the rate-limit middleware consumes a
 * quota slot — the gate has to live in front of `rateLimit()` so a refused
 * misuse isn't billed against the user's daily 10 renders.
 *
 * The middleware clones the request to peek at the body without consuming
 * the stream (Hono hands the same stream to the downstream handler, which
 * still needs to parse JSON). Body parsing here is defensively wrapped:
 *   - missing body / non-JSON              → pass through, handler will 400
 *   - body without `watermark` key         → pass through (default ON)
 *   - body.watermark !== false             → pass through (ON or override)
 *   - body.watermark === false + admin     → pass through
 *   - body.watermark === false + non-admin → 403 watermark_off_admin_only
 */

import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { createDb } from '../../db';
import { users } from '../../db/schema';
import type { Bindings, Variables } from '../index';

export function requireAdminIfWatermarkOff() {
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
      // larger than this is either malicious or broken and we hand it to
      // the downstream handler unchanged for normal validation rejection.
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

    // 4. Resolve session + role. Anon → 403 (we surface admin-only, not
    //    401, so we don't leak whether anon ever could trigger it).
    const session = c.get('session');
    const userId = session?.user?.id;
    if (!userId) {
      return c.json({ error: 'watermark_off_admin_only' }, 403);
    }
    const db = createDb(c.env.DB);
    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row || row.role !== 'admin') {
      return c.json({ error: 'watermark_off_admin_only' }, 403);
    }

    return next();
  });
}
