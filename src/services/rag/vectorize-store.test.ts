import { describe, expect, it, vi } from 'vitest';
import type { Vectorize1024, VectorizeUpsertItem } from './types';
import { UPSERT_BATCH, queryTopK, upsertChunks } from './vectorize-store';

function makeVector(seed = 0): Vectorize1024 {
  return Array.from({ length: 1024 }, (_, i) => (i + seed) / 1024) as Vectorize1024;
}

function makeItem(idSeed: number): VectorizeUpsertItem {
  const id = idSeed.toString(16).padStart(64, '0');
  return {
    id,
    values: makeVector(idSeed),
    metadata: {
      jurisdiction: 'ES',
      sourceUrl: 'https://boe.es/example',
      sourceTitle: 'Example',
      authority: 'BOE',
      taxYear: 2025,
      topic: 'irpf',
      regimeStatus: 'active',
      lang: 'es',
      chunkIndex: idSeed,
      charCount: 100,
      contentHash: 'b'.repeat(64),
    },
  };
}

function makeFakeIndex() {
  const upserted: VectorizeUpsertItem[][] = [];
  const queries: { vector: Vectorize1024; k: number; filter?: unknown }[] = [];
  const index = {
    upsert: vi.fn(async (items: VectorizeUpsertItem[]) => {
      upserted.push(items);
    }),
    query: vi.fn(async (vector: Vectorize1024, options: { topK: number; filter?: unknown }) => {
      queries.push({ vector, k: options.topK, filter: options.filter });
      return {
        matches: [
          {
            id: 'match-1',
            score: 0.92,
            metadata: makeItem(1).metadata,
          },
          {
            id: 'match-2',
            score: 0.85,
            metadata: makeItem(2).metadata,
          },
        ],
      };
    }),
  };
  return { index, upserted, queries };
}

describe('upsertChunks', () => {
  it('upserts valid items in a single batch', async () => {
    const { index, upserted } = makeFakeIndex();
    const items = [makeItem(1), makeItem(2)];
    const result = await upsertChunks(
      index as unknown as Parameters<typeof upsertChunks>[0],
      items,
    );
    expect(result.count).toBe(2);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toHaveLength(2);
  });

  it('batches items at the UPSERT_BATCH boundary', async () => {
    const { index, upserted } = makeFakeIndex();
    const items = Array.from({ length: UPSERT_BATCH }, (_, i) => makeItem(i));
    const result = await upsertChunks(
      index as unknown as Parameters<typeof upsertChunks>[0],
      items,
    );
    expect(result.count).toBe(UPSERT_BATCH);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toHaveLength(UPSERT_BATCH);
  });

  it('splits items into multiple batches at boundary 64', async () => {
    const { index, upserted } = makeFakeIndex();
    const items = Array.from({ length: UPSERT_BATCH + 1 }, (_, i) => makeItem(i));
    const result = await upsertChunks(
      index as unknown as Parameters<typeof upsertChunks>[0],
      items,
    );
    expect(result.count).toBe(UPSERT_BATCH + 1);
    expect(upserted).toHaveLength(2);
    expect(upserted[0]).toHaveLength(UPSERT_BATCH);
    expect(upserted[1]).toHaveLength(1);
  });

  it('validates items before upserting', async () => {
    const { index } = makeFakeIndex();
    const invalidItem = { ...makeItem(1), id: 'short' };
    await expect(
      upsertChunks(index as unknown as Parameters<typeof upsertChunks>[0], [invalidItem]),
    ).rejects.toThrow('Invalid upsert item');
  });
});

describe('queryTopK', () => {
  it('queries the index and returns sorted matches', async () => {
    const { index, queries } = makeFakeIndex();
    const vector = makeVector(0);
    const matches = await queryTopK(index as unknown as Parameters<typeof queryTopK>[0], vector, 4);
    expect(queries).toHaveLength(1);
    expect(queries[0].k).toBe(4);
    expect(matches).toHaveLength(2);
    expect(matches[0].score).toBeGreaterThanOrEqual(matches[1].score);
  });

  it('forwards metadata filters', async () => {
    const { index, queries } = makeFakeIndex();
    const vector = makeVector(0);
    await queryTopK(index as unknown as Parameters<typeof queryTopK>[0], vector, 4, {
      jurisdiction: 'ES',
      taxYear: 2025,
    });
    expect(queries[0].filter).toEqual({ jurisdiction: 'ES', taxYear: 2025 });
  });

  it('returns an empty array when k <= 0', async () => {
    const { index } = makeFakeIndex();
    const matches = await queryTopK(
      index as unknown as Parameters<typeof queryTopK>[0],
      makeVector(0),
      0,
    );
    expect(matches).toEqual([]);
  });

  it('throws on malformed query response', async () => {
    const index = {
      query: vi.fn(async () => ({ matches: [{ id: 'bad', score: 'high' }] })),
      upsert: vi.fn(),
    };
    await expect(
      queryTopK(index as unknown as Parameters<typeof queryTopK>[0], makeVector(0), 4),
    ).rejects.toThrow('Vectorize query response validation failed');
  });
});
