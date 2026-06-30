import { describe, expect, it, vi } from 'vitest';
import {
  KV_CHUNK_CONCURRENCY,
  chunkKey,
  deleteChunks,
  getChunkTexts,
  putChunks,
} from './chunk-store';
import type { TaxLawEmbeddedChunk } from './types';

function makeVector(): number[] {
  return Array.from({ length: 1024 }, (_, i) => i / 1024);
}

function makeChunk(idSeed: number, text: string): TaxLawEmbeddedChunk {
  const id = idSeed.toString(16).padStart(64, '0');
  return {
    id,
    jurisdiction: 'ES',
    sourceUrl: 'https://boe.es/example',
    sourceTitle: 'Example',
    authority: 'BOE',
    taxYear: 2025,
    topic: 'irpf',
    lang: 'es',
    chunkIndex: idSeed,
    charCount: text.length,
    text,
    contentHash: 'b'.repeat(64),
    fetchedAt: new Date().toISOString(),
    vector: makeVector() as unknown as TaxLawEmbeddedChunk['vector'],
  };
}

function makeFakeKV(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const kv = {
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  return { kv, store };
}

describe('chunkKey', () => {
  it('prefixes the id with rag:chunk:', () => {
    expect(chunkKey('abc')).toBe('rag:chunk:abc');
  });
});

describe('putChunks', () => {
  it('writes each chunk text to KV', async () => {
    const { kv, store } = makeFakeKV();
    const chunks = [makeChunk(1, 'first'), makeChunk(2, 'second')];
    const result = await putChunks(kv as unknown as Parameters<typeof putChunks>[0], chunks);
    expect(result.written).toBe(2);
    expect(store.get(chunkKey(chunks[0].id))).toBe('first');
    expect(store.get(chunkKey(chunks[1].id))).toBe('second');
  });

  it('is idempotent for the same chunk', async () => {
    const { kv, store } = makeFakeKV();
    const chunks = [makeChunk(1, 'first')];
    await putChunks(kv as unknown as Parameters<typeof putChunks>[0], chunks);
    await putChunks(kv as unknown as Parameters<typeof putChunks>[0], chunks);
    expect(store.get(chunkKey(chunks[0].id))).toBe('first');
  });

  it('limits put concurrency', async () => {
    const { kv } = makeFakeKV();
    const chunks = Array.from({ length: KV_CHUNK_CONCURRENCY * 2 }, (_, i) =>
      makeChunk(i, `chunk-${i}`),
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const kvWithTracker = {
      ...kv,
      put: vi.fn(async (key: string, value: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await kv.put(key, value);
        inFlight -= 1;
      }),
    };
    await putChunks(kvWithTracker as unknown as Parameters<typeof putChunks>[0], chunks);
    expect(maxInFlight).toBeLessThanOrEqual(KV_CHUNK_CONCURRENCY);
  });
});

describe('getChunkTexts', () => {
  it('returns a map of existing chunk texts', async () => {
    const chunk = makeChunk(1, 'hello');
    const { kv } = makeFakeKV({ [chunkKey(chunk.id)]: chunk.text });
    const map = await getChunkTexts(kv as unknown as Parameters<typeof getChunkTexts>[0], [
      chunk.id,
    ]);
    expect(map.get(chunk.id)).toBe('hello');
  });

  it('omits missing chunks from the map', async () => {
    const { kv } = makeFakeKV();
    const map = await getChunkTexts(kv as unknown as Parameters<typeof getChunkTexts>[0], [
      'missing',
    ]);
    expect(map.has('missing')).toBe(false);
    expect(map.size).toBe(0);
  });
});

describe('deleteChunks', () => {
  it('removes stored chunk texts', async () => {
    const chunk = makeChunk(1, 'hello');
    const { kv, store } = makeFakeKV({ [chunkKey(chunk.id)]: chunk.text });
    const result = await deleteChunks(kv as unknown as Parameters<typeof deleteChunks>[0], [
      chunk.id,
    ]);
    expect(result.deleted).toBe(1);
    expect(store.has(chunkKey(chunk.id))).toBe(false);
  });

  it('is safe when keys are missing', async () => {
    const { kv } = makeFakeKV();
    const result = await deleteChunks(kv as unknown as Parameters<typeof deleteChunks>[0], [
      'missing',
    ]);
    expect(result.deleted).toBe(1);
  });
});
