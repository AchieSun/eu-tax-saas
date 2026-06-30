import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings, Variables } from '../index';
import { auditMiddleware } from '../middleware/audit';
import { ragRoutes } from './rag';

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockDb = { select: mockSelect, insert: mockInsert };

vi.mock('../../db', () => ({
  createDb: vi.fn(() => mockDb),
}));

function makeVector(): number[] {
  return Array.from({ length: 1024 }, (_, i) => i / 1024);
}

function makeFakeEnv() {
  return {
    DB: {} as Bindings['DB'],
    KV: {
      put: vi.fn(),
      get: vi.fn(async (key: string) =>
        key === `rag:chunk:${'a'.repeat(64)}` ? 'chunk text' : null,
      ),
    } as unknown as Bindings['KV'],
    R2: {} as Bindings['R2'],
    AI: {
      run: vi.fn(async (_model: string, input: { text: string[] }) => ({
        data: input.text.map(() => makeVector()),
      })),
    } as unknown as Bindings['AI'],
    VECTORIZE: {
      upsert: vi.fn(),
      query: vi.fn(async () => ({
        matches: [
          {
            id: 'a'.repeat(64),
            score: 0.92,
            metadata: {
              jurisdiction: 'ES',
              sourceUrl: 'https://boe.es/example',
              sourceTitle: 'Example',
              authority: 'BOE',
              taxYear: 2025,
              topic: 'irpf',
              lang: 'es',
              chunkIndex: 0,
              charCount: 10,
              contentHash: 'b'.repeat(64),
            },
          },
        ],
        count: 1,
      })),
    } as unknown as Bindings['VECTORIZE'],
    QUEUE: {} as Bindings['QUEUE'],
    ENVIRONMENT: 'test',
    APP_URL: 'http://localhost:8787',
    BETTER_AUTH_SECRET: 'test-secret',
    DEEPSEEK_API_KEY: 'test-key',
    AI_GATEWAY_ACCOUNT_ID: 'test-account',
    AI_GATEWAY_NAME: 'test-gateway',
    AI_GATEWAY_API_TOKEN: 'test-gateway-token',
  };
}

function createTestApp(mockSession: unknown) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (mockSession) c.set('session', mockSession as { user: { id: string } });
    await next();
  });
  app.use('/api/rag', auditMiddleware());
  app.use('/api/rag/*', auditMiddleware());
  app.route('/api/rag', ragRoutes);
  return app;
}

describe('POST /api/rag/qa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockResolvedValue(undefined);
  });

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(null);
    const res = await app.request(
      '/api/rag/qa',
      { method: 'POST', body: JSON.stringify({ question: 'What is IRPF?' }) },
      makeFakeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid body', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await app.request(
      '/api/rag/qa',
      { method: 'POST', body: JSON.stringify({ question: 'x' }) },
      makeFakeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('returns 422 when retrieval finds no context', async () => {
    const env = makeFakeEnv();
    env.VECTORIZE.query = vi.fn(async () => ({ matches: [], count: 0 }));
    const app = createTestApp({ user: { id: 'user-1' } });
    const res = await app.request(
      '/api/rag/qa',
      { method: 'POST', body: JSON.stringify({ question: 'What is IRPF?' }) },
      env,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('no-context');
  });

  it('returns 200 with answer, citations and usage when context exists', async () => {
    const app = createTestApp({ user: { id: 'user-1' } });
    const env = makeFakeEnv();
    // Mock DeepSeekClient.chat via global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        id: 'chat-1',
        object: 'chat.completion',
        created: Date.now(),
        model: 'deepseek-chat',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'IRPF is Spanish income tax.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    ) as unknown as typeof fetch;

    const res = await app.request(
      '/api/rag/qa',
      { method: 'POST', body: JSON.stringify({ question: 'What is IRPF?' }) },
      env,
    );

    globalThis.fetch = originalFetch;

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      answer: string;
      citations: unknown[];
      usage: { totalTokens: number };
    };
    expect(body.ok).toBe(true);
    expect(body.answer).toBe('IRPF is Spanish income tax.');
    expect(body.citations).toHaveLength(1);
    expect(body.usage.totalTokens).toBe(120);
  });
});
