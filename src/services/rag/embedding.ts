import type { Ai } from '@cloudflare/workers-types';
import { z } from 'zod';
import { type Vectorize1024, Vectorize1024Schema } from './types';

export const BGE_M3_MODEL = '@cf/baai/bge-m3' as const;
export const DEFAULT_BATCH_SIZE = 8;
export const DEFAULT_MAX_RETRIES = 2;

export class EmbeddingError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'EmbeddingError';
    this.cause = cause;
  }
}

export class EmbeddingValidationError extends EmbeddingError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'EmbeddingValidationError';
  }
}

export interface EmbeddingClient {
  embedTexts(texts: readonly string[]): Promise<Vectorize1024[]>;
  embedQuery(text: string): Promise<Vectorize1024>;
}

interface EmbeddingClientOptions {
  batchSize?: number;
  maxRetries?: number;
  model?: string;
}

const EmbeddingResponseSchema = z.object({
  data: z.array(Vectorize1024Schema),
});

export function createEmbeddingClient(ai: Ai, opts: EmbeddingClientOptions = {}): EmbeddingClient {
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
  const maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
  const model = opts.model ?? BGE_M3_MODEL;

  async function runWithRetry(textBatch: string[]): Promise<Vectorize1024[]> {
    let lastError: unknown;
    const delays = [200, 800];

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const raw = await ai.run(model, { text: textBatch });
        const parsed = EmbeddingResponseSchema.safeParse(raw);
        if (!parsed.success) {
          throw new EmbeddingValidationError(
            `Embedding response validation failed: ${parsed.error.message}`,
            parsed.error,
          );
        }
        if (parsed.data.data.length !== textBatch.length) {
          throw new EmbeddingValidationError(
            `Embedding response length mismatch: expected ${textBatch.length}, got ${parsed.data.data.length}`,
          );
        }
        return parsed.data.data;
      } catch (e) {
        lastError = e;
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt] ?? 1000));
        }
      }
    }

    throw lastError instanceof EmbeddingError
      ? lastError
      : new EmbeddingError(`Embedding failed after ${maxRetries + 1} attempts`, lastError);
  }

  return {
    async embedTexts(texts: readonly string[]): Promise<Vectorize1024[]> {
      if (texts.length === 0) return [];

      const trimmed = texts.map((t) => t.trim());
      for (const text of trimmed) {
        if (text.length === 0) {
          throw new EmbeddingError('Empty or whitespace-only texts are not allowed');
        }
      }

      const results: Vectorize1024[] = [];
      for (let i = 0; i < trimmed.length; i += batchSize) {
        const batch = trimmed.slice(i, i + batchSize);
        const vectors = await runWithRetry(batch);
        results.push(...vectors);
      }
      return results;
    },

    async embedQuery(text: string): Promise<Vectorize1024> {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        throw new EmbeddingError('Query text must be non-empty');
      }
      const vectors = await runWithRetry([trimmed]);
      return vectors[0];
    },
  };
}
