import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_TAX_YEAR,
  DEFAULT_TOP_K,
  MIN_RELEVANCE_SCORE,
  createRetrievalService,
} from './retrieve';
import type { Vectorize1024 } from './types';

function makeVector(seed = 0): Vectorize1024 {
  return Array.from({ length: 1024 }, (_, i) => (i + seed) / 1024) as Vectorize1024;
}

function makeFakeEnv(
  opts: {
    matches?: {
      id: string;
      score: number;
      text: string;
      regimeStatus?: 'active' | 'transitional' | 'deprecated';
    }[];
  } = {},
) {
  const matches = opts.matches ?? [
    { id: 'a'.repeat(64), score: 0.92, text: 'first chunk' },
    { id: 'b'.repeat(64), score: 0.34, text: 'below threshold' },
    { id: 'c'.repeat(64), score: 0.71, text: 'second chunk' },
  ];

  const kv = new Map<string, string>();
  for (const match of matches) {
    kv.set(`rag:chunk:${match.id}`, match.text);
  }

  return {
    AI: {
      run: vi.fn(async (_model: string, input: { text: string[] }) => ({
        data: input.text.map(() => makeVector(0)),
      })),
    },
    VECTORIZE: {
      upsert: vi.fn(),
      query: vi.fn(async () => ({
        matches: matches.map((match) => ({
          id: match.id,
          score: match.score,
          metadata: {
            jurisdiction: 'ES',
            sourceUrl: 'https://boe.es/example',
            sourceTitle: 'Example',
            authority: 'BOE',
            taxYear: 2025,
            topic: 'irpf',
            regimeStatus: match.regimeStatus ?? 'active',
            lang: 'es',
            chunkIndex: 0,
            charCount: 10,
            contentHash: 'b'.repeat(64),
          },
        })),
      })),
    },
    KV: {
      put: vi.fn(),
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
    },
  };
}

describe('createRetrievalService', () => {
  it('retrieves and hydrates chunks above the relevance threshold', async () => {
    const env = makeFakeEnv();
    const service = createRetrievalService(
      env as unknown as Parameters<typeof createRetrievalService>[0],
    );
    const summary = await service.retrieve({ query: 'IRPF' });
    expect(summary.results).toHaveLength(2);
    expect(summary.results[0].score).toBeGreaterThanOrEqual(summary.results[1].score);
    expect(summary.results.every((r) => r.score >= MIN_RELEVANCE_SCORE)).toBe(true);
    expect(summary.taxYear).toBe(CURRENT_TAX_YEAR);
  });

  it('passes jurisdiction and taxYear filters to vectorize', async () => {
    const env = makeFakeEnv();
    const service = createRetrievalService(
      env as unknown as Parameters<typeof createRetrievalService>[0],
    );
    await service.retrieve({ query: 'IRPF', jurisdiction: 'ES', taxYear: 2025 });
    expect(env.VECTORIZE.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { jurisdiction: 'ES', taxYear: 2025 },
        topK: DEFAULT_TOP_K * 2,
      }),
    );
  });

  it('defaults taxYear to current tax year', async () => {
    const env = makeFakeEnv();
    const service = createRetrievalService(
      env as unknown as Parameters<typeof createRetrievalService>[0],
    );
    await service.retrieve({ query: 'IRPF' });
    expect(env.VECTORIZE.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { taxYear: CURRENT_TAX_YEAR },
      }),
    );
  });

  it('drops matches whose text is missing from KV', async () => {
    const env = makeFakeEnv({
      matches: [{ id: 'a'.repeat(64), score: 0.92, text: 'first chunk' }],
    });
    env.KV.get = vi.fn(async () => null);
    const service = createRetrievalService(
      env as unknown as Parameters<typeof createRetrievalService>[0],
    );
    const summary = await service.retrieve({ query: 'IRPF' });
    expect(summary.results).toHaveLength(0);
  });

  it('returns an empty summary when vectorize has no matches', async () => {
    const env = makeFakeEnv({ matches: [] });
    const service = createRetrievalService(
      env as unknown as Parameters<typeof createRetrievalService>[0],
    );
    const summary = await service.retrieve({ query: 'IRPF' });
    expect(summary.results).toEqual([]);
  });

  it('respects custom topK', async () => {
    const env = makeFakeEnv();
    const service = createRetrievalService(
      env as unknown as Parameters<typeof createRetrievalService>[0],
    );
    await service.retrieve({ query: 'IRPF', topK: 8 });
    expect(env.VECTORIZE.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ topK: 16 }),
    );
  });

  it('excludes deprecated regimes from results', async () => {
    const env = makeFakeEnv({
      matches: [
        { id: 'a'.repeat(64), score: 0.92, text: 'active chunk', regimeStatus: 'active' },
        { id: 'b'.repeat(64), score: 0.88, text: 'deprecated chunk', regimeStatus: 'deprecated' },
      ],
    });
    const service = createRetrievalService(
      env as unknown as Parameters<typeof createRetrievalService>[0],
    );
    const summary = await service.retrieve({ query: 'IRPF' });
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].text).toBe('active chunk');
    expect(summary.deprecatedExcluded).toBe(true);
  });

  it('flags transitional regimes and keeps them with warning', async () => {
    const env = makeFakeEnv({
      matches: [
        {
          id: 'a'.repeat(64),
          score: 0.92,
          text: 'transitional chunk',
          regimeStatus: 'transitional',
        },
      ],
    });
    const service = createRetrievalService(
      env as unknown as Parameters<typeof createRetrievalService>[0],
    );
    const summary = await service.retrieve({ query: 'IRPF' });
    expect(summary.results).toHaveLength(1);
    expect(summary.transitionalPresent).toBe(true);
  });

  it('flags blacklist queries about transitional/abolished regimes', async () => {
    const env = makeFakeEnv();
    const service = createRetrievalService(
      env as unknown as Parameters<typeof createRetrievalService>[0],
    );
    const summary = await service.retrieve({ query: 'How do I apply for NHR?' });
    expect(summary.blacklistHit).toBe(true);
  });

  it('exposes MIN_RELEVANCE_SCORE boundary', () => {
    expect(MIN_RELEVANCE_SCORE).toBe(0.35);
  });

  it('defaults DEFAULT_TOP_K to 5', () => {
    expect(DEFAULT_TOP_K).toBe(5);
  });
});
