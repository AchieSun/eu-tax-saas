/**
 * StrategiesPage tests — mock fetch for the strategies API client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StrategiesPage from './StrategiesPage';
import {
  SubscriptionRequiredError,
  aiRecommendStrategies,
  evaluateStrategies,
  fetchStrategies,
} from './strategies/api';

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

describe('aiRecommendStrategies (F4 paywall client)', () => {
  const input = {
    country: 'DE' as const,
    taxYear: 2025,
    incomeType: 'salary' as const,
    grossIncome: 60000,
    specialStatus: 'none' as const,
    filingStatus: 'single' as const,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /api/strategies/ai-recommend and returns the report', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        baseline: { country: 'DE', taxYear: 2025, taxOwed: 12000 },
        recommendations: [
          {
            id: 'eu.holding',
            tier: 'C',
            titleZh: '[AI建议·未经确定性验证] eu.holding',
            reasoning: '...',
            confidence: 0.6,
            estimatedSavingsEur: null,
            actionSteps: ['step1'],
            citations: ['c1'],
            aiDisclaimer: '[AI建议·未经确定性验证]',
          },
        ],
        warnings: [],
        usage: { promptTokens: 100, completionTokens: 50, cost: 0.001 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await aiRecommendStrategies(input);

    expect(fetchMock).toHaveBeenCalledWith('/api/strategies/ai-recommend', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(input),
    });
    expect(result.recommendations).toHaveLength(1);
    expect(result.usage.cost).toBe(0.001);
  });

  it('throws SubscriptionRequiredError with feature slug on 402', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error: 'subscription_required',
            feature: 'ai-strategy-report',
            subscriptionStatus: 'free',
          }),
          { status: 402 },
        ),
      ),
    );
    const err = await aiRecommendStrategies(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SubscriptionRequiredError);
    expect((err as SubscriptionRequiredError).feature).toBe('ai-strategy-report');
    expect((err as SubscriptionRequiredError).subscriptionStatus).toBe('free');
  });

  it('throws RATE_LIMITED on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 })));
    await expect(aiRecommendStrategies(input)).rejects.toThrow('RATE_LIMITED');
  });
});
