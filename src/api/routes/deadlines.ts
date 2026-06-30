import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../../db';
import {
  completeDeadline,
  createDeadline,
  deleteDeadline,
  getDeadlineById,
  listDeadlines,
  seedDeadlinesForUser,
  snoozeDeadline,
  updateDeadline,
} from '../../deadlines/repository';
import { getSystemDeadlines } from '../../deadlines/system-deadlines';
import {
  deadlineInputSchema,
  deadlineListQuerySchema,
  deadlineSnoozeSchema,
  deadlineUpdateSchema,
} from '../../deadlines/types';
import type { Bindings, Variables } from '../index';

export const deadlinesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function requireUser(c: { get: (key: 'session') => { user: { id: string } } | undefined }) {
  const session = c.get('session');
  if (!session?.user?.id) return null;
  return session.user.id;
}

deadlinesRoutes.get('/', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const raw: Record<string, string | undefined> = {};
  for (const key of ['taxYear', 'status', 'jurisdiction', 'category', 'from', 'to']) {
    raw[key] = c.req.query(key) ?? undefined;
  }

  const parsed = deadlineListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DB);
  const items = await listDeadlines(db, userId, parsed.data);
  return c.json({ ok: true, count: items.length, items });
});

deadlinesRoutes.post('/', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = deadlineInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DB);
  const item = await createDeadline(db, userId, parsed.data);
  return c.json({ ok: true, item }, 201);
});

deadlinesRoutes.get('/:id', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const db = createDb(c.env.DB);
  const item = await getDeadlineById(db, userId, c.req.param('id'));
  if (!item) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, item });
});

deadlinesRoutes.patch('/:id', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = deadlineUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DB);
  const item = await updateDeadline(db, userId, c.req.param('id'), parsed.data);
  if (!item) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, item });
});

deadlinesRoutes.delete('/:id', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const db = createDb(c.env.DB);
  const deleted = await deleteDeadline(db, userId, c.req.param('id'));
  return c.json({ ok: true, deleted });
});

deadlinesRoutes.post('/:id/complete', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const db = createDb(c.env.DB);
  const item = await completeDeadline(db, userId, c.req.param('id'));
  if (!item) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, item });
});

deadlinesRoutes.post('/:id/snooze', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = deadlineSnoozeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DB);
  const item = await snoozeDeadline(db, userId, c.req.param('id'), parsed.data.until);
  if (!item) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, item });
});

deadlinesRoutes.post('/seed', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const schema = deadlineInputSchema.pick({ taxYear: true }).extend({
    jurisdictions: z.array(z.string().length(2)).min(1).max(10),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DB);
  const templates = getSystemDeadlines(parsed.data.jurisdictions, parsed.data.taxYear);
  const count = await seedDeadlinesForUser(db, userId, templates);
  return c.json({ ok: true, count });
});
