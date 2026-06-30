/**
 * Deadlines page fetch client.
 *
 * Wraps GET /api/deadlines, POST /api/deadlines, POST /api/deadlines/:id/complete,
 * POST /api/deadlines/:id/snooze, DELETE /api/deadlines/:id and POST /api/deadlines/seed.
 */

import type { Deadline } from '../../../db/schema';
import type { DeadlineCategory, DeadlineStatus } from '../../../deadlines/types';

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

export interface DeadlineFilters {
  taxYear?: number;
  status?: DeadlineStatus;
  jurisdiction?: string;
  category?: DeadlineCategory;
  from?: string;
  to?: string;
}

interface ListOk {
  ok: true;
  count: number;
  items: Deadline[];
}
interface ListErr {
  ok: false;
  error: string;
  issues?: unknown;
}
type ListResponse = ListOk | ListErr;

export async function fetchDeadlines(filters: DeadlineFilters = {}): Promise<Deadline[]> {
  const params = new URLSearchParams();
  if (filters.taxYear) params.set('taxYear', String(filters.taxYear));
  if (filters.status) params.set('status', filters.status);
  if (filters.jurisdiction) params.set('jurisdiction', filters.jurisdiction);
  if (filters.category) params.set('category', filters.category);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const qs = params.toString();
  const res = await fetch(`/api/deadlines${qs ? `?${qs}` : ''}`, {
    credentials: 'include',
    headers: { ...XHR_HEADERS },
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `fetchDeadlines failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`fetchDeadlines failed: ${res.status}`);
  const json = (await res.json()) as ListResponse;
  if (!json.ok) throw new Error(json.error || 'fetchDeadlines failed');
  return json.items;
}

export interface DeadlineCreateInput {
  taxYear: number;
  jurisdiction: string;
  title: string;
  description?: string;
  dueDate: string;
  status?: DeadlineStatus;
  category: DeadlineCategory;
  reminderDays?: number;
}

interface CreateOk {
  ok: true;
  item: Deadline;
}
interface CreateErr {
  ok: false;
  error: string;
  issues?: unknown;
}
type CreateResponse = CreateOk | CreateErr;

export async function createDeadline(input: DeadlineCreateInput): Promise<Deadline> {
  const res = await fetch('/api/deadlines', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `createDeadline failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`createDeadline failed: ${res.status}`);
  const json = (await res.json()) as CreateResponse;
  if (!json.ok) throw new Error(json.error || 'createDeadline failed');
  return json.item;
}

interface CompleteOk {
  ok: true;
  item: Deadline;
}
interface CompleteErr {
  ok: false;
  error: string;
}
type CompleteResponse = CompleteOk | CompleteErr;

export async function completeDeadline(id: string): Promise<Deadline> {
  const res = await fetch(`/api/deadlines/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...XHR_HEADERS },
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status === 404) throw new Error('NOT_FOUND');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `completeDeadline failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`completeDeadline failed: ${res.status}`);
  const json = (await res.json()) as CompleteResponse;
  if (!json.ok) throw new Error(json.error || 'completeDeadline failed');
  return json.item;
}

interface SnoozeOk {
  ok: true;
  item: Deadline;
}
interface SnoozeErr {
  ok: false;
  error: string;
}
type SnoozeResponse = SnoozeOk | SnoozeErr;

export async function snoozeDeadline(id: string, until: string): Promise<Deadline> {
  const res = await fetch(`/api/deadlines/${encodeURIComponent(id)}/snooze`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify({ until }),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status === 404) throw new Error('NOT_FOUND');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `snoozeDeadline failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`snoozeDeadline failed: ${res.status}`);
  const json = (await res.json()) as SnoozeResponse;
  if (!json.ok) throw new Error(json.error || 'snoozeDeadline failed');
  return json.item;
}

interface DeleteOk {
  ok: true;
  deleted: boolean;
}
interface DeleteErr {
  ok: false;
  error: string;
}
type DeleteResponse = DeleteOk | DeleteErr;

export async function deleteDeadline(id: string): Promise<void> {
  const res = await fetch(`/api/deadlines/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { ...XHR_HEADERS },
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status === 404) throw new Error('NOT_FOUND');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `deleteDeadline failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`deleteDeadline failed: ${res.status}`);
  const json = (await res.json()) as DeleteResponse;
  if (!json.ok) throw new Error(json.error || 'deleteDeadline failed');
}

interface SeedOk {
  ok: true;
  count: number;
}
interface SeedErr {
  ok: false;
  error: string;
  issues?: unknown;
}
type SeedResponse = SeedOk | SeedErr;

export async function seedDeadlines(taxYear: number, jurisdictions: string[]): Promise<number> {
  const res = await fetch('/api/deadlines/seed', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify({ taxYear, jurisdictions }),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `seedDeadlines failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`seedDeadlines failed: ${res.status}`);
  const json = (await res.json()) as SeedResponse;
  if (!json.ok) throw new Error(json.error || 'seedDeadlines failed');
  return json.count;
}

export type { Deadline };
