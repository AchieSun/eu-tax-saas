import type { VectorizeIndex } from '@cloudflare/workers-types';
import { z } from 'zod';
import {
  type Vectorize1024,
  type VectorizeChunkMetadata,
  VectorizeChunkMetadataSchema,
  type VectorizeUpsertItem,
  VectorizeUpsertItemSchema,
} from './types';

export const UPSERT_BATCH = 64;

export interface MatchedChunk {
  id: string;
  score: number;
  metadata: VectorizeChunkMetadata;
}

const VectorizeQueryResponseSchema = z.object({
  matches: z.array(
    z.object({
      id: z.string(),
      score: z.number(),
      metadata: VectorizeChunkMetadataSchema,
    }),
  ),
});

export async function upsertChunks(
  index: VectorizeIndex,
  items: readonly VectorizeUpsertItem[],
): Promise<{ count: number }> {
  for (const item of items) {
    const parsed = VectorizeUpsertItemSchema.safeParse(item);
    if (!parsed.success) {
      throw new Error(`Invalid upsert item ${item.id}: ${parsed.error.message}`);
    }
  }

  let count = 0;
  for (let i = 0; i < items.length; i += UPSERT_BATCH) {
    const batch = items.slice(i, i + UPSERT_BATCH);
    await index.upsert(
      batch.map((item) => ({ id: item.id, values: item.values, metadata: item.metadata })),
    );
    count += batch.length;
  }

  return { count };
}

export async function queryTopK(
  index: VectorizeIndex,
  vector: Vectorize1024,
  k: number,
  filter?: Partial<Pick<VectorizeChunkMetadata, 'jurisdiction' | 'taxYear' | 'topic' | 'lang'>>,
): Promise<MatchedChunk[]> {
  if (k <= 0) return [];

  const raw = await index.query(vector, {
    topK: k,
    returnMetadata: 'all',
    filter,
  });

  const parsed = VectorizeQueryResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Vectorize query response validation failed: ${parsed.error.message}`);
  }

  return parsed.data.matches
    .sort((a, b) => b.score - a.score)
    .map((match) => ({
      id: match.id,
      score: match.score,
      metadata: match.metadata,
    }));
}
