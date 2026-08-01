/**
 * Residency page fetch client.
 *
 * Wraps POST /api/residency/assess and POST /api/residency/assess-multi.
 * Errors are normalised to thrown Error instances.
 */

import type { Country } from '../../../rules/common/types';
import type {
  MultiCountryAssessment,
  ResidencyInput,
  ResidencyResult,
} from '../../../rules/residency';

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

interface AssessOk {
  ok: true;
  result: ResidencyResult;
}
interface AssessErr {
  ok: false;
  error: string;
  issues?: unknown;
}
type AssessResponse = AssessOk | AssessErr;

interface AssessMultiOk {
  ok: true;
  result: MultiCountryAssessment;
}
interface AssessMultiErr {
  ok: false;
  error: string;
  issues?: unknown;
}
type AssessMultiResponse = AssessMultiOk | AssessMultiErr;

export async function postAssess(input: ResidencyInput): Promise<ResidencyResult> {
  const res = await fetch('/api/residency/assess', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `assess failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`assess failed: ${res.status}`);
  const json = (await res.json()) as AssessResponse;
  if (!json.ok) throw new Error(json.error || 'assess failed');
  return json.result;
}

export async function postAssessMulti(inputs: ResidencyInput[]): Promise<MultiCountryAssessment> {
  const res = await fetch('/api/residency/assess-multi', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify({ inputs }),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `assess-multi failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`assess-multi failed: ${res.status}`);
  const json = (await res.json()) as AssessMultiResponse;
  if (!json.ok) throw new Error(json.error || 'assess-multi failed');
  return json.result;
}

export type { ResidencyInput, ResidencyResult, MultiCountryAssessment };
export type { Country };
