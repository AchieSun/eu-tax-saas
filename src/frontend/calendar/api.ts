/**
 * F6 Calendar — thin fetch client for /api/days.
 *
 * Keeps all HTTP surface in one file so the view layer never touches `fetch`
 * directly. Errors are normalised to thrown Error instances with stable
 * `.message` strings ("UNAUTHORIZED" for 401) so callers can branch on them.
 */

import type { DayEntry } from './types';

interface GetDaysResponse {
  days: DayEntry[];
}

interface PostDaysResponse {
  written: number;
}

interface DeleteDayResponse {
  deleted: number;
}

/**
 * GET /api/days?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Both parameters are optional; the server defaults to last-365-days when
 * either is missing.
 */
export async function fetchDays(from?: string, to?: string): Promise<DayEntry[]> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const url = qs.toString() ? `/api/days?${qs.toString()}` : '/api/days';

  const res = await fetch(url, { credentials: 'include' });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) throw new Error(`fetchDays failed: ${res.status}`);

  const body = (await res.json()) as GetDaysResponse;
  return body.days ?? [];
}

/**
 * POST /api/days — bulk UPSERT. Server allows 1..400 entries per request.
 * Callers are responsible for chunking larger batches.
 */
export async function bulkSaveDays(days: DayEntry[]): Promise<PostDaysResponse> {
  const res = await fetch('/api/days', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) {
    let msg = `Save failed: ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err?.error) msg = err.error;
    } catch {
      /* response body was not JSON — keep the status-based message */
    }
    throw new Error(msg);
  }
  return (await res.json()) as PostDaysResponse;
}

/**
 * DELETE /api/days/:date — remove a single day entry.
 */
export async function deleteDay(date: string): Promise<DeleteDayResponse> {
  const res = await fetch(`/api/days/${date}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  return (await res.json()) as DeleteDayResponse;
}
