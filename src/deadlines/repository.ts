import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { type Deadline, type NewDeadline, deadlines } from '../db/schema';
import type {
  DeadlineCategory,
  DeadlineInput,
  DeadlineListQuery,
  DeadlineSource,
  DeadlineUpdate,
} from './types';

export interface DeadlineFilters extends DeadlineListQuery {}

export function listDeadlines(
  db: Db,
  userId: string,
  filters: DeadlineFilters = {},
): Promise<Deadline[]> {
  const conditions = [eq(deadlines.userId, userId)];

  if (filters.taxYear !== undefined) {
    conditions.push(eq(deadlines.taxYear, filters.taxYear));
  }
  if (filters.status !== undefined) {
    conditions.push(eq(deadlines.status, filters.status));
  }
  if (filters.jurisdiction !== undefined) {
    conditions.push(eq(deadlines.jurisdiction, filters.jurisdiction));
  }
  if (filters.category !== undefined) {
    conditions.push(eq(deadlines.category, filters.category));
  }
  if (filters.from !== undefined) {
    conditions.push(gte(deadlines.dueDate, filters.from));
  }
  if (filters.to !== undefined) {
    conditions.push(lte(deadlines.dueDate, filters.to));
  }

  return db
    .select()
    .from(deadlines)
    .where(and(...conditions))
    .orderBy(asc(deadlines.dueDate), asc(deadlines.title));
}

export function getDeadlineById(db: Db, userId: string, id: string): Promise<Deadline | undefined> {
  return db
    .select()
    .from(deadlines)
    .where(and(eq(deadlines.userId, userId), eq(deadlines.id, id)))
    .limit(1)
    .then((rows) => rows[0]);
}

export async function createDeadline(
  db: Db,
  userId: string,
  input: DeadlineInput,
  source: DeadlineSource = 'user',
): Promise<Deadline> {
  const now = new Date();
  const row: NewDeadline = {
    id: crypto.randomUUID(),
    userId,
    taxYear: input.taxYear,
    jurisdiction: input.jurisdiction,
    title: input.title,
    description: input.description ?? null,
    dueDate: input.dueDate,
    status: input.status ?? 'pending',
    category: input.category,
    source,
    reminderDays: input.reminderDays ?? 7,
    snoozedUntil: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(deadlines).values(row);
  return row as Deadline;
}

export async function updateDeadline(
  db: Db,
  userId: string,
  id: string,
  patch: DeadlineUpdate,
): Promise<Deadline | undefined> {
  const existing = await getDeadlineById(db, userId, id);
  if (!existing) return undefined;

  const set: Partial<Record<keyof NewDeadline, unknown>> = {
    updatedAt: new Date(),
  };

  if (patch.taxYear !== undefined) set.taxYear = patch.taxYear;
  if (patch.jurisdiction !== undefined) set.jurisdiction = patch.jurisdiction;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.reminderDays !== undefined) set.reminderDays = patch.reminderDays;
  if (patch.snoozedUntil !== undefined) set.snoozedUntil = patch.snoozedUntil;

  await db
    .update(deadlines)
    .set(set as NewDeadline)
    .where(and(eq(deadlines.userId, userId), eq(deadlines.id, id)));

  return getDeadlineById(db, userId, id);
}

export async function deleteDeadline(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(deadlines)
    .where(and(eq(deadlines.userId, userId), eq(deadlines.id, id)));
  const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
  return changes > 0;
}

export async function completeDeadline(
  db: Db,
  userId: string,
  id: string,
): Promise<Deadline | undefined> {
  return updateDeadline(db, userId, id, { status: 'completed' });
}

export async function snoozeDeadline(
  db: Db,
  userId: string,
  id: string,
  until: string,
): Promise<Deadline | undefined> {
  return updateDeadline(db, userId, id, { status: 'snoozed', snoozedUntil: until });
}

export interface SystemDeadlineTemplate {
  jurisdiction: string;
  taxYear: number;
  title: string;
  description: string;
  dueDate: string;
  category: DeadlineCategory;
  reminderDays: number;
}

export async function seedDeadlinesForUser(
  db: Db,
  userId: string,
  templates: SystemDeadlineTemplate[],
): Promise<number> {
  if (templates.length === 0) return 0;

  const now = new Date();
  const rows: NewDeadline[] = templates.map((t) => ({
    id: crypto.randomUUID(),
    userId,
    taxYear: t.taxYear,
    jurisdiction: t.jurisdiction,
    title: t.title,
    description: t.description,
    dueDate: t.dueDate,
    status: 'pending',
    category: t.category,
    source: 'system',
    reminderDays: t.reminderDays,
    snoozedUntil: null,
    createdAt: now,
    updatedAt: now,
  }));

  await db.insert(deadlines).values(rows);
  return rows.length;
}

export function findDeadlinesDueForReminder(db: Db, referenceDate: string): Promise<Deadline[]> {
  return db
    .select()
    .from(deadlines)
    .where(
      and(
        eq(deadlines.status, 'pending'),
        sql`date(${deadlines.dueDate}) >= date(${referenceDate})`,
        sql`date(${deadlines.dueDate}) <= date(${referenceDate}, '+' || ${deadlines.reminderDays} || ' days')`,
      ),
    )
    .orderBy(asc(deadlines.dueDate));
}
