import { describe, expect, it, vi } from 'vitest';
import {
  BGE_M3_MODEL,
  EmbeddingError,
  EmbeddingValidationError,
  createEmbeddingClient,
} from './embedding';
import type { Vectorize1024 } from './types';

function makeVector(seed = 0): Vectorize1024 {
  return Array.from({ length: 1024 }, (_, i) => (i + seed) / 1024) as Vectorize1024;
}

function makeFakeAi(
  opts: {
    responses?: Vectorize1024[][];
    failures?: number;
    invalidResponse?: unknown;
  } = {},
): {
  ai: { run: ReturnType<typeof vi.fn> };
  calls: { model: string; text: string[] }[];
} {
  const calls: { model: string; text: string[] }[] = [];
  let callCount = 0;
  const ai = {
    run: vi.fn(async (model: string, input: { text: string[] }) => {
      calls.push({ model, text: input.text });
      callCount += 1;
      if (opts.invalidResponse !== undefined && callCount === 1) {
        return opts.invalidResponse;
      }
      if (opts.failures && callCount <= opts.failures) {
        throw new Error('network error');
      }
      const responseBatch = opts.responses?.[calls.length - 1];
      if (!responseBatch) {
        return { data: input.text.map(() => makeVector(callCount)) };
      }
      return { data: responseBatch };
    }),
  };
  return { ai, calls };
}

describe('createEmbeddingClient', () => {
  it('embeds a single text', async () => {
    const { ai, calls } = makeFakeAi({ responses: [[makeVector(1)]] });
    const client = createEmbeddingClient(
      ai as unknown as Parameters<typeof createEmbeddingClient>[0],
    );
    const vector = await client.embedQuery('hello');
    expect(vector).toHaveLength(1024);
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(BGE_M3_MODEL);
    expect(calls[0].text).toEqual(['hello']);
  });

  it('embeds multiple texts in batches', async () => {
    const texts = Array.from({ length: 20 }, (_, i) => `text-${i}`);
    const responses: Vectorize1024[][] = [];
    for (let i = 0; i < 20; i += 8) {
      responses.push(texts.slice(i, i + 8).map((_, j) => makeVector(i + j)));
    }
    const { ai, calls } = makeFakeAi({ responses });
    const client = createEmbeddingClient(
      ai as unknown as Parameters<typeof createEmbeddingClient>[0],
      {
        batchSize: 8,
      },
    );
    const vectors = await client.embedTexts(texts);
    expect(vectors).toHaveLength(20);
    expect(calls).toHaveLength(3);
    expect(calls[0].text).toHaveLength(8);
    expect(calls[1].text).toHaveLength(8);
    expect(calls[2].text).toHaveLength(4);
  });

  it('returns an empty array for empty input without calling AI', async () => {
    const { ai, calls } = makeFakeAi();
    const client = createEmbeddingClient(
      ai as unknown as Parameters<typeof createEmbeddingClient>[0],
    );
    const vectors = await client.embedTexts([]);
    expect(vectors).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('throws on empty or whitespace-only texts', async () => {
    const { ai } = makeFakeAi();
    const client = createEmbeddingClient(
      ai as unknown as Parameters<typeof createEmbeddingClient>[0],
    );
    await expect(client.embedTexts(['hello', '   '])).rejects.toBeInstanceOf(EmbeddingError);
    await expect(client.embedQuery('   ')).rejects.toBeInstanceOf(EmbeddingError);
  });

  it('retries on transient failures and succeeds', async () => {
    const { ai, calls } = makeFakeAi({ failures: 1, responses: [[makeVector(1)]] });
    const client = createEmbeddingClient(
      ai as unknown as Parameters<typeof createEmbeddingClient>[0],
      {
        maxRetries: 2,
      },
    );
    const vector = await client.embedQuery('retry me');
    expect(vector).toHaveLength(1024);
    expect(calls).toHaveLength(2);
  });

  it('throws EmbeddingError after exhausting retries', async () => {
    const { ai } = makeFakeAi({ failures: 3 });
    const client = createEmbeddingClient(
      ai as unknown as Parameters<typeof createEmbeddingClient>[0],
      {
        maxRetries: 2,
      },
    );
    await expect(client.embedQuery('fail')).rejects.toBeInstanceOf(EmbeddingError);
  });

  it('throws EmbeddingValidationError when response length mismatches', async () => {
    const { ai } = makeFakeAi({ responses: [[makeVector(1)]] });
    const client = createEmbeddingClient(
      ai as unknown as Parameters<typeof createEmbeddingClient>[0],
      {
        maxRetries: 0,
      },
    );
    await expect(client.embedTexts(['a', 'b'])).rejects.toBeInstanceOf(EmbeddingValidationError);
  });

  it('throws EmbeddingValidationError on malformed response shape', async () => {
    const { ai } = makeFakeAi({ invalidResponse: { vectors: [] } });
    const client = createEmbeddingClient(
      ai as unknown as Parameters<typeof createEmbeddingClient>[0],
      {
        maxRetries: 0,
      },
    );
    await expect(client.embedQuery('x')).rejects.toBeInstanceOf(EmbeddingValidationError);
  });

  it('throws EmbeddingValidationError on non-finite vector values', async () => {
    const badVector = Array.from({ length: 1024 }, () => 0) as Vectorize1024;
    badVector[0] = Number.NaN;
    const { ai } = makeFakeAi({ responses: [[badVector]] });
    const client = createEmbeddingClient(
      ai as unknown as Parameters<typeof createEmbeddingClient>[0],
      {
        maxRetries: 0,
      },
    );
    await expect(client.embedQuery('x')).rejects.toBeInstanceOf(EmbeddingValidationError);
  });

  it('does not retry deterministic validation errors', async () => {
    const { ai, calls } = makeFakeAi({ responses: [[makeVector(1)]] });
    const client = createEmbeddingClient(
      ai as unknown as Parameters<typeof createEmbeddingClient>[0],
      {
        maxRetries: 2,
      },
    );
    await expect(client.embedTexts(['a', 'b'])).rejects.toBeInstanceOf(EmbeddingValidationError);
    expect(calls).toHaveLength(1);
  });
});
