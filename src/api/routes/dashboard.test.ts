import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema';
import type { Bindings, Variables } from '../index';
import { dashboardRoutes } from './dashboard';

interface UserRow {
  id: string;
  name: string;
  email: string;
  subscription_status: string;
}

let usersStore: UserRow[] = [];

function resetStore() {
  usersStore = [];
}

async function batchExecutor(
  sql: string,
  params: unknown[],
  _method: 'all' | 'run' | 'get' | 'values',
): Promise<{ rows: unknown[] }> {
  const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();

  if (normalized.startsWith('SELECT') && normalized.includes('FROM "USERS"')) {
    const filtered = usersStore.filter((row) => row.id === params[0]);
    return {
      rows: filtered.map((row) => [row.name, row.subscription_status]),
    };
  }

  // All other dashboard tables return empty for the smoke test.
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
  app.route('/api/dashboard', dashboardRoutes);
  return app;
}

function requestWithEnv(app: ReturnType<typeof createTestApp>, path: string, init?: RequestInit) {
  return app.request(path, init, { DB: {} } as Bindings);
}

interface DashboardBody {
  ok: boolean;
  taxYear: number;
  user: { firstName: string; subscriptionStatus: string };
  residency: unknown;
  strategies: unknown[];
  days: Array<{ country: string; flag: string; days: number }>;
  deadlines: unknown[];
  filing: { completeness: number };
}

describe('GET /api/dashboard', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns 401 when the user is not authenticated', async () => {
    const app = createTestApp(null);
    const res = await requestWithEnv(app, '/api/dashboard?taxYear=2025');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('returns empty states for a brand-new user', async () => {
    usersStore.push({
      id: 'u-1',
      name: 'Alice Example',
      email: 'alice@example.com',
      subscription_status: 'free',
    });

    const app = createTestApp({ user: { id: 'u-1' } });
    const res = await requestWithEnv(app, '/api/dashboard?taxYear=2025');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardBody;

    expect(body.ok).toBe(true);
    expect(body.taxYear).toBe(2025);
    expect(body.user).toEqual({ firstName: 'Alice', subscriptionStatus: 'free' });
    expect(body.residency).toBeNull();
    expect(body.strategies).toEqual([]);
    expect(body.days).toEqual([
      { country: 'ES', flag: '🇪🇸', days: 0 },
      { country: 'PT', flag: '🇵🇹', days: 0 },
      { country: 'DE', flag: '🇩🇪', days: 0 },
      { country: 'NL', flag: '🇳🇱', days: 0 },
      { country: 'UK', flag: '🇬🇧', days: 0 },
    ]);
    expect(body.deadlines).toEqual([]);
    expect(body.filing.completeness).toBe(0);
  });
});
