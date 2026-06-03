/**
 * F6 Days API — integration tests.
 * Uses Hono's built-in requestWithEnv(app, ) with in-memory D1 mock via drizzle sqlite-proxy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { Bindings, Variables } from '../index';
import { daysRoutes } from './days';
import * as schema from '../../db/schema';

// ── In-memory store ──────────────────────────────────────────────────────────

interface DayRow {
  id: string;
  user_id: string;
  country: string;
  date: string;
  source: string;
  note: string | null;
  created_at: number;
}

let store: DayRow[] = [];

function resetStore() {
  store = [];
}

// ── SQL executor for drizzle sqlite-proxy ────────────────────────────────────

async function batchExecutor(
  sql: string,
  params: any[],
  _method: 'all' | 'run' | 'get' | 'values',
): Promise<{ rows: any[]; meta?: { changes?: number } }> {
  const normalized = sql.replace(/\s+/g, ' ').trim();

  // SELECT
  if (normalized.toUpperCase().startsWith('SELECT')) {
    // Extract selected columns
    const selectMatch = normalized.match(/SELECT\s+(.*?)\s+FROM/i);
    const selectCols = selectMatch
      ? selectMatch[1].split(',').map((c) => c.trim().replace(/"/g, '').replace(/^user_days\./, ''))
      : [];

    const filtered = store.filter((row) => {
      const whereIdx = normalized.toUpperCase().indexOf('WHERE');
      if (whereIdx === -1) return true;

      const whereClause = normalized.slice(whereIdx + 5).trim();
      const conditions = whereClause.split(/\s+AND\s+/i);
      let paramIdx = 0;

      for (const cond of conditions) {
        const match = cond.match(/"([^"]+)"\s*(>=|<=|=)\s*\?/);
        if (!match) continue;

        const col = match[1];
        const op = match[2];
        const param = params[paramIdx++];

        const val = (row as any)[col];
        if (op === '=' && val !== param) return false;
        if (op === '>=' && val < param) return false;
        if (op === '<=' && val > param) return false;
      }
      return true;
    });

    // Return rows as arrays (drizzle sqlite-proxy maps arrays to objects by column order)
    const columnList = selectCols.length > 0 ? selectCols : ['date', 'country', 'source', 'note'];
    const rows = filtered.map((row) => columnList.map((col) => (row as any)[col] ?? null));

    return { rows };
  }

  // INSERT
  if (normalized.toUpperCase().startsWith('INSERT')) {
    // Extract column names
    const colMatch = normalized.match(/\(([^)]+)\)\s*VALUES/i);
    const cols = colMatch
      ? colMatch[1].split(',').map((c) => c.trim().replace(/"/g, ''))
      : [];

    // Check for ON CONFLICT DO UPDATE
    const isUpsert = normalized.toUpperCase().includes('ON CONFLICT');

    // Build row objects
    const rowCount = params.length / cols.length;
    const inserted: DayRow[] = [];

    for (let i = 0; i < rowCount; i++) {
      const row: any = {};
      for (let j = 0; j < cols.length; j++) {
        row[cols[j]] = params[i * cols.length + j];
      }
      inserted.push(row as DayRow);
    }

    let changes = 0;
    for (const row of inserted) {
      const existingIdx = store.findIndex(
        (r) => r.user_id === row.user_id && r.date === row.date,
      );
      if (existingIdx >= 0) {
        if (isUpsert) {
          // UPSERT: update existing
          store[existingIdx] = { ...store[existingIdx], ...row };
          changes++;
        }
        // If not upsert, skip (onConflictDoNothing)
      } else {
        store.push(row);
        changes++;
      }
    }

    return { rows: [], meta: { changes } };
  }

  // DELETE
  if (normalized.toUpperCase().startsWith('DELETE')) {
    const whereIdx = normalized.toUpperCase().indexOf('WHERE');
    let deletedCount = 0;

    if (whereIdx === -1) {
      deletedCount = store.length;
      store = [];
    } else {
      const whereClause = normalized.slice(whereIdx + 5).trim();
      const conditions = whereClause.split(/\s+AND\s+/i);
      let paramIdx = 0;

      const toDelete: DayRow[] = [];
      for (const row of store) {
        let matches = true;
        paramIdx = 0;
        for (const cond of conditions) {
          const match = cond.match(/"([^"]+)"\s*(>=|<=|=)\s*\?/);
          if (!match) continue;
          const col = match[1];
          const op = match[2];
          const param = params[paramIdx++];
          const val = (row as any)[col];
          if (op === '=' && val !== param) { matches = false; break; }
          if (op === '>=' && val < param) { matches = false; break; }
          if (op === '<=' && val > param) { matches = false; break; }
        }
        if (matches) toDelete.push(row);
      }

      deletedCount = toDelete.length;
      const idsToDelete = new Set(toDelete.map((r) => r.id));
      store = store.filter((r) => !idsToDelete.has(r.id));
    }

    return { rows: [], meta: { changes: deletedCount } };
  }

  return { rows: [] };
}

// ── Mock createDb ────────────────────────────────────────────────────────────

vi.mock('../../db', () => ({
  createDb: vi.fn(() => drizzle(batchExecutor, { schema })),
}));

// ── Test app factory ─────────────────────────────────────────────────────────

function createTestApp(session: { user: { id: string } } | null) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('session', session ?? undefined);
    await next();
  });
  app.route('/', daysRoutes);
  return app;
}

function requestWithEnv(
  app: ReturnType<typeof createTestApp>,
  path: string,
  init?: RequestInit,
) {
  return app.request(path, init, { DB: {} } as Bindings);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/days', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(null);
    const res = await requestWithEnv(app, '/');
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe('unauthorized');
  });

  it('returns empty array when no days exist (default range)', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.days).toEqual([]);
  });

  it('returns filtered days within from/to range', async () => {
    store.push(
      { id: '1', user_id: 'user-1', country: 'ES', date: '2025-06-01', source: 'manual', note: null, created_at: Date.now() },
      { id: '2', user_id: 'user-1', country: 'PT', date: '2025-06-15', source: 'manual', note: null, created_at: Date.now() },
      { id: '3', user_id: 'user-1', country: 'DE', date: '2025-07-01', source: 'manual', note: null, created_at: Date.now() },
    );
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/?from=2025-06-01&to=2025-06-30');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.days).toHaveLength(2);
    expect(body.days[0].date).toBe('2025-06-01');
    expect(body.days[1].date).toBe('2025-06-15');
  });

  it('returns 400 when from > to', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/?from=2025-06-15&to=2025-06-01');
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('from must be before');
  });

  it('returns 400 when range exceeds 366 days', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/?from=2025-01-01&to=2026-02-01');
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('366');
  });

  it('returns 400 for invalid date format', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/?from=01-01-2025&to=2025-06-01');
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Invalid date format');
  });

  it('scopes results to the authenticated user only', async () => {
    store.push(
      { id: '1', user_id: 'user-1', country: 'ES', date: '2025-06-01', source: 'manual', note: null, created_at: Date.now() },
      { id: '2', user_id: 'user-2', country: 'PT', date: '2025-06-01', source: 'manual', note: null, created_at: Date.now() },
    );
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/?from=2025-01-01&to=2025-12-31');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.days).toHaveLength(1);
    expect(body.days[0].country).toBe('ES');
  });
});

describe('POST /api/days', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(null);
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: [{ date: '2025-06-01', country: 'ES' }] }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe('unauthorized');
  });

  it('inserts a single day entry successfully', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: [{ date: '2025-06-01', country: 'ES' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.written).toBe(1);
    expect(store).toHaveLength(1);
    expect(store[0].country).toBe('ES');
    expect(store[0].user_id).toBe('user-1');
  });

  it('UPSERT: same date with different country updates existing row', async () => {
    store.push(
      { id: 'existing', user_id: 'user-1', country: 'ES', date: '2025-06-01', source: 'manual', note: null, created_at: Date.now() },
    );
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: [{ date: '2025-06-01', country: 'PT' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.written).toBe(1);
    expect(store).toHaveLength(1);
    expect(store[0].country).toBe('PT');
  });

  it('returns 400 for duplicate dates in request array', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        days: [
          { date: '2025-06-01', country: 'ES' },
          { date: '2025-06-01', country: 'PT' },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('Duplicate dates in request');
  });

  it('returns 400 for empty days array', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('validation');
  });

  it('returns 400 for more than 400 entries', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const days = Array.from({ length: 401 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      country: 'ES' as const,
    }));
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('validation');
  });

  it('returns 400 for invalid country', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: [{ date: '2025-06-01', country: 'XX' }] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('validation');
  });

  it('returns 400 for note exceeding 200 characters', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        days: [{ date: '2025-06-01', country: 'ES', note: 'x'.repeat(201) }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('validation');
  });

  it('supports optional source and note fields', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        days: [{ date: '2025-06-01', country: 'DE', source: 'import', note: 'Business trip' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(store).toHaveLength(1);
    expect(store[0].source).toBe('import');
    expect(store[0].note).toBe('Business trip');
  });

  it('accepts OTHER as a valid country', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: [{ date: '2025-06-01', country: 'OTHER' }] }),
    });
    expect(res.status).toBe(200);
    expect(store[0].country).toBe('OTHER');
  });
});

describe('DELETE /api/days/:date', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(null);
    const res = await requestWithEnv(app, '/2025-06-01', { method: 'DELETE' });
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe('unauthorized');
  });

  it('deletes an existing day entry and returns deleted:1', async () => {
    store.push(
      { id: '1', user_id: 'user-1', country: 'ES', date: '2025-06-01', source: 'manual', note: null, created_at: Date.now() },
    );
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/2025-06-01', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(1);
    expect(store).toHaveLength(0);
  });

  it('returns deleted:0 for a non-existent date', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/2025-06-01', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(0);
  });

  it('returns 400 for invalid date format', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/01-06-2025', { method: 'DELETE' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Invalid date format');
  });

  it('only deletes the authenticated user entry', async () => {
    store.push(
      { id: '1', user_id: 'user-1', country: 'ES', date: '2025-06-01', source: 'manual', note: null, created_at: Date.now() },
      { id: '2', user_id: 'user-2', country: 'PT', date: '2025-06-01', source: 'manual', note: null, created_at: Date.now() },
    );
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await requestWithEnv(app, '/2025-06-01', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(1);
    expect(store).toHaveLength(1);
    expect(store[0].user_id).toBe('user-2');
  });
});
