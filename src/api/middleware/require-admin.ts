/**
 * requireAdmin — Hono middleware that checks the current user has role='admin'.
 *
 * Must be mounted AFTER the global audit middleware so admin self-queries
 * are also recorded in audit_log (expected behaviour).
 *
 * Usage:
 *   admin.use('*', requireAdmin());
 */

import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { users } from '../../db/schema';
import { createDb } from '../../db';
import type { Bindings, Variables } from '../index';

export function requireAdmin() {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const session = c.get('session');
    if (!session?.user?.id) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const db = createDb(c.env.DB);
    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    if (!row || row.role !== 'admin') {
      return c.json({ error: 'forbidden' }, 403);
    }
    return await next();
  });
}
