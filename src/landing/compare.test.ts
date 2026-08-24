/**
 * /compare 落地页 + GET /api/public/compare 公开端点测试。
 *
 * 覆盖：
 *  - GET /compare 无查询 → 200 + 计算器表单 + CTA + 免责声明
 *  - GET /compare?grossIncome=60000 → 200 + 五国结果表（无 JS 也能算）
 *  - GET /compare 非法输入 → 400 + 错误横幅（#fef2f2 / #991b1b）
 *  - GET /api/public/compare 200：五国齐全、netIncome 降序、breakdown 摘要
 *  - 400：负数 / 非数字 / >1e9 / 非法枚举 / 缺 grossIncome
 *  - 405：POST
 *  - 429：同 IP 第 11 次请求（每分钟 10 次限流）
 *  - 503：D1 故障时 fail-closed（复用 rate-limit-d1 的 fail-closed 语义）
 *
 * D1 通过 mock createDb 模拟原子计数（与 rate-limit-d1.test.ts 同法）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../api';

interface CounterRow {
  key: string;
  windowStart: number;
  count: number;
  expiresAt: number;
}

let mockStore: Map<string, CounterRow>;

vi.mock('../db', () => {
  const insert = vi.fn((_table: unknown) => ({
    values: vi.fn((row: CounterRow) => ({
      onConflictDoUpdate: vi.fn((opts: unknown) => ({
        returning: vi.fn(async () => {
          const set = (opts as { set?: { count?: { queryChunks?: unknown[] } } })?.set;
          const chunks = set?.count?.queryChunks ?? [];
          let cap: number | null = null;
          for (const chunk of chunks) {
            if (typeof chunk === 'number' && Number.isInteger(chunk) && chunk > 1) cap = chunk;
          }
          const k = `${row.key}::${row.windowStart}`;
          const existing = mockStore.get(k);
          if (existing) {
            if (cap === null || existing.count < cap) existing.count += 1;
            mockStore.set(k, existing);
            return [{ count: existing.count }];
          }
          mockStore.set(k, { ...row });
          return [{ count: row.count }];
        }),
      })),
    })),
  }));
  const deleteFn = vi.fn((_table: unknown) => ({
    where: vi.fn(() => ({ limit: vi.fn(async () => undefined) })),
  }));
  return { createDb: vi.fn(() => ({ insert, delete: deleteFn })) };
});

// Import AFTER vi.mock.
import { app } from '../api';
import { comparePage } from './compare';

function fakeEnv(): Bindings {
  return {
    DB: {},
    KV: {},
    R2: {},
    AI: {},
    VECTORIZE: {},
    QUEUE: {},
    ENVIRONMENT: 'test',
    APP_URL: 'http://localhost:8787',
    BETTER_AUTH_SECRET: 'test-secret',
  } as unknown as Bindings;
}

function request(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app.request(path, init, fakeEnv()));
}

describe('GET /compare page', () => {
  it('200: renders form + CTA + disclaimer without query', async () => {
    const res = await request('/compare');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<title>五国税后收入对比计算器');
    expect(body).toContain('id="cmp-form"');
    expect(body).toContain('method="get"');
    expect(body).toContain('name="grossIncome"');
    expect(body).toContain('href="/app"');
    expect(body).toContain('href="/app#strategies"');
    expect(body).toContain('免费注册，生成我的申报草稿');
    expect(body).toContain('查看完整节税策略');
    expect(body).toContain(
      '本工具提供的计算结果仅供参考，不构成税务建议；重大决策请咨询持牌税务顾问。',
    );
  });

  it('200: server-renders results for valid query (no-JS path)', async () => {
    const res = await request('/compare?grossIncome=60000&taxYear=2025');
    expect(res.status).toBe(200);
    const body = await res.text();
    // Title stays the canonical SEO title even with results.
    expect(body).toContain('<title>五国税后收入对比计算器');
    expect(body).toContain('cmp-top');
    expect(body).toContain('到手最高');
    // All five country names present.
    expect(body).toContain('德国');
    expect(body).toContain('荷兰');
    expect(body).toContain('葡萄牙');
    expect(body).toContain('西班牙');
    expect(body).toContain('英国');
    // European-style formatted net income (€ prefix + thousands separator).
    expect(body).toMatch(/€[0-9,]+/);
  });

  it('400: invalid query renders error banner with danger palette', async () => {
    const res = await request('/compare?grossIncome=-5');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('#fef2f2');
    expect(body).toContain('#991b1b');
    expect(body).toContain('税前年收入必须大于 0');
  });
});

describe('GET /api/public/compare', () => {
  beforeEach(() => {
    mockStore = new Map();
    vi.clearAllMocks();
  });

  it('200: five countries, netIncome descending, summary fields', async () => {
    const res = await request('/api/public/compare?grossIncome=60000&taxYear=2025');
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      input: { grossIncome: number; taxYear: number; incomeType: string; filingStatus: string };
      results: Array<{
        country: string;
        countryName: string;
        flag: string;
        grossIncome: number;
        taxOwed: number;
        netIncome: number;
        effectiveRate: number;
        provisional: boolean;
        breakdown: Array<{ label: string; amount: number }>;
      }>;
      countryErrors: unknown[];
    };
    expect(data.ok).toBe(true);
    expect(data.input).toEqual({
      grossIncome: 60000,
      taxYear: 2025,
      incomeType: 'salary',
      filingStatus: 'single',
    });
    expect(data.results).toHaveLength(5);
    expect(new Set(data.results.map((r) => r.country))).toEqual(
      new Set(['DE', 'NL', 'PT', 'ES', 'UK']),
    );
    // Sorted by netIncome desc.
    for (let i = 1; i < data.results.length; i++) {
      expect(data.results[i].netIncome).toBeLessThanOrEqual(data.results[i - 1].netIncome);
    }
    // Row shape.
    for (const row of data.results) {
      expect(row.countryName.length).toBeGreaterThan(0);
      expect(['🇩🇪', '🇳🇱', '🇵🇹', '🇪🇸', '🇬🇧']).toContain(row.flag);
      expect(row.grossIncome).toBe(60000);
      expect(row.netIncome).toBeGreaterThan(0);
      expect(row.effectiveRate).toBeGreaterThan(0);
      expect(Array.isArray(row.breakdown)).toBe(true);
      expect(row.breakdown.length).toBeGreaterThan(0);
    }
    // Exact F1 values at €60k / 2025 / salary / single.
    const byCountry = Object.fromEntries(data.results.map((r) => [r.country, r]));
    expect(byCountry.DE.netIncome).toBe(45585);
    expect(byCountry.ES.netIncome).toBe(44996);
    expect(byCountry.UK.netIncome).toBe(48568);
    expect(byCountry.PT.netIncome).toBeCloseTo(41334.51, 1);
    // Effective rate is a fraction (0.1905 for UK at €60k 2025).
    expect(byCountry.UK.effectiveRate).toBeCloseTo(0.1905, 3);
  });

  it('defaults: taxYear→2026, incomeType→salary, filingStatus→single', async () => {
    const res = await request('/api/public/compare?grossIncome=50000');
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      input: { taxYear: number; incomeType: string; filingStatus: string };
    };
    expect(data.input.taxYear).toBe(2026);
    expect(data.input.incomeType).toBe('salary');
    expect(data.input.filingStatus).toBe('single');
  });

  it('400: negative grossIncome returns Chinese message', async () => {
    const res = await request('/api/public/compare?grossIncome=-1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string; message: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('validation');
    expect(body.message).toBe('税前年收入必须大于 0');
  });

  it('400: non-numeric grossIncome', async () => {
    const res = await request('/api/public/compare?grossIncome=abc');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('税前年收入必须是数字');
  });

  it('400: grossIncome above 1e9', async () => {
    const res = await request('/api/public/compare?grossIncome=2000000000');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('税前年收入不能超过 €1,000,000,000');
  });

  it('400: missing grossIncome', async () => {
    const res = await request('/api/public/compare?taxYear=2025');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('请输入税前年收入');
  });

  it('400: invalid taxYear / incomeType / filingStatus', async () => {
    for (const qs of [
      'grossIncome=60000&taxYear=2024',
      'grossIncome=60000&incomeType=lottery',
      'grossIncome=60000&filingStatus=married',
    ]) {
      const res = await request(`/api/public/compare?${qs}`);
      expect(res.status).toBe(400);
    }
  });

  it('405: POST rejected with Chinese message', async () => {
    const res = await request('/api/public/compare?grossIncome=60000', { method: 'POST' });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('该端点仅支持 GET');
  });

  it('429: 11th request from same IP in a minute is blocked', async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await request('/api/public/compare?grossIncome=60000');
      expect(ok.status).toBe(200);
    }
    const blocked = await request('/api/public/compare?grossIncome=60000');
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toBe('rate_limited');
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('503: D1 failure → fail-closed rate_limit_unavailable', async () => {
    // Redefine createDb mock to throw for this test.
    const dbModule = await import('../db');
    const createDb = dbModule.createDb as any;
    const original = createDb.getMockImplementation();
    createDb.mockImplementation(() => {
      throw new Error('simulated D1 failure');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request('/api/public/compare?grossIncome=60000');
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('rate_limit_unavailable');
    } finally {
      createDb.mockImplementation(original);
      errorSpy.mockRestore();
    }
  });
});

describe('runPublicCompare helpers', () => {
  it('comparePage returns 200 object for empty query', () => {
    const page = comparePage(new URLSearchParams());
    expect(page.status).toBe(200);
    expect(page.html).toContain('五国税后收入对比计算器');
  });
});
