/**
 * StrategiesPage tests — mock fetch for the strategies API client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StrategiesPage from './StrategiesPage';
import { evaluateStrategies, fetchStrategies } from './strategies/api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StrategiesPage component', () => {
  it('exports a default Solid component', () => {
    expect(typeof StrategiesPage).toBe('function');
  });
});

describe('fetchStrategies', () => {
  it('GETs /api/strategies with credentials and X-Requested-With', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        count: 1,
        items: [
          {
            id: 'de.werbungskosten',
            tier: 'A',
            category: 'deduction',
            titleZh: '德国工作支出扣除',
            descriptionZh: 'Test',
            eligibility: '员工',
            citation: 'EStG',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetchStrategies('DE', 2025);

    expect(fetchMock).toHaveBeenCalledWith('/api/strategies?country=DE&taxYear=2025', {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('de.werbungskosten');
  });

  it('throws UNAUTHORIZED on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })));
    await expect(fetchStrategies()).rejects.toThrow('UNAUTHORIZED');
  });
});

describe('evaluateStrategies', () => {
  const input = {
    country: 'DE' as const,
    taxYear: 2025,
    incomeType: 'salary' as const,
    grossIncome: 60000,
    specialStatus: 'none' as const,
    filingStatus: 'single' as const,
  };

  it('POSTs CalculatorInput and returns baseline + evaluations', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        baseline: {
          country: 'DE',
          taxYear: 2025,
          grossIncome: 60000,
          taxOwed: 12000,
          effectiveRate: 0.2,
          marginalRate: 0.42,
        },
        evaluations: [
          {
            id: 'de.werbungskosten',
            tier: 'A',
            category: 'deduction',
            titleZh: '德国工作支出扣除',
            citation: 'EStG',
            applicable: true,
            reason: '可抵扣部分工作支出',
            confidence: 0.9,
            estimatedSavingsEur: 500,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await evaluateStrategies(input);

    expect(fetchMock).toHaveBeenCalledWith('/api/strategies/evaluate', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(input),
    });
    expect(result.baseline.taxOwed).toBe(12000);
    expect(result.evaluations).toHaveLength(1);
  });

  it('throws RATE_LIMITED on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 })));
    await expect(evaluateStrategies(input)).rejects.toThrow('RATE_LIMITED');
  });
});
