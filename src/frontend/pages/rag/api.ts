/**
 * RAG page fetch client.
 *
 * Wraps POST /api/rag/qa.
 */

const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' } as const;

export type RagJurisdiction = 'ES' | 'PT' | 'UK' | 'NL' | 'DE' | 'EU';

export interface RagCitation {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  authority: string;
  score: number;
}

export interface RagUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface RagAnswer {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string | null;
  taxYear: number;
  warnings: string[] | null;
  citations: RagCitation[];
  usage: RagUsage | null;
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.clone().json()) as {
      error?: string;
      issues?: Array<{ path?: unknown; message?: unknown }>;
    };
    const code = typeof body?.error === 'string' ? body.error : '';
    const issues = Array.isArray(body?.issues) ? body.issues : [];
    if (issues.length > 0) {
      const flattened = issues
        .map((iss) => {
          const path = Array.isArray(iss?.path) ? iss.path.join('.') : '';
          const msg = typeof iss?.message === 'string' ? iss.message : '';
          if (path && msg) return `${path}: ${msg}`;
          return msg || path || 'invalid';
        })
        .join('; ');
      return code ? `${code}: ${flattened}` : flattened;
    }
    if (code) return code;
    return fallback;
  } catch {
    return fallback;
  }
}

interface QaOk {
  ok: true;
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string | null;
  taxYear: number;
  warnings: string[] | null;
  citations: RagCitation[];
  usage: RagUsage | null;
}
interface QaErr {
  ok: false;
  error: string;
  issues?: unknown;
}
type QaResponse = QaOk | QaErr;

export async function askQuestion(
  question: string,
  jurisdiction?: RagJurisdiction,
  taxYear?: number,
  topK?: number,
): Promise<RagAnswer> {
  const body: {
    question: string;
    jurisdiction?: RagJurisdiction;
    taxYear?: number;
    topK?: number;
  } = { question };
  if (jurisdiction) body.jurisdiction = jurisdiction;
  if (taxYear) body.taxYear = taxYear;
  if (topK) body.topK = topK;

  const res = await fetch('/api/rag/qa', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status === 422) throw new Error('NO_CONTEXT');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `askQuestion failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`askQuestion failed: ${res.status}`);

  const json = (await res.json()) as QaResponse;
  if (!json.ok) throw new Error(json.error || 'askQuestion failed');
  return {
    answer: json.answer,
    confidence: json.confidence,
    reasoning: json.reasoning,
    taxYear: json.taxYear,
    warnings: json.warnings,
    citations: json.citations,
    usage: json.usage,
  };
}
