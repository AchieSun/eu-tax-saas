import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema';
import type { Bindings, Variables } from '../index';
import { deadlinesRoutes } from './deadlines';

interface DeadlineRow {
  id: string;
  user_id: string;
  tax_year: number;
  jurisdiction: string;
  title: string;
  description: string | null;
  due_date: string;
  status: string;
  category: string;
  source: string;
  reminder_days: number;
  snoozed_until: string | null;
  created_at: number;
  updated_at: number;
}

let store: DeadlineRow[] = [];

function resetStore() {
  store = [];
}

const COLUMNS = [
  'id',
  'user_id',
  'tax_year',
  'jurisdiction',
  'title',
  'description',
  'due_date',
  'status',
  'category',
  'source',
  'reminder_days',
  'snoozed_until',
  'created_at',
  'updated_at',
];

function parseColumns(sql: string): string[] {
  const match = sql.match(/SELECT\s+(.*?)\s+FROM/i);
  if (!match) return COLUMNS;
  return match[1]
    .split(',')
    .map((c) =>
      c
        .trim()
        .replace(/"/g, '')
        .replace(/^deadlines\./, ''),
    )
    .filter(Boolean);
}

function parseWhere(sql: string): Array<{ column: string; op: string; paramIndex: number }> {
  const whereIdx = sql.toUpperCase().indexOf('WHERE');
  if (whereIdx === -1) return [];
  const whereClause = sql.slice(whereIdx + 5);
  const conditions = whereClause.split(/\s+AND\s+/i);
  let paramIndex = 0;
  const result: Array<{ column: string; op: string; paramIndex: number }> = [];
  for (const cond of conditions) {
    const match = cond.match(/"?(?:deadlines\.)?([^"\s]+)"?\s*(>=|<=|=|<>|!=)\s*\?/);
    if (!match) {
      paramIndex++;
      continue;
    }
    result.push({ column: match[1].replace(/^deadlines\./, ''), op: match[2], paramIndex });
    paramIndex++;
  }
  return result;
}

function rowMatches(
  row: DeadlineRow,
  conditions: ReturnType<typeof parseWhere>,
  params: unknown[],
): boolean {
  const record = row as unknown as Record<string, unknown>;
  for (const cond of conditions) {
    const val = record[cond.column];
    const param = params[cond.paramIndex];
    if (cond.op === '=' && val !== param) return false;
    if (cond.op === '>=' && val != null && param != null && val < param) return false;
    if (cond.op === '<=' && val != null && param != null && val > param) return false;
  }
  return true;
}

async function batchExecutor(
  sql: string,
  params: unknown[],
  _method: 'all' | 'run' | 'get' | 'values',
): Promise<{ rows: unknown[]; meta?: { changes?: number } }> {
  const normalized = sql.replace(/\s+/g, ' ').trim();

  if (normalized.toUpperCase().startsWith('SELECT')) {
    const columns = parseColumns(normalized);
    const conditions = parseWhere(normalized);
    const filtered = store.filter((row) => rowMatches(row, conditions, params));
    const rows = filtered.map((row) =>
      columns.map((col) => (row as unknown as Record<string, unknown>)[col] ?? null),
    );
    return { rows };
  }

  if (normalized.toUpperCase().startsWith('INSERT')) {
    const colMatch = normalized.match(/\(([^)]+)\)\s*VALUES/i);
    const cols = colMatch ? colMatch[1].split(',').map((c) => c.trim().replace(/"/g, '')) : [];
    const rowCount = cols.length > 0 ? params.length / cols.length : 0;
    const inserted: DeadlineRow[] = [];
    for (let i = 0; i < rowCount; i++) {
      const row: Record<string, unknown> = {};
      for (let j = 0; j < cols.length; j++) {
        row[cols[j]] = params[i * cols.length + j];
      }
      inserted.push(row as unknown as DeadlineRow);
    }
    store.push(...inserted);
    return { rows: [], meta: { changes: inserted.length } };
  }

  if (normalized.toUpperCase().startsWith('UPDATE')) {
    const setMatch = normalized.match(/SET\s+(.+?)\s+WHERE/i);
    const setPairs: Array<{ column: string; paramIndex: number }> = [];
    if (setMatch) {
      const parts = setMatch[1].split(',').map((p) => p.trim());
      let paramIndex = 0;
      for (const part of parts) {
        const m = part.match(/"?([^"\s]+)"?\s*=\s*\?/);
        if (m) {
          setPairs.push({ column: m[1].replace(/^deadlines\./, ''), paramIndex });
        }
        paramIndex++;
      }
    }
    const whereStart = normalized.toUpperCase().indexOf('WHERE');
    const whereSql = whereStart >= 0 ? normalized.slice(whereStart) : '';
    const conditions = parseWhere(whereSql);
    const setParamCount = setPairs.length;
    const whereParams = params.slice(setParamCount);

    let changes = 0;
    for (const row of store) {
      if (rowMatches(row, conditions, whereParams)) {
        for (const pair of setPairs) {
          (row as unknown as Record<string, unknown>)[pair.column] = params[pair.paramIndex];
        }
        changes++;
      }
    }
    return { rows: [], meta: { changes } };
  }

  if (normalized.toUpperCase().startsWith('DELETE')) {
    const conditions = parseWhere(normalized);
    const initialLength = store.length;
    store = store.filter((row) => !rowMatches(row, conditions, params));
    return { rows: [], meta: { changes: initialLength - store.length } };
  }

  return { rows: [] };
}

vi.mock('../../db', () => ({
  createDb: vi.fn(() => drizzle(batchExecutor, { schema })),
}));

function createTestApp(session: { user: { id: string } } | null) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('session', session ?? undefined);
    await next();
  });
  app.route('/', deadlinesRoutes);
  return app;
}

function requestWithEnv(app: ReturnType<typeof createTestApp>, path: string, init?: RequestInit) {
  return app.request(path, init, { DB: {} } as Bindings);
}

function seedRow(overrides: Partial<DeadlineRow> = {}): DeadlineRow {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    user_id: 'user-1',
    tax_year: 2025,
    jurisdiction: 'ES',
    title: 'ES IRPF',
    description: null,
    due_date: '2025-06-30',
    status: 'pending',
    category: 'tax_filing',
    source: 'system',
    reminder_days: 14,
    snoozed_until: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('F9 deadlines API', () => {
  beforeEach(() => {
    resetStore();
  });

  it('GET returns 401 when anonymous', async () => {
    const app = createTestApp(null);
    const res = await requestWithEnv(app, '/');
    expect(res.status).toBe(401);
  });

  it('GET lists deadlines scoped to user', async () => {
    store.push(seedRow({ user_id: 'user-1', title: 'User 1 deadline' }));
    store.push(seedRow({ user_id: 'user-2', title: 'User 2 deadline' }));
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      count: number;
      items: Array<{ title: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(body.items[0].title).toBe('User 1 deadline');
  });

  it('GET filters by taxYear, status, jurisdiction, category', async () => {
    store.push(
      seedRow({ tax_year: 2025, jurisdiction: 'ES', status: 'pending', category: 'tax_filing' }),
    );
    store.push(
      seedRow({ tax_year: 2026, jurisdiction: 'PT', status: 'completed', category: 'payment' }),
    );
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(
      app,
      '/?taxYear=2025&status=pending&jurisdiction=ES&category=tax_filing',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(1);
  });

  it('GET filters by dueDate range', async () => {
    store.push(seedRow({ due_date: '2025-03-01' }));
    store.push(seedRow({ due_date: '2025-09-01' }));
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/?from=2025-01-01&to=2025-06-30');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(1);
  });

  it('POST creates a deadline', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taxYear: 2025,
        jurisdiction: 'DE',
        title: 'DE Einkommensteuer',
        dueDate: '2025-05-31',
        category: 'tax_filing',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; item: { title: string; source: string } };
    expect(body.ok).toBe(true);
    expect(body.item.title).toBe('DE Einkommensteuer');
    expect(body.item.source).toBe('user');
    expect(store).toHaveLength(1);
  });

  it('POST returns 400 on validation failure', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', dueDate: 'bad-date' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /:id returns a deadline', async () => {
    const row = seedRow();
    store.push(row);
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, `/${row.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; item: { id: string } };
    expect(body.item.id).toBe(row.id);
  });

  it('GET /:id returns 404 for other user deadline', async () => {
    const row = seedRow({ user_id: 'user-2' });
    store.push(row);
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, `/${row.id}`);
    expect(res.status).toBe(404);
  });

  it('PATCH updates a deadline', async () => {
    const row = seedRow();
    store.push(row);
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, `/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated title' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; item: { title: string } };
    expect(body.item.title).toBe('Updated title');
  });

  it('DELETE removes a deadline', async () => {
    const row = seedRow();
    store.push(row);
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, `/${row.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: boolean };
    expect(body.deleted).toBe(true);
    expect(store).toHaveLength(0);
  });

  it('POST /:id/complete marks completed', async () => {
    const row = seedRow();
    store.push(row);
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, `/${row.id}/complete`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; item: { status: string } };
    expect(body.item.status).toBe('completed');
  });

  it('POST /:id/snooze sets snoozed status', async () => {
    const row = seedRow();
    store.push(row);
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, `/${row.id}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ until: '2025-08-01' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      item: { status: string; snoozedUntil: string | null };
    };
    expect(body.item.status).toBe('snoozed');
    expect(body.item.snoozedUntil).toBe('2025-08-01');
  });

  it('POST /seed creates system deadlines', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taxYear: 2025, jurisdictions: ['ES', 'PT'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; count: number };
    expect(body.ok).toBe(true);
    expect(body.count).toBeGreaterThan(0);
    expect(store.every((r) => r.source === 'system')).toBe(true);
  });
});
