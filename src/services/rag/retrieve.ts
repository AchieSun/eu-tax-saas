import type { Ai, KVNamespace, VectorizeIndex } from '@cloudflare/workers-types';
import { getChunkTexts } from './chunk-store';
import { createEmbeddingClient } from './embedding';
import type { TaxLawRegimeStatus, VectorizeChunkMetadata } from './types';
import { queryTopK } from './vectorize-store';

export const MIN_RELEVANCE_SCORE = 0.35;
export const DEFAULT_TOP_K = 5;
export const CURRENT_TAX_YEAR = 2025;

export interface RetrievalResult {
  id: string;
  score: number;
  text: string;
  metadata: VectorizeChunkMetadata;
}

export interface RetrievalSummary {
  results: RetrievalResult[];
  taxYear: number;
  deprecatedExcluded: boolean;
  transitionalPresent: boolean;
  blacklistHit: boolean;
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

const DEPRECATED_KEYWORDS = ['nhr', 'non-dom', 'non dom', '30% ruling'];

function normalizeRegimeStatus(status: TaxLawRegimeStatus | undefined): TaxLawRegimeStatus {
  return status ?? 'active';
}

function queryHitsBlacklist(query: string): boolean {
  const lower = query.toLowerCase();
  return DEPRECATED_KEYWORDS.some((kw) => lower.includes(kw));
}

export function createRetrievalService(env: {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  KV: KVNamespace;
}): {
  retrieve(input: RetrievalInput): Promise<RetrievalSummary>;
} {
  const embedder = createEmbeddingClient(env.AI);
  const deps: RetrievalDeps = {
    embedder,
    index: env.VECTORIZE,
    kv: env.KV,
  };

  return {
    async retrieve(input: RetrievalInput): Promise<RetrievalSummary> {
      const taxYear = input.taxYear ?? CURRENT_TAX_YEAR;
      const blacklistHit = queryHitsBlacklist(input.query);
      const vector = await embedder.embedQuery(input.query);
      const filter: Partial<Pick<VectorizeChunkMetadata, 'jurisdiction' | 'taxYear' | 'topic'>> =
        {
          taxYear,
        };
      if (input.jurisdiction) filter.jurisdiction = input.jurisdiction;
      if (input.topic) filter.topic = input.topic;

      // Fetch extra candidates so regime filtering does not leave us with too few results.
      const fetchK = (input.topK ?? DEFAULT_TOP_K) * 2;
      const matches = await queryTopK(deps.index, vector, fetchK, filter);

      const relevant = matches.filter((match) => match.score >= MIN_RELEVANCE_SCORE);
      const texts = await getChunkTexts(
        deps.kv,
        relevant.map((match) => match.id),
      );

      let deprecatedExcluded = false;
      let transitionalPresent = false;
      const results: RetrievalResult[] = [];
      for (const match of relevant) {
        const text = texts.get(match.id);
        if (text === undefined) continue;
        const status = normalizeRegimeStatus(match.metadata.regimeStatus);
        if (status === 'deprecated') {
          deprecatedExcluded = true;
          continue;
        }
        if (status === 'transitional') {
          transitionalPresent = true;
        }
        results.push({
          id: match.id,
          score: match.score,
          text,
          metadata: match.metadata,
        });
      }

      return {
        results: results.slice(0, input.topK ?? DEFAULT_TOP_K).sort((a, b) => b.score - a.score),
        taxYear,
        deprecatedExcluded,
        transitionalPresent,
        blacklistHit,
      };
    },
  };
}
