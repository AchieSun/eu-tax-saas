/**
 * Admin-only routes (read-only audit log access).
 *
 * Mounted at /api/admin/* behind requireAdmin middleware.
 * All endpoints are GET-only — no writes.
 */

import { Hono } from 'hono';
import { lt, desc, and, eq } from 'drizzle-orm';
import type { Bindings, Variables } from '../index';
import { createDb } from '../../db';
import { auditLog } from '../../db/schema';
import { requireAdmin } from '../middleware/require-admin';

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// All routes require admin role
admin.use('*', requireAdmin());

/**
 * GET /audit — paginated audit log (cursor-based).
 *
 * Query params:
 *   cursor  — Unix ms timestamp (exclusive upper bound, default: now)
 *   limit   — page size (1-200, default: 50)
 *   route   — optional filter by route path (e.g. "/api/calculate")
 *   userId  — optional filter by user ID
 *
 * Returns:
 *   { items: AuditLog[], nextCursor: number | null }
 */
admin.get('/audit', async (c) => {
  const cursor = parseInt(c.req.query('cursor') ?? `${Date.now()}`, 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const route = c.req.query('route');
  const userId = c.req.query('userId');

  const db = createDb(c.env.DB);
  const conditions = [lt(auditLog.timestamp, cursor)];
  if (route) conditions.push(eq(auditLog.route, route));
  if (userId) conditions.push(eq(auditLog.userIdOrNull, userId));

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.timestamp))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const nextCursor = hasMore ? items[items.length - 1].timestamp : null;

  return c.json({ items, nextCursor });
});

export default admin;
