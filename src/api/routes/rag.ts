import { Hono } from 'hono';
import { z } from 'zod';
import { DeepSeekClient } from '../../services/deepseek';
import { createRetrievalService } from '../../services/rag/retrieve';
import { TaxLawJurisdictionSchema } from '../../services/rag/types';
import type { Bindings, Variables } from '../index';

const QaSchema = z.object({
  question: z.string().min(3).max(2000),
  jurisdiction: TaxLawJurisdictionSchema.optional(),
  taxYear: z.number().int().min(2024).max(2030).optional(),
  topK: z.number().int().min(1).max(8).optional(),
});

const QaAnswerSchema = z.object({
  answer: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string().optional(),
});

const SYSTEM_PROMPT = `You are a European tax-law assistant. Answer ONLY from the provided context. If the context does not contain the answer, respond with: {"answer":"I do not have enough context to answer this question.","confidence":"low"}.

Cite each fact by [n] referring to the numbered context items. Keep answers concise and factual.

Output ONLY valid JSON matching this schema:
{
  "answer": string,
  "confidence": "high" | "medium" | "low",
  "reasoning": string (optional)
}`;

const MAX_CONTEXT_CHARS = 16_000;

export const ragRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function buildContextBlock(
  matches: Array<{ text: string; metadata: { sourceTitle: string } }>,
): string {
  let total = 0;
  const lines: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const item = `[${i + 1}] ${matches[i].metadata.sourceTitle}\n${matches[i].text}`;
    if (total + item.length > MAX_CONTEXT_CHARS) break;
    lines.push(item);
    total += item.length;
  }
  return lines.join('\n\n');
}

ragRoutes.post('/qa', async (c) => {
  const session = c.get('session');
  if (!session?.user?.id) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = QaSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'validation', issues: parsed.error.issues }, 400);
  }

  const retrieval = createRetrievalService(c.env);
  const matches = await retrieval.retrieve({
    query: parsed.data.question,
    jurisdiction: parsed.data.jurisdiction,
    taxYear: parsed.data.taxYear,
    topK: parsed.data.topK,
  });
  if (matches.length === 0) {
    return c.json({ ok: false, error: 'no-context' }, 422);
  }

  const client = new DeepSeekClient(c.env);
  const response = await client.chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Context:\n${buildContextBlock(matches)}\n\n<user_question>\n${parsed.data.question}\n</user_question>\n\nAnswer using only the context above. Output JSON.`,
      },
    ],
    { responseFormat: { type: 'json_object' }, temperature: 0.2 },
  );

  const rawContent = response.choices[0]?.message?.content ?? '{}';
  let qaAnswer: z.infer<typeof QaAnswerSchema>;
  try {
    const parsedAnswer = QaAnswerSchema.safeParse(JSON.parse(rawContent));
    if (!parsedAnswer.success) {
      console.error('RAG QA answer failed schema validation', parsedAnswer.error.issues, rawContent);
      return c.json({ ok: false, error: 'answer-generation' }, 500);
    }
    qaAnswer = parsedAnswer.data;
  } catch {
    console.error('RAG QA answer is not valid JSON', rawContent);
    return c.json({ ok: false, error: 'answer-generation' }, 500);
  }

  return c.json({
    ok: true,
    answer: qaAnswer.answer,
    confidence: qaAnswer.confidence,
    reasoning: qaAnswer.reasoning ?? null,
    citations: matches.map((match) => ({
      id: match.id,
      sourceUrl: match.metadata.sourceUrl,
      sourceTitle: match.metadata.sourceTitle,
      authority: match.metadata.authority,
      score: match.score,
    })),
    usage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null,
  });
});
