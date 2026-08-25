/**
 * Strategies page fetch client.
 *
 * Wraps GET /api/strategies and POST /api/strategies/evaluate.
 */

import type { CalculatorInput, Country } from '../../../rules/common/types';

const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' } as const;

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

export interface StrategyCatalogItem {
  id: string;
  tier: string;
  category: string;
  titleZh: string;
  descriptionZh: string;
  /** Optional English pair (emitted once t4 lands); UI falls back to Zh. */
  titleEn?: string;
  descriptionEn?: string;
  eligibility: string;
  citation: string;
}

interface CatalogOk {
  ok: true;
  count: number;
  items: StrategyCatalogItem[];
}
interface CatalogErr {
  ok: false;
  error: string;
  issues?: unknown;
}
type CatalogResponse = CatalogOk | CatalogErr;

export interface BaselineSummary {
  country: Country;
  taxYear: number;
  grossIncome: number;
  taxOwed: number;
  effectiveRate: number;
  marginalRate: number;
}

export interface StrategyEvaluation {
  id: string;
  tier: string;
  category: string;
  titleZh: string;
  /** Optional English pair (emitted once t4 lands); UI falls back to Zh. */
  titleEn?: string;
  /** Chinese description - doubles as the Pro guidance step (actionSteps[0]). */
  descriptionZh?: string;
  /** English parallel of descriptionZh (t4); UI falls back to Zh. */
  descriptionEn?: string;
  /** Free view: `null` (server trims it). Pro view: full citation object. */
  citation: unknown;
  applicable: boolean;
  reason: string;
  /** English parallel of reason (t4 contract: present on every row). */
  reasonEn?: string;
  confidence: number;
  estimatedSavingsEur: number | null;
  /** Free view: `[]` (server trims). Pro view: guidance steps. */
  actionSteps?: string[];
  /** Free view: `[]` (server trims). Pro view: statute citations. */
  citations?: unknown[];
}

interface EvaluateOk {
  ok: true;
  baseline: BaselineSummary;
  evaluations: StrategyEvaluation[];
}
interface EvaluateErr {
  ok: false;
  error: string;
  issues?: unknown;
}
type EvaluateResponse = EvaluateOk | EvaluateErr;

export async function fetchStrategies(
  country?: Country,
  taxYear?: number,
): Promise<StrategyCatalogItem[]> {
  const params = new URLSearchParams();
  if (country) params.set('country', country);
  if (taxYear) params.set('taxYear', String(taxYear));
  const qs = params.toString();
  const res = await fetch(`/api/strategies${qs ? `?${qs}` : ''}`, {
    credentials: 'include',
    headers: { ...XHR_HEADERS },
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `fetchStrategies failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`fetchStrategies failed: ${res.status}`);
  const json = (await res.json()) as CatalogResponse;
  if (!json.ok) throw new Error(json.error || 'fetchStrategies failed');
  return json.items;
}

export async function evaluateStrategies(input: CalculatorInput): Promise<EvaluateOk> {
  const res = await fetch('/api/strategies/evaluate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `evaluateStrategies failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`evaluateStrategies failed: ${res.status}`);
  const json = (await res.json()) as EvaluateResponse;
  if (!json.ok) throw new Error(json.error || 'evaluateStrategies failed');
  return json;
}

// ── F4 full strategy report (Pro) ──────────────────────────────────────────

/** Thrown when the backend answers 402 subscription_required. */
export class SubscriptionRequiredError extends Error {
  readonly feature: string;
  readonly subscriptionStatus: string;

  constructor(feature: string, subscriptionStatus: string) {
    super('SUBSCRIPTION_REQUIRED');
    this.name = 'SubscriptionRequiredError';
    this.feature = feature;
    this.subscriptionStatus = subscriptionStatus;
  }
}

export interface AiRecommendation {
  id: string;
  tier: string;
  titleZh: string;
  /** Optional English pair (emitted once t4 lands); UI falls back to Zh. */
  titleEn?: string;
  reasoning: string;
  confidence: number;
  estimatedSavingsEur: number | null;
  actionSteps: string[];
  citations: string[];
  aiDisclaimer: string;
}

export interface AiRecommendOk {
  ok: true;
  baseline: { country: Country; taxYear: number; taxOwed: number };
  recommendations: AiRecommendation[];
  warnings: string[];
  usage: { promptTokens: number; completionTokens: number; cost: number };
}

/**
 * POST /api/strategies/ai-recommend — Pro-gated. Throws
 * SubscriptionRequiredError on 402 so the caller can show the paywall.
 */
export async function aiRecommendStrategies(
  input: CalculatorInput,
  lang?: 'zh' | 'en',
): Promise<AiRecommendOk> {
  // t5 integration fix: `lang` mirrors the UI locale so the backend's
  // single-string aiDisclaimer switches to English when 'en'. Omitted /
  // 'zh' keeps the default zh disclaimer and the param-free URL.
  const url =
    lang === 'en' ? '/api/strategies/ai-recommend?lang=en' : '/api/strategies/ai-recommend';
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status === 402) {
    const body = (await res.json().catch(() => ({}))) as {
      feature?: string;
      subscriptionStatus?: string;
    };
    throw new SubscriptionRequiredError(
      body.feature ?? 'ai-strategy-report',
      body.subscriptionStatus ?? 'free',
    );
  }
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, `aiRecommendStrategies failed: ${res.status}`));
  }
  const json = (await res.json()) as AiRecommendOk;
  return json;
}

export type { CalculatorInput, Country };
