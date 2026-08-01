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
  citation: string;
  applicable: boolean;
  reason: string;
  confidence: number;
  estimatedSavingsEur: number | null;
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

export type { CalculatorInput, Country };
