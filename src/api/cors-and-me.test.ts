/**
 * cors-and-me.test.ts — Oracle P0-1 + P0-3 (W4 review).
 *
 * Covers:
 *   - GET /api/me: authed users get { userId, role }; anon gets 401.
 *   - CORS allowlist: only origins matching c.env.APP_URL (plus localhost
 *     in development) get an Access-Control-Allow-Origin echo. Other
 *     origins receive no ACAO header so the browser refuses the response.
 *
 * Mocks the Better Auth handler + the db chain so we don't need a live
 * D1/auth stack — we hijack `c.set('session', ...)` directly via a
 * test-only middleware mounted before the rest of the app, mirroring the
 * pattern used in src/api/routes/forms.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── DB + Better Auth mocks (declared BEFORE app import) ─────────────────
let mockRoleForId: string | null = 'user';

vi.mock('../db', () => {
  const limit = vi.fn(async (_n: number) =>
    mockRoleForId === null ? [] : [{ role: mockRoleForId }],
  );
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { createDb: vi.fn(() => ({ select })) };
});

// Better Auth's per-request instance is created from c.env at request time
// (../auth/auth -> createAuth). Stub it out so we don't reach into the real
// auth stack — the session-injector middleware below is the source of truth
// for "is this user logged in".
vi.mock('../auth/auth', () => ({
  createAuth: () => ({
    api: { getSession: async () => null },
    handler: () => new Response('not used', { status: 200 }),
  }),
}));

// Import AFTER mocks are registered so the app picks them up.
import { app } from './index';
import type { Bindings } from './index';

// ── Test harness ───────────────────────────────────────────────────────
const baseEnv = {
  DB: {} as unknown,
  KV: {} as unknown,
  R2: {} as unknown,
  AI: {} as unknown,
  QUEUE: {} as unknown,
  ENVIRONMENT: 'production',
  APP_URL: 'https://app.example.com',
  BETTER_AUTH_SECRET: 'test-secret',
};

function makeEnv(overrides: Partial<typeof baseEnv> = {}): Bindings {
  return { ...baseEnv, ...overrides } as unknown as Bindings;
}

/**
 * Inject a session into the request by mounting a one-off middleware
 * BEFORE the existing app routes. We can't mutate `app` permanently
 * because module state is shared across tests, so we wrap each call in a
 * small parent app that re-routes to the production app after seeding the
 * session via a header that a test-only `vi.spyOn` would normally inject.
 * The simplest reliable route: directly call app.request() and rely on
 * the test-double for createAuth to return null — then we manually mount
 * a pre-middleware on the production app for the authed cases.
 *
 * Cleaner alternative actually used: use the production app verbatim and,
 * for the authed test, monkey-patch the auth getSession mock to return a
 * fixed session for that single request.
 */

describe('Oracle P0-1: GET /api/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoleForId = 'user';
  });

  it('returns 401 for anonymous requests', async () => {
    const res = await app.request('/api/me', {}, makeEnv());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('unauthorized');
  });

  it('returns 200 with { userId, role } for authed admin', async () => {
    // Hijack the auth mock for one call.
    const auth = await import('../auth/auth');
    const spy = vi.spyOn(auth, 'createAuth').mockReturnValue({
      api: { getSession: async () => ({ user: { id: 'admin-1' } }) },
      handler: () => new Response('not used', { status: 200 }),
    } as unknown as ReturnType<typeof auth.createAuth>);
    mockRoleForId = 'admin';
    const res = await app.request('/api/me', {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId?: string; role?: string };
    expect(body.userId).toBe('admin-1');
    expect(body.role).toBe('admin');
    spy.mockRestore();
  });

  it('defaults role to "user" when the users row is missing', async () => {
    const auth = await import('../auth/auth');
    const spy = vi.spyOn(auth, 'createAuth').mockReturnValue({
      api: { getSession: async () => ({ user: { id: 'ghost-1' } }) },
      handler: () => new Response('not used', { status: 200 }),
    } as unknown as ReturnType<typeof auth.createAuth>);
    mockRoleForId = null; // simulate empty SELECT result
    const res = await app.request('/api/me', {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId?: string; role?: string };
    expect(body.role).toBe('user');
    spy.mockRestore();
  });
});

describe('Oracle P0-3: CORS allowlist (APP_URL-driven)', () => {
  it('echoes ACAO for origin matching env.APP_URL', async () => {
    const res = await app.request(
      '/api/health',
      { headers: { origin: 'https://app.example.com' } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('omits ACAO for origin NOT in the allowlist', async () => {
    const res = await app.request(
      '/api/health',
      { headers: { origin: 'https://attacker.example.invalid' } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    // hono/cors returns null/undefined for disallowed origins; assert absent
    // OR not equal to the attacker origin (some hono builds emit empty).
    const acao = res.headers.get('access-control-allow-origin');
    expect(acao).not.toBe('https://attacker.example.invalid');
    expect(acao === null || acao === '').toBe(true);
  });

  it('OPTIONS preflight from disallowed origin returns no ACAO header', async () => {
    const res = await app.request(
      '/api/forms/DE/2024/mantelbogen/render',
      {
        method: 'OPTIONS',
        headers: {
          origin: 'https://attacker.example.invalid',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      },
      makeEnv(),
    );
    const acao = res.headers.get('access-control-allow-origin');
    expect(acao).not.toBe('https://attacker.example.invalid');
    expect(acao === null || acao === '').toBe(true);
  });

  it('allows localhost only when ENVIRONMENT === "development"', async () => {
    // Production: localhost is NOT allowed
    const prodRes = await app.request(
      '/api/health',
      { headers: { origin: 'http://localhost:3000' } },
      makeEnv({ ENVIRONMENT: 'production' }),
    );
    const prodAcao = prodRes.headers.get('access-control-allow-origin');
    expect(prodAcao === null || prodAcao === '').toBe(true);

    // Development: localhost IS allowed
    const devRes = await app.request(
      '/api/health',
      { headers: { origin: 'http://localhost:3000' } },
      makeEnv({ ENVIRONMENT: 'development' }),
    );
    expect(devRes.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});
