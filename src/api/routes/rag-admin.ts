import { Hono } from 'hono';
import { z } from 'zod';
import { putChunks } from '../../services/rag/chunk-store';
import { createEmbeddingClient } from '../../services/rag/embedding';
import {
  TaxLawChunkSchema,
  type TaxLawEmbeddedChunk,
  type VectorizeUpsertItem,
} from '../../services/rag/types';
import { upsertChunks } from '../../services/rag/vectorize-store';
import type { Bindings, Variables } from '../index';
import { requireAdmin } from '../middleware/require-admin';

const MAX_CHUNKS_PER_REQUEST = 64;

const ChunkBatchSchema = z.object({
  chunks: z.array(TaxLawChunkSchema).min(1).max(MAX_CHUNKS_PER_REQUEST),
});

export const ragAdminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function toUpsertItem(chunk: TaxLawEmbeddedChunk): VectorizeUpsertItem {
  return {
    id: chunk.id,
    values: chunk.vector,
    metadata: {
      jurisdiction: chunk.jurisdiction,
      sourceUrl: chunk.sourceUrl,
      sourceTitle: chunk.sourceTitle,
      authority: chunk.authority,
      taxYear: chunk.taxYear,
      topic: chunk.topic,
      lang: chunk.lang,
      chunkIndex: chunk.chunkIndex,
      charCount: chunk.charCount,
      contentHash: chunk.contentHash,
    },
  };
}

ragAdminRoutes.post('/upsert', requireAdmin(), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ChunkBatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const embedder = createEmbeddingClient(c.env.AI);
  const vectors = await embedder.embedTexts(parsed.data.chunks.map((chunk) => chunk.text));

  const embedded: TaxLawEmbeddedChunk[] = parsed.data.chunks.map((chunk, index) => ({
    ...chunk,
    vector: vectors[index],
  }));

  await putChunks(c.env.KV, embedded);
  const upsertResult = await upsertChunks(c.env.VECTORIZE, embedded.map(toUpsertItem));

  return c.json({
    ok: true,
    upserted: upsertResult.count,
    kvWritten: embedded.length,
  });
});
