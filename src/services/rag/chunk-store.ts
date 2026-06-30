import type { KVNamespace } from '@cloudflare/workers-types';
import type { TaxLawEmbeddedChunk } from './types';

const KEY_PREFIX = 'rag:chunk:';
export const KV_CHUNK_CONCURRENCY = 8;

export function chunkKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index;
      index += 1;
      await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
}

export async function putChunks(
  kv: KVNamespace,
  chunks: readonly TaxLawEmbeddedChunk[],
): Promise<{ written: number }> {
  await runWithConcurrency(chunks, KV_CHUNK_CONCURRENCY, async (chunk) => {
    await kv.put(chunkKey(chunk.id), chunk.text);
  });

  return { written: chunks.length };
}

export async function getChunkTexts(
  kv: KVNamespace,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  await runWithConcurrency(ids, KV_CHUNK_CONCURRENCY, async (id) => {
    const text = await kv.get(chunkKey(id));
    if (text !== null) {
      texts.set(id, text);
    }
  });
  return texts;
}

export async function deleteChunks(
  kv: KVNamespace,
  ids: readonly string[],
): Promise<{ deleted: number }> {
  let deleted = 0;
  await runWithConcurrency(ids, KV_CHUNK_CONCURRENCY, async (id) => {
    await kv.delete(chunkKey(id));
    deleted += 1;
  });
  return { deleted };
}
