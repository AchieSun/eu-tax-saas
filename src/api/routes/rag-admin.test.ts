import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vectorize1024 } from '../../services/rag/types';
import type { Bindings, Variables } from '../index';
import { auditMiddleware } from '../middleware/audit';
import { ragAdminRoutes } from './rag-admin';

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockDb = { select: mockSelect, insert: mockInsert };

vi.mock('../../db', () => ({
  createDb: vi.fn(() => mockDb),
}));

function makeQueryChain(result: unknown) {
  const limitFn = vi.fn(() => Promise.resolve(result));
  const whereFn = vi.fn(() => ({ limit: limitFn }));
  return {
    from: vi.fn(() => ({ where: whereFn })),
  };
}

function makeVector(seed = 0): Vectorize1024 {
  return Array.from({ length: 1024 }, (_, i) => (i + seed) / 1024) as Vectorize1024;
}

function makeChunk(idSeed: number) {
  const id = idSeed.toString(16).padStart(64, '0');
  return {
    id,
    jurisdiction: 'ES',
    sourceUrl: 'https://boe.es/example',
    sourceTitle: 'Example',
    authority: 'BOE',
    taxYear: 2025,
    topic: 'irpf',
    lang: 'es',
    chunkIndex: idSeed,
    charCount: 10,
    text: `chunk-${idSeed}`,
    contentHash: 'b'.repeat(64),
    fetchedAt: new Date().toISOString(),
    vector: null,
  };
}

function makeFakeBindings(): Bindings {
  return {
    DB: {} as Bindings['DB'],
    KV: {
      put: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve(null)),
    } as unknown as Bindings['KV'],
    R2: {} as Bindings['R2'],
    AI: {
      run: vi.fn(async (_model: string, input: { text: string[] }) => ({
        data: input.text.map((_, i) => makeVector(i)),
      })),
    } as unknown as Bindings['AI'],
    VECTORIZE: {
      upsert: vi.fn(() => Promise.resolve()),
      query: vi.fn(() => Promise.resolve({ matches: [] })),
    } as unknown as Bindings['VECTORIZE'],
    QUEUE: {} as Bindings['QUEUE'],
    ENVIRONMENT: 'test',
    APP_URL: 'http://localhost:8787',
    BETTER_AUTH_SECRET: 'test-secret',
  };
}

function createTestApp(mockSession: unknown) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (mockSession) c.set('session', mockSession as { user: { id: string } });
    await next();
  });
  app.use('/api/admin/rag', auditMiddleware());
  app.use('/api/admin/rag/*', auditMiddleware());
  app.route('/api/admin/rag', ragAdminRoutes);
  return app;
}

describe('POST /api/admin/rag/upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockResolvedValue(undefined);
  });

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(null);
    const res = await app.request(
      '/api/admin/rag/upsert',
      { method: 'POST', body: '{}' },
      makeFakeBindings(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    mockSelect.mockReturnValueOnce(makeQueryChain([{ role: 'user' }]));
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await app.request(
      '/api/admin/rag/upsert',
      { method: 'POST', body: JSON.stringify({ chunks: [makeChunk(1)] }) },
      makeFakeBindings(),
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid body', async () => {
    mockSelect.mockReturnValueOnce(makeQueryChain([{ role: 'admin' }]));
    const app = createTestApp({ user: { id: 'admin-1' } });
    const res = await app.request(
      '/api/admin/rag/upsert',
      { method: 'POST', body: JSON.stringify({ chunks: 'not-an-array' }) },
      makeFakeBindings(),
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 and upserts chunks for admin', async () => {
    mockSelect.mockReturnValueOnce(makeQueryChain([{ role: 'admin' }]));
    const env = makeFakeBindings();
    const app = createTestApp({ user: { id: 'admin-1' } });
    const chunks = [makeChunk(1), makeChunk(2)];
    const res = await app.request(
      '/api/admin/rag/upsert',
      { method: 'POST', body: JSON.stringify({ chunks }) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; upserted: number; kvWritten: number };
    expect(body.ok).toBe(true);
    expect(body.upserted).toBe(2);
    expect(body.kvWritten).toBe(2);
    expect(env.KV.put).toHaveBeenCalledTimes(2);
    expect(env.VECTORIZE.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects more than 64 chunks per request', async () => {
    mockSelect.mockReturnValueOnce(makeQueryChain([{ role: 'admin' }]));
    const app = createTestApp({ user: { id: 'admin-1' } });
    const chunks = Array.from({ length: 65 }, (_, i) => makeChunk(i));
    const res = await app.request(
      '/api/admin/rag/upsert',
      { method: 'POST', body: JSON.stringify({ chunks }) },
      makeFakeBindings(),
    );
    expect(res.status).toBe(400);
  });
});
