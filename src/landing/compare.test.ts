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
    // Default language is English (matches the landing-page strategy).
    expect(body).toContain('<html lang="en">');
    expect(body).toContain('<title>Five-Country Take-Home Pay Calculator');
    expect(body).toContain('id="cmp-form"');
    expect(body).toContain('method="get"');
    expect(body).toContain('name="grossIncome"');
    expect(body).toContain('href="/app"');
    expect(body).toContain('href="/app#strategies"');
    expect(body).toContain('Sign up free - draft my tax filings');
    expect(body).toContain('See all tax-saving strategies');
    expect(body).toContain('do not constitute tax advice');
  });

  it('200: server-renders results for valid query (no-JS path)', async () => {
    const res = await request('/compare?grossIncome=60000&taxYear=2025');
    expect(res.status).toBe(200);
    const body = await res.text();
    // Default language is English.
    expect(body).toContain('<title>Five-Country Take-Home Pay Calculator');
    expect(body).toContain('cmp-top');
    expect(body).toContain('Highest net');
    // All five country names present (English).
    expect(body).toContain('Germany');
    expect(body).toContain('Netherlands');
    expect(body).toContain('Portugal');
    expect(body).toContain('Spain');
    expect(body).toContain('United Kingdom');
    // European-style formatted net income (€ prefix + thousands separator).
    expect(body).toMatch(/€[0-9,]+/);
  });

  it('400: invalid query renders error banner with danger palette', async () => {
    const res = await request('/compare?grossIncome=-5');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('#fef2f2');
    expect(body).toContain('#991b1b');
    expect(body).toContain('Annual gross income must be greater than 0');
  });
});

describe('GET /compare?lang=en (English mode, t4)', () => {
  beforeEach(() => {
    // The rate-limit mock store is module-level; reset it so requests in
    // this block start with a fresh per-IP bucket (same trick as the
    // /api/public/compare describe above).
    mockStore = new Map();
    vi.clearAllMocks();
  });

  it('200: renders the full English calculator page without other query', async () => {
    const res = await request('/compare?lang=en');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    // Document language + SEO title switch to English.
    expect(body).toContain('<html lang="en">');
    expect(body).toContain('<title>Five-Country Take-Home Pay Calculator');
    // Form labels / submit / hint all English.
    expect(body).toContain('Annual gross income (€)');
    expect(body).toContain('Tax year');
    expect(body).toContain('Income type');
    expect(body).toContain('Filing status');
    expect(body).toContain('Compare five countries now');
    // Hidden lang input keeps ?lang=en alive across no-JS GET submits.
    expect(body).toContain('<input type="hidden" name="lang" value="en">');
    // CTA links unchanged in href, English in copy.
    expect(body).toContain('href="/app"');
    expect(body).toContain('href="/app#strategies"');
    expect(body).toContain('Sign up free - draft my tax filings');
    expect(body).toContain('See all tax-saving strategies');
    // English disclaimer.
    expect(body).toContain('do not constitute tax advice');
  });

  it('200: server-renders the English results table for a valid query', async () => {
    const res = await request('/compare?grossIncome=60000&taxYear=2025&lang=en');
    expect(res.status).toBe(200);
    const body = await res.text();
    // English table headers + badge + country names.
    expect(body).toContain('Highest net');
    expect(body).toContain('>Country</th>');
    expect(body).toContain('>Net income</th>');
    expect(body).toContain('>Tax</th>');
    expect(body).toContain('>Effective rate</th>');
    expect(body).toContain('Germany');
    expect(body).toContain('Netherlands');
    expect(body).toContain('Portugal');
    expect(body).toContain('Spain');
    expect(body).toContain('United Kingdom');
    // zh-only compare.ts strings must not leak into the EN page.
    expect(body).not.toContain('德国');
    expect(body).not.toContain('到手最高');
    expect(body).not.toContain('到手净收入');
  });

  it('400: invalid query renders the English error banner', async () => {
    const res = await request('/compare?grossIncome=-5&lang=en');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Annual gross income must be greater than 0');
  });

  it('API error message stays Chinese even with lang=en (API layer untouched)', async () => {
    const res = await request('/api/public/compare?grossIncome=-1&lang=en');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('税前年收入必须大于 0');
  });

  it('API 200 with lang=en returns English countryName + English countryNameEn pair', async () => {
    const res = await request('/api/public/compare?grossIncome=60000&taxYear=2025&lang=en');
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      results: Array<{ country: string; countryName: string; countryNameEn: string }>;
    };
    expect(data.results).toHaveLength(5);
    for (const row of data.results) {
      // API countryName follows the lang param; countryNameEn rides along
      // for consumers that need both display names.
      expect(row.countryName).toMatch(/Germany|Netherlands|Portugal|Spain|United Kingdom/);
      expect(row.countryNameEn.length).toBeGreaterThan(0);
      expect(row.countryNameEn).toMatch(/^[A-Za-z ]+$/);
    }
  });

  it('?lang=zh keeps Chinese; an invalid lang value falls back to English', async () => {
    const zh = await request('/compare?lang=zh');
    const zhBody = await zh.text();
    expect(zhBody).toContain('<html lang="zh-CN">');
    expect(zhBody).toContain('立即对比五国到手');
    const bogus = await request('/compare?lang=fr');
    const bogusBody = await bogus.text();
    expect(bogusBody).toContain('<html lang="en">');
    expect(bogusBody).toContain('<title>Five-Country Take-Home Pay Calculator');
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
