/**
 * F4 — adversarial regression tests for the LLM Harness.
 *
 * Each test simulates a known LLM failure mode and asserts that the H1-H6
 * harness correctly rejects, overrides, or downgrades the output. These
 * tests guard against hallucination regressions in future model updates.
 *
 * Test matrix:
 *   1. Forbidden regime hallucination     → H1 blocks via FORBIDDEN_STRATEGY_IDS
 *   2. UK remittance basis hallucination  → H1 blocks (regime abolished 2025)
 *   3. Fabricated tax rate (50% off)      → H5 overrides with calculator value
 *   4. Unstructured (non-JSON) output     → H2 rejects with schema warning
 *
 * All mocked — no real DeepSeek calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../api/index';
import type { CalculatorInput } from '../rules/common/types';
import type { BaselineTax, Strategy, StrategyEvaluation } from '../strategies/types';
import type { DeepSeekResponse, DeepSeekUsage } from './deepseek';
import { recommendStrategies } from './f4-llm';

const MOCK_ENV = {
  DEEPSEEK_API_KEY: 'sk-test',
} as unknown as Bindings;

const SAMPLE_INPUT: CalculatorInput = {
  country: 'ES',
  taxYear: 2025,
  incomeType: 'salary',
  grossIncome: 100_000,
  specialStatus: 'none',
  filingStatus: 'single',
  region: 'MAD',
};

const SAMPLE_BASELINE: BaselineTax = {
  country: 'ES',
  taxYear: 2025,
  grossIncome: 100_000,
  taxOwed: 44_500,
  netIncome: 55_500,
  effectiveRate: 0.445,
  marginalRate: 0.47,
};

function makeFreshStrategy(id: string, daysAgo = 30): Strategy {
  const d = new Date(Date.now() - daysAgo * 86400_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return {
    id,
    tier: 'A',
    category: 'special_status',
    titleZh: `Test ${id}`,
    descriptionZh: 'Test only',
    eligibility: { countries: ['ES'], taxYears: [2025] },
    citation: {
      source: 'Test Statute',
      url: 'https://example.com/statute',
      lastVerified: `${y}-${m}-${day}`,
    },
    evaluate: () =>
      ({
        applicable: true,
        reason: 'test',
        estimatedSavingsEur: 5000,
        confidence: 1,
      }) as StrategyEvaluation,
  };
}

function makeMockChatResponse(content: string, usage?: DeepSeekUsage): DeepSeekResponse {
  return {
    id: 'test-id',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'deepseek-v4-flash',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: usage ?? { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

function asFetchResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const H6_PASS_RESPONSE = {
  id: 'selfcheck-id',
  object: 'chat.completion',
  created: 1_700_000_000,
  model: 'deepseek-v4-flash',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: JSON.stringify({ issues: [], overall_verdict: 'pass' }),
      },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
};

describe('F4 LLM Harness — adversarial regression', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let origFetch: typeof fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    origFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    (globalThis as { fetch: typeof fetch }).fetch = origFetch;
  });

  it('adversarial #1: rejects pt.nhr hallucination via H1 forbidden-id blocklist', async () => {
    // LLM hallucinates the abolished Portugal NHR regime
    const mockResp = makeMockChatResponse(
      JSON.stringify({
        recommendations: [
          {
            strategy_id: 'pt.nhr',
            tier: 'C',
            eligible: true,
            reasoning:
              'Portugal NHR provides 10-year non-habitual resident benefits with reduced rates.',
            estimated_savings_eur: 20000,
            confidence: 0.65,
            action_steps: ['Apply for NHR status'],
            citations: [{ law_reference: 'DL 249/2009 (NHR)', url: 'https://example.com' }],
          },
        ],
        ai_disclaimer: 'AI-generated.',
      }),
    );

    fetchMock
      .mockResolvedValueOnce(asFetchResponse(mockResp))
      .mockResolvedValue(asFetchResponse(H6_PASS_RESPONSE));

    const result = await recommendStrategies({
      env: MOCK_ENV,
      input: SAMPLE_INPUT,
      baseline: SAMPLE_BASELINE,
      existingStrategies: [makeFreshStrategy('es.beckham', 30)],
    });

    // H1 must drop the forbidden id; no recommendation should leak through.
    expect(result.llmRecommendations.find((r) => r.id === 'pt.nhr')).toBeUndefined();
    expect(
      result.warnings.some((w) => w.toLowerCase().includes('forbidden') || w.includes('pt.nhr')),
    ).toBe(true);
  });

  it('adversarial #2: rejects uk.remittance_basis hallucination (regime abolished Apr 2025)', async () => {
    const mockResp = makeMockChatResponse(
      JSON.stringify({
        recommendations: [
          {
            strategy_id: 'uk.remittance_basis',
            tier: 'C',
            eligible: true,
            reasoning:
              'UK remittance basis allows non-doms to exclude foreign income unless remitted.',
            estimated_savings_eur: 50000,
            confidence: 0.7,
            action_steps: ['Claim remittance basis on SA tax return'],
            citations: [
              {
                law_reference: 'ITA 2007 s.809B',
                url: 'https://example.com',
              },
            ],
          },
        ],
        ai_disclaimer: 'AI-generated.',
      }),
    );

    fetchMock
      .mockResolvedValueOnce(asFetchResponse(mockResp))
      .mockResolvedValue(asFetchResponse(H6_PASS_RESPONSE));

    const result = await recommendStrategies({
      env: MOCK_ENV,
      input: SAMPLE_INPUT,
      baseline: SAMPLE_BASELINE,
      existingStrategies: [makeFreshStrategy('es.beckham', 30)],
    });

    expect(result.llmRecommendations.find((r) => r.id === 'uk.remittance_basis')).toBeUndefined();
    expect(
      result.warnings.some(
        (w) => w.includes('uk.remittance_basis') || w.toLowerCase().includes('forbidden'),
      ),
    ).toBe(true);
  });

  it('adversarial #3: H5 overrides fabricated tax-savings number that deviates > 5%', async () => {
    // LLM fabricates a 100k EUR savings for Beckham; calculator says ~10k.
    const mockResp = makeMockChatResponse(
      JSON.stringify({
        recommendations: [
          {
            strategy_id: 'es.beckham',
            tier: 'C',
            eligible: true,
            reasoning: 'Beckham regime flat 24% on Spanish-source income up to 600k EUR threshold.',
            estimated_savings_eur: 100_000, // grossly inflated
            confidence: 0.65,
            action_steps: ['Apply for Beckham regime'],
            citations: [{ law_reference: 'Ley 35/2006 art. 93', url: 'https://example.com' }],
          },
        ],
        ai_disclaimer: 'AI-generated.',
      }),
    );

    fetchMock
      .mockResolvedValueOnce(asFetchResponse(mockResp))
      .mockResolvedValue(asFetchResponse(H6_PASS_RESPONSE));

    const result = await recommendStrategies({
      env: MOCK_ENV,
      input: SAMPLE_INPUT,
      baseline: SAMPLE_BASELINE,
      existingStrategies: [makeFreshStrategy('es.beckham', 30)],
    });

    // H5 must have produced an OVERRIDE warning naming the strategy.
    expect(result.warnings.some((w) => w.includes('H5 OVERRIDE') && w.includes('es.beckham'))).toBe(
      true,
    );
    // And if the recommendation is still surfaced, its savings number must NOT
    // be the inflated 100k value.
    const beckham = result.llmRecommendations.find((r) => r.id === 'es.beckham');
    if (beckham) {
      expect(beckham.estimatedSavingsEur ?? 0).toBeLessThan(100_000);
    }
  });

  it('adversarial #4: H2 rejects non-JSON unstructured prose output', async () => {
    const mockResp = makeMockChatResponse(
      'I think the best strategy for you would be to consider various options including ' +
        'investing in real estate or contributing to a pension fund. There are many ' +
        'opportunities available depending on your specific situation.',
    );

    fetchMock
      .mockResolvedValueOnce(asFetchResponse(mockResp))
      .mockResolvedValue(asFetchResponse(H6_PASS_RESPONSE));

    const result = await recommendStrategies({
      env: MOCK_ENV,
      input: SAMPLE_INPUT,
      baseline: SAMPLE_BASELINE,
      existingStrategies: [makeFreshStrategy('es.beckham', 30)],
    });

    expect(result.llmRecommendations).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('H2'))).toBe(true);
  });
});
