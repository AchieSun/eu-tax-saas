/**
 * F6 — Days tracker routes.
 * GET  /api/days          — list days in range (default: last 365 days)
 * POST /api/days          — bulk UPSERT (1..400 entries)
 * DELETE /api/days/:date  — delete one day entry
 */

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../../db';
import { userDays } from '../../db/schema';
import type { Bindings, Variables } from '../index';

export const daysRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Constants ────────────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_COUNTRIES = ['DE', 'NL', 'PT', 'ES', 'UK', 'OTHER'] as const;
const VALID_SOURCES = ['manual', 'import', 'airport', 'calendar'] as const;

// ── Zod schemas ──────────────────────────────────────────────────────────────

const dayEntrySchema = z.object({
  date: z.string().regex(DATE_REGEX, 'Date must be YYYY-MM-DD'),
  country: z.enum(VALID_COUNTRIES),
  source: z.enum(VALID_SOURCES).optional(),
  note: z.string().max(200).optional(),
});

const postDaysSchema = z.object({
  days: z.array(dayEntrySchema).min(1).max(400),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function validateDateRange(from: string, to: string): string | null {
  if (!DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
    return 'Invalid date format, use YYYY-MM-DD';
  }
  const d1 = new Date(from);
  const d2 = new Date(to);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) {
    return 'Invalid date';
  }
  if (d1 > d2) return 'from must be before or equal to to';

  const diffDays = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > 366) return 'Date range must not exceed 366 days';

  const minDate = new Date('2000-01-01');
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 1);

  if (d1 < minDate) return 'from must be >= 2000-01-01';
  if (d2 > maxDate) return 'to must be <= current year + 1';

  return null;
}

function getDefaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const past = new Date(now);
  past.setDate(past.getDate() - 365);
  const from = past.toISOString().slice(0, 10);
  return { from, to };
}

// ── GET /api/days ────────────────────────────────────────────────────────────

daysRoutes.get('/', async (c) => {
  const session = c.get('session');
  if (!session?.user?.id) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const fromParam = c.req.query('from');
  const toParam = c.req.query('to');

  let fromDate: string;
  let toDate: string;

  if (!fromParam || !toParam) {
    const def = getDefaultRange();
    fromDate = def.from;
    toDate = def.to;
  } else {
    const err = validateDateRange(fromParam, toParam);
    if (err) return c.json({ error: err }, 400);
    fromDate = fromParam;
    toDate = toParam;
  }

  const db = createDb(c.env.DB);
  const rows = await db
    .select({
      date: userDays.date,
      country: userDays.country,
      source: userDays.source,
      note: userDays.note,
    })
    .from(userDays)
    .where(
      and(
        eq(userDays.userId, session.user.id),
        gte(userDays.date, fromDate),
        lte(userDays.date, toDate),
      ),
    );

  return c.json({ days: rows });
});

// ── POST /api/days ───────────────────────────────────────────────────────────

daysRoutes.post('/', async (c) => {
  const session = c.get('session');
  if (!session?.user?.id) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const parsed = postDaysSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const { days } = parsed.data;

  // Early check: duplicate dates in the request array
  const dates = days.map((d) => d.date);
  if (new Set(dates).size !== dates.length) {
    return c.json({ error: 'Duplicate dates in request' }, 400);
  }

  const db = createDb(c.env.DB);
  const now = Date.now();

  const values = days.map((d) => ({
    id: crypto.randomUUID(),
    userId: session.user.id,
    date: d.date,
    country: d.country,
    source: d.source ?? ('manual' as const),
    note: d.note ?? null,
    createdAt: new Date(now),
  }));

  await db
    .insert(userDays)
    .values(values)
    .onConflictDoUpdate({
      target: [userDays.userId, userDays.date],
      set: {
        country: sql`excluded.country`,
        source: sql`excluded.source`,
        note: sql`excluded.note`,
      },
    });

  return c.json({ written: values.length });
});

// ── DELETE /api/days/:date ───────────────────────────────────────────────────

daysRoutes.delete('/:date', async (c) => {
  const session = c.get('session');
  if (!session?.user?.id) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const date = c.req.param('date');
  if (!DATE_REGEX.test(date)) {
    return c.json({ error: 'Invalid date format, use YYYY-MM-DD' }, 400);
  }

  const db = createDb(c.env.DB);
  const result = await db
    .delete(userDays)
    .where(and(eq(userDays.userId, session.user.id), eq(userDays.date, date)));

  // D1Result has meta.changes
  const deleted = (result as { meta?: { changes?: number } })?.meta?.changes ?? 0;
  return c.json({ deleted });
});
