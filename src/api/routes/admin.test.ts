/**
 * Admin audit log API — integration tests.
 *
 * Tests requireAdmin middleware + GET /audit endpoint with mocked DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import adminRoutes from './admin';
import { auditMiddleware } from '../middleware/audit';
import type { Bindings, Variables } from '../index';

// ── Mock DB ──────────────────────────────────────────────────────────────────

function makeQueryChain(result: unknown) {
  const limitFn = vi.fn(() => Promise.resolve(result));
  const orderByFn = vi.fn(() => ({ limit: limitFn }));
  const whereFn = vi.fn(() => ({ orderBy: orderByFn, limit: limitFn }));
  return {
    from: vi.fn(() => ({ where: whereFn })),
  };
}

const testEnv = { DB: {} } as Bindings;

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockDb = { select: mockSelect, insert: mockInsert };

vi.mock('../../db', () => ({
  createDb: vi.fn(() => mockDb),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTestApp(mockSession: unknown) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (mockSession) c.set('session', mockSession as { user: { id: string } });
    await next();
  });
  app.route('/', adminRoutes);
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /audit — requireAdmin middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockResolvedValue(undefined);
  });

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(null);
    const res = await app.request('/audit', {}, testEnv);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
  });

  it('returns 403 when user role is not admin', async () => {
    mockSelect.mockReturnValueOnce(makeQueryChain([{ role: 'user' }]));
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await app.request('/audit', {}, testEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('forbidden');
  });

  it('returns 200 with empty items for admin with no audit logs', async () => {
    mockSelect
      .mockReturnValueOnce(makeQueryChain([{ role: 'admin' }]))
      .mockReturnValueOnce(makeQueryChain([]));
    const app = createTestApp({ user: { id: 'admin-1' } });
    const res = await app.request('/audit', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[]; nextCursor: unknown };
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('returns audit logs in descending order with correct nextCursor', async () => {
    const logs = [
      { id: '1', timestamp: 300, route: '/api/calculate', method: 'POST', userIdOrNull: 'u1', inputHash: 'aaa', resultHash: 'bbb', statusCode: 200, source: 'api' },
      { id: '2', timestamp: 200, route: '/api/residency', method: 'POST', userIdOrNull: 'u1', inputHash: 'ccc', resultHash: 'ddd', statusCode: 200, source: 'api' },
    ];
    mockSelect
      .mockReturnValueOnce(makeQueryChain([{ role: 'admin' }]))
      .mockReturnValueOnce(makeQueryChain(logs));
    const app = createTestApp({ user: { id: 'admin-1' } });
    const res = await app.request('/audit', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ timestamp: number }>; nextCursor: unknown };
    expect(body.items).toHaveLength(2);
    expect(body.items[0].timestamp).toBe(300);
    expect(body.items[1].timestamp).toBe(200);
    expect(body.nextCursor).toBeNull();
  });

  it('cursor pagination: returns first page with nextCursor when more items exist', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({
      id: `${i}`,
      timestamp: 1000 - i,
      route: '/api/calculate',
      method: 'POST',
      userIdOrNull: 'u1',
      inputHash: 'x',
      resultHash: 'y',
      statusCode: 200,
      source: 'api',
    }));
    const extra = { id: '50', timestamp: 949, route: '/api/calculate', method: 'POST', userIdOrNull: 'u1', inputHash: 'x', resultHash: 'y', statusCode: 200, source: 'api' };
    mockSelect
      .mockReturnValueOnce(makeQueryChain([{ role: 'admin' }]))
      .mockReturnValueOnce(makeQueryChain([...page1, extra]));
    const app = createTestApp({ user: { id: 'admin-1' } });
    const res = await app.request('/audit?limit=50', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ timestamp: number }>; nextCursor: number | null };
    expect(body.items).toHaveLength(50);
    expect(body.nextCursor).toBe(951); // page1[49].timestamp = 1000 - 49
  });

  it('supports route filter query param', async () => {
    mockSelect
      .mockReturnValueOnce(makeQueryChain([{ role: 'admin' }]))
      .mockReturnValueOnce(makeQueryChain([]));
    const app = createTestApp({ user: { id: 'admin-1' } });
    const res = await app.request('/audit?route=/api/calculate', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[]; nextCursor: unknown };
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('supports userId filter query param', async () => {
    mockSelect
      .mockReturnValueOnce(makeQueryChain([{ role: 'admin' }]))
      .mockReturnValueOnce(makeQueryChain([]));
    const app = createTestApp({ user: { id: 'admin-1' } });
    const res = await app.request('/audit?userId=user-123', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it('GET /audit (as admin) writes its own audit_log row (P1#8)', async () => {
    mockSelect
      .mockReturnValueOnce(makeQueryChain([{ role: 'admin' }]))
      .mockReturnValueOnce(makeQueryChain([]));
    mockValues.mockClear();

    // Build a full middleware chain app (not just sub-route) so auditMiddleware fires
    const fullApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();
    fullApp.use('*', async (c, next) => {
      c.set('session', { user: { id: 'admin-1' } } as { user: { id: string } });
      await next();
    });
    fullApp.use('/api/admin', auditMiddleware());
    fullApp.use('/api/admin/*', auditMiddleware());
    fullApp.route('/api/admin', adminRoutes);

    const res = await fullApp.request('/api/admin/audit', {}, testEnv);
    expect(res.status).toBe(200);

    // Audit middleware should have called insert + values
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalled();
    const callArgs = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.route).toBe('/api/admin/audit');
    expect(callArgs.method).toBe('GET');
    expect(callArgs.userIdOrNull).toBe('admin-1');
    expect(callArgs.source).toBe('api');
  });
});
