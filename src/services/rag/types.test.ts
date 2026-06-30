import { describe, expect, it } from 'vitest';
import {
  TaxLawChunkSchema,
  TaxLawEmbeddedChunkSchema,
  Vectorize1024Schema,
  VectorizeChunkMetadataSchema,
  VectorizeUpsertItemSchema,
} from './types';

const baseChunk = {
  id: 'a'.repeat(64),
  jurisdiction: 'ES',
  sourceUrl: 'https://boe.es/example',
  sourceTitle: 'Example',
  authority: 'BOE',
  taxYear: 2025,
  topic: 'irpf',
  lang: 'es',
  chunkIndex: 0,
  charCount: 100,
  text: 'Some tax law text.',
  contentHash: 'b'.repeat(64),
  fetchedAt: new Date().toISOString(),
} as const;

function makeVector(): number[] {
  return Array.from({ length: 1024 }, (_, i) => i / 1024);
}

describe('Vectorize1024Schema', () => {
  it('accepts a 1024-dim array of finite numbers', () => {
    expect(Vectorize1024Schema.safeParse(makeVector()).success).toBe(true);
  });

  it('rejects arrays of wrong length', () => {
    expect(Vectorize1024Schema.safeParse(makeVector().slice(0, 1023)).success).toBe(false);
    expect(Vectorize1024Schema.safeParse([...makeVector(), 0]).success).toBe(false);
  });

  it('rejects non-finite numbers', () => {
    const vector = makeVector();
    vector[0] = Number.NaN;
    expect(Vectorize1024Schema.safeParse(vector).success).toBe(false);
  });
});

describe('TaxLawChunkSchema', () => {
  it('accepts Wave 1 chunks with vector: null', () => {
    expect(TaxLawChunkSchema.safeParse({ ...baseChunk, vector: null }).success).toBe(true);
  });

  it('rejects chunks with a populated vector', () => {
    expect(TaxLawChunkSchema.safeParse({ ...baseChunk, vector: makeVector() }).success).toBe(false);
  });
});

describe('TaxLawEmbeddedChunkSchema', () => {
  it('accepts chunks with a 1024-dim vector', () => {
    expect(
      TaxLawEmbeddedChunkSchema.safeParse({ ...baseChunk, vector: makeVector() }).success,
    ).toBe(true);
  });

  it('rejects chunks with vector: null', () => {
    expect(TaxLawEmbeddedChunkSchema.safeParse({ ...baseChunk, vector: null }).success).toBe(false);
  });

  it('rejects chunks with a short vector', () => {
    expect(
      TaxLawEmbeddedChunkSchema.safeParse({ ...baseChunk, vector: makeVector().slice(0, 100) })
        .success,
    ).toBe(false);
  });
});

describe('VectorizeChunkMetadataSchema', () => {
  it('accepts the documented metadata fields', () => {
    const metadata = {
      jurisdiction: 'ES',
      sourceUrl: 'https://boe.es/example',
      sourceTitle: 'Example',
      authority: 'BOE',
      taxYear: 2025,
      topic: 'irpf',
      lang: 'es',
      chunkIndex: 0,
      charCount: 100,
      contentHash: 'b'.repeat(64),
    };
    expect(VectorizeChunkMetadataSchema.safeParse(metadata).success).toBe(true);
  });

  it('rejects extra fields', () => {
    const metadata = {
      jurisdiction: 'ES',
      sourceUrl: 'https://boe.es/example',
      sourceTitle: 'Example',
      authority: 'BOE',
      taxYear: 2025,
      topic: 'irpf',
      lang: 'es',
      chunkIndex: 0,
      charCount: 100,
      contentHash: 'b'.repeat(64),
      text: 'should not be here',
    };
    expect(VectorizeChunkMetadataSchema.safeParse(metadata).success).toBe(false);
  });

  it('rejects nested objects', () => {
    const metadata = {
      jurisdiction: 'ES',
      sourceUrl: 'https://boe.es/example',
      sourceTitle: 'Example',
      authority: 'BOE',
      taxYear: 2025,
      topic: 'irpf',
      lang: 'es',
      chunkIndex: 0,
      charCount: 100,
      contentHash: 'b'.repeat(64),
      nested: { foo: 1 },
    };
    expect(VectorizeChunkMetadataSchema.safeParse(metadata).success).toBe(false);
  });
});

describe('VectorizeUpsertItemSchema', () => {
  it('accepts a valid upsert item', () => {
    const item = {
      id: 'a'.repeat(64),
      values: makeVector(),
      metadata: {
        jurisdiction: 'ES',
        sourceUrl: 'https://boe.es/example',
        sourceTitle: 'Example',
        authority: 'BOE',
        taxYear: 2025,
        topic: 'irpf',
        lang: 'es',
        chunkIndex: 0,
        charCount: 100,
        contentHash: 'b'.repeat(64),
      },
    };
    expect(VectorizeUpsertItemSchema.safeParse(item).success).toBe(true);
  });

  it('rejects an item with malformed id', () => {
    const item = {
      id: 'short',
      values: makeVector(),
      metadata: {
        jurisdiction: 'ES',
        sourceUrl: 'https://boe.es/example',
        sourceTitle: 'Example',
        authority: 'BOE',
        taxYear: 2025,
        topic: 'irpf',
        lang: 'es',
        chunkIndex: 0,
        charCount: 100,
        contentHash: 'b'.repeat(64),
      },
    };
    expect(VectorizeUpsertItemSchema.safeParse(item).success).toBe(false);
  });
});
