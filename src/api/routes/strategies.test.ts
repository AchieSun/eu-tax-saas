/**
 * F4 — strategies API contract tests.
 *
 * Tests pure endpoints (GET /, GET /status, POST /evaluate) plus the
 * paywall-gated POST /ai-recommend and POST /persist. The Pro gate
 * (requireActiveSubscription) consults users.role + users.subscription_status;
 * the createDb mock below resolves the users select to `mockUserAccess`
 * so tests can flip the caller between free / active / admin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Paywall mock state — what the users-table select resolves to. Default
// makes every session-holding caller Pro (admin) so the pre-paywall tests
// (validation, persist happy paths) keep their original semantics.
let mockUserAccess: { role: string; subscriptionStatus: string } | null = {
  role: 'admin',
  subscriptionStatus: 'active',
};

// Oracle P1#3: POST /evaluate now uses rateLimitD1 middleware (anonymous).
// Mock createDb so the middleware's D1 insert succeeds without a real binding.
// values() returns a thenable that ALSO carries onConflictDoUpdate, so it
// works for both the rate-limit upsert (chains onConflictDoUpdate) AND the
// persist endpoint (awaits values() directly). select() resolves the
// users-role/subscription lookup used by requireActiveSubscription.
vi.mock('../../db', () => ({
  createDb: vi.fn(() => {
    const valuesReturn = Object.assign(Promise.resolve(undefined), {
      onConflictDoUpdate: vi.fn(() => ({
        returning: vi.fn(async () => [{ count: 1 }]),
      })),
    });
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => (mockUserAccess === null ? [] : [mockUserAccess])),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => valuesReturn),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => undefined),
        })),
      })),
    };
  }),
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

describe('POST /api/strategies/evaluate — t3 server-side free-tier trimming', () => {
  const INPUT = {
    country: 'ES',
    taxYear: 2025,
    incomeType: 'salary',
    grossIncome: 200_000,
    specialStatus: 'beckham',
    filingStatus: 'single',
    region: 'MAD',
  };

  function parentAppWithSession(userId: string | null) {
    type Vars = { session: { user: { id: string } } | null };
    const { Hono } = require('hono') as typeof import('hono');
    const parent = new Hono<{ Bindings: typeof TEST_ENV; Variables: Vars }>();
    parent.use('*', async (c, next) => {
      if (userId) c.set('session', { user: { id: userId } });
      await next();
    });
    parent.route('/api/strategies', strategiesRoutes);
    return parent;
  }

  beforeEach(() => {
    mockUserAccess = { role: 'user', subscriptionStatus: 'free' };
  });

  it('anon (no session) receives trimmed rows: reason ≤ 60+ellipsis, empty steps/citations, savings kept', async () => {
    const res = await strategiesRoutes.request(
      '/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(INPUT),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      evaluations: Array<{
        id: string;
        titleZh: string;
        applicable: boolean;
        reason: string;
        estimatedSavingsEur: number | null;
        actionSteps: string[];
        citations: unknown[];
      }>;
    };
    expect(body.evaluations.length).toBeGreaterThan(0);
    for (const ev of body.evaluations) {
      // Kept fields
      expect(typeof ev.titleZh).toBe('string');
      expect(ev.titleZh.length).toBeGreaterThan(0);
      expect(typeof ev.applicable).toBe('boolean');
      // Savings kept on applicable strategies (beckham at 200k must have one)
      // Trimmed fields
      expect(ev.actionSteps).toEqual([]);
      expect(ev.citations).toEqual([]);
      expect(ev.reason.length).toBeLessThanOrEqual(61); // 60 + ellipsis
    }
    const beckham = body.evaluations.find((e) => e.id === 'es.beckham');
    expect(beckham).toBeTruthy();
    expect(beckham?.applicable).toBe(true);
    expect(beckham?.estimatedSavingsEur ?? 0).toBeGreaterThan(0);
  });

  it('free user (session, subscription_status=free) receives trimmed rows', async () => {
    const parent = parentAppWithSession('free-eval-1');
    const res = await parent.request(
      '/api/strategies/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(INPUT),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      evaluations: Array<{ actionSteps: string[]; citations: unknown[]; reason: string }>;
    };
    for (const ev of body.evaluations) {
      expect(ev.actionSteps).toEqual([]);
      expect(ev.citations).toEqual([]);
    }
  });

  it('Pro user (active) receives full rows: non-empty actionSteps + citations with source/url', async () => {
    mockUserAccess = { role: 'user', subscriptionStatus: 'active' };
    const parent = parentAppWithSession('pro-eval-1');
    const res = await parent.request(
      '/api/strategies/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(INPUT),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      evaluations: Array<{
        id: string;
        actionSteps: string[];
        citations: Array<{ source: string; url: string }>;
      }>;
    };
    expect(body.evaluations.length).toBeGreaterThan(0);
    for (const ev of body.evaluations) {
      expect(ev.actionSteps.length).toBeGreaterThan(0);
      expect(ev.citations.length).toBeGreaterThan(0);
      expect(ev.citations[0]?.source).toBeTruthy();
      expect(ev.citations[0]?.url).toMatch(/^https?:\/\//);
    }
  });

  it('long reason is clipped with ellipsis at 60 chars', async () => {
    // The catch-all strategies return varied reasons; craft via a strategy
    // with a known long reason by using an input that triggers one. Instead
    // of depending on live copy, assert the invariant on every row.
    const res = await strategiesRoutes.request(
      '/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(INPUT),
      },
      TEST_ENV,
    );
    const body = (await res.json()) as { evaluations: Array<{ reason: string }> };
    for (const ev of body.evaluations) {
      expect(ev.reason.length).toBeLessThanOrEqual(61);
    }
    // At least one row should actually be long enough to need clipping for
    // this input (strategies produce detailed zh copy).
    const clipped = body.evaluations.some((e) => e.reason.endsWith('…'));
    expect(clipped).toBe(true);
  });
});

describe('402 contract (t3): checkoutHint + message present', () => {
  it('ai-recommend 402 includes checkoutHint and message alongside feature/subscriptionStatus', async () => {
    mockUserAccess = { role: 'user', subscriptionStatus: 'free' };
    type Vars = { session: { user: { id: string } } | null };
    const { Hono } = require('hono') as typeof import('hono');
    const parent = new Hono<{ Bindings: typeof TEST_ENV; Variables: Vars }>();
    parent.use('*', async (c, next) => {
      c.set('session', { user: { id: 'contract-402-1' } });
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
      { ...TEST_ENV, DEEPSEEK_API_KEY: 'sk-test' },
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      error: string;
      feature: string;
      subscriptionStatus: string;
      checkoutHint: string;
      message: string;
    };
    expect(body.error).toBe('subscription_required');
    expect(body.feature).toBe('ai-strategy-report');
    expect(body.subscriptionStatus).toBe('free');
    expect(body.checkoutHint).toBe('/app#account');
    expect(body.message).toBe('订阅后解锁完整功能');
  });
});

describe('POST /api/strategies/ai-recommend', () => {
  const AI_BODY = {
    country: 'ES',
    taxYear: 2025,
    incomeType: 'salary',
    grossIncome: 100_000,
    specialStatus: 'none',
    filingStatus: 'single',
    region: 'MAD',
  };

  function parentAppWithSession(userId: string | null = 'test-user-ai') {
    type Vars = { session: { user: { id: string } } | null };
    const { Hono } = require('hono') as typeof import('hono');
    const parent = new Hono<{ Bindings: typeof TEST_ENV; Variables: Vars }>();
    parent.use('*', async (c, next) => {
      if (userId) c.set('session', { user: { id: userId } });
      await next();
    });
    parent.route('/api/strategies', strategiesRoutes);
    return parent;
  }

  beforeEach(() => {
    mockUserAccess = { role: 'admin', subscriptionStatus: 'active' };
  });

  it('paywall: anon gets 401 (gate runs before the DEEPSEEK check)', async () => {
    const res = await strategiesRoutes.request(
      '/ai-recommend',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(AI_BODY),
      },
      { ...TEST_ENV, DEEPSEEK_API_KEY: 'sk-test' },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('paywall: free user gets 402 subscription_required with feature slug', async () => {
    mockUserAccess = { role: 'user', subscriptionStatus: 'free' };
    const parent = parentAppWithSession('free-user-1');
    const res = await parent.request(
      '/api/strategies/ai-recommend',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(AI_BODY),
      },
      { ...TEST_ENV, DEEPSEEK_API_KEY: 'sk-test' },
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      feature: string;
      subscriptionStatus: string;
    };
    expect(body.error).toBe('subscription_required');
    expect(body.feature).toBe('ai-strategy-report');
    expect(body.subscriptionStatus).toBe('free');
  });

  it('paywall: past_due subscriber is NOT granted access', async () => {
    mockUserAccess = { role: 'user', subscriptionStatus: 'past_due' };
    const parent = parentAppWithSession('dunning-user-1');
    const res = await parent.request(
      '/api/strategies/ai-recommend',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(AI_BODY),
      },
      { ...TEST_ENV, DEEPSEEK_API_KEY: 'sk-test' },
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; subscriptionStatus: string };
    expect(body.error).toBe('subscription_required');
    expect(body.subscriptionStatus).toBe('past_due');
  });

  it('returns 503 when DEEPSEEK_API_KEY is unset (Pro user)', async () => {
    const parent = parentAppWithSession('test-user-1');
    const res = await parent.request(
      '/api/strategies/ai-recommend',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(AI_BODY),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('llm_unavailable');
  });

  it('returns 400 on invalid input (Pro user)', async () => {
    const parent = parentAppWithSession('test-user-2');
    const res = await parent.request(
      '/api/strategies/ai-recommend',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...AI_BODY, country: 'XX' }),
      },
      { ...TEST_ENV, DEEPSEEK_API_KEY: 'sk-test' },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('validation');
  });
});

describe('POST /api/strategies/persist (Oracle Wave A+B P2#3)', () => {
  function parentAppWithSession(userId: string | null = 'test-user-3') {
    type Vars = {
      session: { user: { id: string } } | null;
    };
    const { Hono } = require('hono') as typeof import('hono');
    const parent = new Hono<{ Bindings: typeof TEST_ENV; Variables: Vars }>();
    parent.use('*', async (c, next) => {
      c.set('session', userId === null ? null : { user: { id: userId } });
      await next();
    });
    parent.route('/api/strategies', strategiesRoutes);
    return parent;
  }

  beforeEach(() => {
    // Persist happy-path tests exercise the Pro flow end-to-end.
    mockUserAccess = { role: 'user', subscriptionStatus: 'active' };
  });

  it('paywall: free user gets 402 subscription_required (no quota burn, no insert)', async () => {
    mockUserAccess = { role: 'user', subscriptionStatus: 'free' };
    const parent = parentAppWithSession('free-persist-1');
    const res = await parent.request(
      '/api/strategies/persist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: 'es.beckham',
          taxYear: 2025,
          confidence: 0.9,
          eligible: true,
          reason: 'test',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      feature: string;
      subscriptionStatus: string;
    };
    expect(body.error).toBe('subscription_required');
    expect(body.feature).toBe('strategy-report-persist');
    expect(body.subscriptionStatus).toBe('free');
  });

  it('paywall: active subscriber passes the gate (admin not required)', async () => {
    mockUserAccess = { role: 'user', subscriptionStatus: 'active' };
    const parent = parentAppWithSession('sub-persist-1');
    const res = await parent.request(
      '/api/strategies/persist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: 'es.beckham',
          taxYear: 2025,
          confidence: 0.85,
          eligible: true,
          reason: 'active subscriber test',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
  });

  it('returns 401 when no session is attached', async () => {
    const res = await strategiesRoutes.request(
      '/persist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: 'es.beckham',
          taxYear: 2025,
          confidence: 1,
          eligible: true,
          reason: 'test',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('returns 400 on invalid JSON', async () => {
    const parent = parentAppWithSession();
    const res = await parent.request(
      '/api/strategies/persist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json',
      },
      TEST_ENV,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('invalid_json');
  });

  it('returns 400 on validation failure (missing required field)', async () => {
    const parent = parentAppWithSession();
    const res = await parent.request(
      '/api/strategies/persist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // strategyId missing
          taxYear: 2025,
          confidence: 0.9,
          eligible: true,
          reason: 'test',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('validation');
  });

  it('returns 400 on out-of-range confidence', async () => {
    const parent = parentAppWithSession();
    const res = await parent.request(
      '/api/strategies/persist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: 'es.beckham',
          taxYear: 2025,
          confidence: 1.5, // > 1
          eligible: true,
          reason: 'test',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('validation');
  });

  it('returns 404 on unknown strategy_id', async () => {
    const parent = parentAppWithSession();
    const res = await parent.request(
      '/api/strategies/persist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: 'xx.does_not_exist',
          taxYear: 2025,
          confidence: 0.8,
          eligible: true,
          reason: 'test',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('unknown_strategy_id');
  });

  it('persists a valid recommendation and returns a uuid', async () => {
    const parent = parentAppWithSession();
    const res = await parent.request(
      '/api/strategies/persist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: 'es.beckham',
          taxYear: 2025,
          estimatedSavings: 12_345,
          confidence: 0.85,
          eligible: true,
          reason: 'High-income ES resident — Beckham regime applies',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('persists with estimatedSavings=null (uncomputable savings)', async () => {
    const parent = parentAppWithSession();
    const res = await parent.request(
      '/api/strategies/persist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: 'pt.despesas_saude',
          taxYear: 2025,
          estimatedSavings: null,
          confidence: 0.5,
          eligible: true,
          reason: 'PT health expenses — actual savings depends on medicalExpensesEur',
        }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
  });
});
