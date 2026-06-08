/**
 * F4 — strategies API contract tests.
 *
 * Tests only pure endpoints (GET /, GET /status, POST /evaluate). The
 * persist endpoint depends on D1 + session auth — covered separately
 * once a session fixture exists in the repo.
 */
import { describe, expect, it, vi } from 'vitest';

// Oracle P1#3: POST /evaluate now uses rateLimitD1 middleware (anonymous).
// Mock createDb so the middleware's D1 insert succeeds without a real binding.
vi.mock('../../db', () => ({
  createDb: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(async () => [{ count: 1 }]),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => undefined),
      })),
    })),
  })),
}));

// Ensure all bundled strategies auto-register before the route handlers run.
import '../../strategies';
import { strategiesRoutes } from './strategies';

// Stub Bindings — `createDb` is mocked above so the D1 instance is opaque.
const TEST_ENV = { DB: {} } as unknown as Parameters<typeof strategiesRoutes.request>[2];

describe('GET /api/strategies/status', () => {
  it('reports implemented + registered count', async () => {
    const res = await strategiesRoutes.request('/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      tiers: string[];
      registered: number;
    };
    expect(body.status).toBe('implemented');
    expect(body.tiers).toEqual(['A', 'B']);
    // 8 A-tier + 14 B-tier = 22
    expect(body.registered).toBeGreaterThanOrEqual(22);
  });
});

describe('GET /api/strategies', () => {
  it('lists all 22 strategies with citations', async () => {
    const res = await strategiesRoutes.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      count: number;
      items: Array<{ id: string; tier: 'A' | 'B'; citation: { url: string } }>;
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(22);
    for (const item of body.items) {
      expect(item.id).toBeTruthy();
      expect(['A', 'B']).toContain(item.tier);
      expect(item.citation.url).toMatch(/^https?:\/\//);
    }
  });

  it('filters by country=ES&taxYear=2025', async () => {
    const res = await strategiesRoutes.request('/?country=ES&taxYear=2025');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      items: Array<{ id: string }>;
    };
    expect(body.ok).toBe(true);
    // ES has: es.beckham, es.deduccion_arrendamiento, es.deduccion_vivienda_habitual,
    // es.pension_fund + EU-wide (country_arbitrage, dtt_relief, 183day_planning) = 7
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain('es.beckham');
    expect(ids).toContain('es.pension_fund');
    expect(ids).toContain('eu.country_arbitrage');
    // No country-specific strategies from other jurisdictions
    expect(ids).not.toContain('de.werbungskosten');
    expect(ids).not.toContain('uk.fig');
  });

  it('rejects invalid country with 400', async () => {
    const res = await strategiesRoutes.request('/?country=XX');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_country');
  });

  it('rejects invalid taxYear with 400', async () => {
    const res = await strategiesRoutes.request('/?country=ES&taxYear=2099');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('invalid_tax_year');
  });
});

describe('POST /api/strategies/evaluate', () => {
  it('returns baseline + evaluations sorted (applicable first, saving desc)', async () => {
    const res = await strategiesRoutes.request(
      '/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country: 'ES',
          taxYear: 2025,
          incomeType: 'salary',
          grossIncome: 200_000,
          specialStatus: 'beckham',
          filingStatus: 'single',
          region: 'MAD',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      baseline: { country: string; taxOwed: number };
      evaluations: Array<{
        id: string;
        applicable: boolean;
        estimatedSavingsEur: number | null;
        confidence: number;
      }>;
    };
    expect(body.ok).toBe(true);
    expect(body.baseline.country).toBe('ES');
    expect(body.baseline.taxOwed).toBeGreaterThan(0);
    // Applicable strategies precede ineligible ones
    let sawInapplicable = false;
    for (const ev of body.evaluations) {
      if (!ev.applicable) sawInapplicable = true;
      if (sawInapplicable && ev.applicable) {
        throw new Error(`Sorting invariant violated at ${ev.id}: applicable after ineligible`);
      }
    }
    // Beckham should be applicable for 200k income
    const beckham = body.evaluations.find((e) => e.id === 'es.beckham');
    expect(beckham?.applicable).toBe(true);
    expect(beckham?.estimatedSavingsEur ?? 0).toBeGreaterThan(0);
  });

  it('returns 400 on invalid JSON', async () => {
    const res = await strategiesRoutes.request(
      '/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json-{',
      },
      TEST_ENV,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('invalid_json');
  });

  it('returns 400 on validation failure (bad country)', async () => {
    const res = await strategiesRoutes.request(
      '/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country: 'XX',
          taxYear: 2025,
          incomeType: 'salary',
          grossIncome: 50_000,
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('validation');
  });

  it('Oracle P0#1: ES Beckham without region returns 200 (baseline defaults to MAD)', async () => {
    const res = await strategiesRoutes.request(
      '/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country: 'ES',
          taxYear: 2025,
          incomeType: 'salary',
          grossIncome: 200_000,
          specialStatus: 'beckham',
          filingStatus: 'single',
          // intentionally NO region — Beckham is a national flat rate
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      baseline: { country: string; taxOwed: number };
      evaluations: Array<{ id: string; applicable: boolean; estimatedSavingsEur: number | null }>;
    };
    expect(body.ok).toBe(true);
    expect(body.baseline.country).toBe('ES');
    expect(body.baseline.taxOwed).toBeGreaterThan(0);
    const beckham = body.evaluations.find((e) => e.id === 'es.beckham');
    expect(beckham?.applicable).toBe(true);
    expect(beckham?.estimatedSavingsEur ?? 0).toBeGreaterThan(0);
  });

  it('UK 80k case: applicable strategies include uk.fig + uk.pension_relief', async () => {
    const res = await strategiesRoutes.request(
      '/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country: 'UK',
          taxYear: 2025,
          incomeType: 'salary',
          grossIncome: 80_000,
          specialStatus: 'fig',
          filingStatus: 'single',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      evaluations: Array<{ id: string; applicable: boolean }>;
    };
    const applicableIds = body.evaluations.filter((e) => e.applicable).map((e) => e.id);
    expect(applicableIds).toContain('uk.fig');
    expect(applicableIds).toContain('uk.pension_relief');
  });
});

describe('POST /api/strategies/ai-recommend', () => {
  it('returns 401 when no session is attached', async () => {
    const res = await strategiesRoutes.request(
      '/ai-recommend',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country: 'ES',
          taxYear: 2025,
          incomeType: 'salary',
          grossIncome: 100_000,
          specialStatus: 'none',
          filingStatus: 'single',
          region: 'MAD',
        }),
      },
      { ...TEST_ENV, DEEPSEEK_API_KEY: 'sk-test' },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('returns 503 when DEEPSEEK_API_KEY is unset (with session)', async () => {
    // Provide a session via Hono routing override by using a wrapper Hono app
    // that sets the session var before delegating. The simplest approach is to
    // mount strategiesRoutes inside a parent app and seed `c.set('session', ...)`.
    const { Hono } = await import('hono');
    type Vars = {
      session: { user: { id: string } } | null;
    };
    const parent = new Hono<{ Bindings: typeof TEST_ENV; Variables: Vars }>();
    parent.use('*', async (c, next) => {
      c.set('session', { user: { id: 'test-user-1' } });
      await next();
    });
    parent.route('/api/strategies', strategiesRoutes);
    const res = await parent.request(
      '/api/strategies/ai-recommend',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country: 'ES',
          taxYear: 2025,
          incomeType: 'salary',
          grossIncome: 100_000,
          specialStatus: 'none',
          filingStatus: 'single',
          region: 'MAD',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('llm_unavailable');
  });

  it('returns 400 on invalid input (with session and key)', async () => {
    const { Hono } = await import('hono');
    type Vars = {
      session: { user: { id: string } } | null;
    };
    const parent = new Hono<{ Bindings: typeof TEST_ENV; Variables: Vars }>();
    parent.use('*', async (c, next) => {
      c.set('session', { user: { id: 'test-user-2' } });
      await next();
    });
    parent.route('/api/strategies', strategiesRoutes);
    const res = await parent.request(
      '/api/strategies/ai-recommend',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country: 'XX',
          taxYear: 2025,
          incomeType: 'salary',
          grossIncome: 100_000,
        }),
      },
      { ...TEST_ENV, DEEPSEEK_API_KEY: 'sk-test' },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('validation');
  });
});
