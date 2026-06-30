import type { Ai, KVNamespace, VectorizeIndex } from '@cloudflare/workers-types';
import { getChunkTexts } from './chunk-store';
import { createEmbeddingClient } from './embedding';
import type { VectorizeChunkMetadata } from './types';
import { queryTopK } from './vectorize-store';

export const MIN_RELEVANCE_SCORE = 0.35;
export const DEFAULT_TOP_K = 4;

export interface RetrievalResult {
  id: string;
  score: number;
  text: string;
  metadata: VectorizeChunkMetadata;
}

export interface RetrievalInput {
  query: string;
  jurisdiction?: VectorizeChunkMetadata['jurisdiction'];
  taxYear?: number;
  topic?: string;
  topK?: number;
}

export interface RetrievalDeps {
  embedder: ReturnType<typeof createEmbeddingClient>;
  index: VectorizeIndex;
  kv: KVNamespace;
}

export function createRetrievalService(env: {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  KV: KVNamespace;
}): {
  retrieve(input: RetrievalInput): Promise<RetrievalResult[]>;
} {
  const embedder = createEmbeddingClient(env.AI);
  const deps: RetrievalDeps = {
    embedder,
    index: env.VECTORIZE,
    kv: env.KV,
  };

  return {
    async retrieve(input: RetrievalInput): Promise<RetrievalResult[]> {
      const vector = await embedder.embedQuery(input.query);
      const filter: Partial<Pick<VectorizeChunkMetadata, 'jurisdiction' | 'taxYear' | 'topic'>> =
        {};
      if (input.jurisdiction) filter.jurisdiction = input.jurisdiction;
      if (input.taxYear) filter.taxYear = input.taxYear;
      if (input.topic) filter.topic = input.topic;

      const matches = await queryTopK(
        deps.index,
        vector,
        input.topK ?? DEFAULT_TOP_K,
        Object.keys(filter).length > 0 ? filter : undefined,
      );

      const relevant = matches.filter((match) => match.score >= MIN_RELEVANCE_SCORE);
      const texts = await getChunkTexts(
        deps.kv,
        relevant.map((match) => match.id),
      );

      const results: RetrievalResult[] = [];
      for (const match of relevant) {
        const text = texts.get(match.id);
        if (text === undefined) continue;
        results.push({
          id: match.id,
          score: match.score,
          text,
          metadata: match.metadata,
        });
      }

      return results.sort((a, b) => b.score - a.score);
    },
  };
}
