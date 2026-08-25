/**
 * DeadlinesPage tests — mock fetch for the deadlines API client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../i18n';
import DeadlinesPage from './DeadlinesPage';
import {
  completeDeadline,
  createDeadline,
  deleteDeadline,
  fetchDeadlines,
  seedDeadlines,
  snoozeDeadline,
} from './deadlines/api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function makeDeadline(
  overrides: Partial<{
    id: string;
    title: string;
    status: string;
    snoozedUntil: string | null;
  }> = {},
): unknown {
  return {
    id: 'dl-1',
    userId: 'u1',
    taxYear: 2025,
    jurisdiction: 'DE',
    title: 'File tax return',
    description: null,
    dueDate: '2025-07-31',
    status: 'pending',
    category: 'tax_filing',
    source: 'system',
    reminderDays: 7,
    snoozedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeadlinesPage component', () => {
  it('exports a default Solid component', () => {
    expect(typeof DeadlinesPage).toBe('function');
  });
});

describe('DeadlinesPage i18n', () => {
  it('switches copy between zh and en locales', () => {
    setLocale('zh');
    expect(t('deadlines.title')).toBe('税务截止日 (Deadlines)');
    expect(t('deadlines.status.pending')).toBe('待办');
    expect(t('deadlines.month.format', { y: '2025', m: '07' })).toBe('2025年07月');

    setLocale('en');
    expect(t('deadlines.title')).toBe('Tax deadlines');
    expect(t('deadlines.status.pending')).toBe('Pending');
    expect(t('deadlines.month.format', { y: '2025', m: '07' })).toBe('2025-07');
  });
});

describe('fetchDeadlines', () => {
  it('GETs with filters and credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        count: 1,
        items: [makeDeadline()],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetchDeadlines({ taxYear: 2025, status: 'pending', jurisdiction: 'DE' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/deadlines?taxYear=2025&status=pending&jurisdiction=DE',
      {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      },
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('File tax return');
  });

  it('throws UNAUTHORIZED on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })));
    await expect(fetchDeadlines()).rejects.toThrow('UNAUTHORIZED');
  });
});

describe('createDeadline', () => {
  it('POSTs new deadline and returns the created item', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { ok: true, item: makeDeadline({ id: 'dl-2', title: 'New deadline' }) },
          { status: 201 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const item = await createDeadline({
      taxYear: 2025,
      jurisdiction: 'PT',
      title: 'New deadline',
      dueDate: '2025-06-30',
      category: 'payment',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/deadlines', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: expect.stringContaining('"title":"New deadline"'),
    });
    expect(item.title).toBe('New deadline');
  });
});

describe('completeDeadline', () => {
  it('POSTs to complete endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, item: makeDeadline({ status: 'completed' }) }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const item = await completeDeadline('dl-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/deadlines/dl-1/complete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(item.status).toBe('completed');
  });
});

describe('snoozeDeadline', () => {
  it('POSTs snooze with until date', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, item: makeDeadline({ snoozedUntil: '2025-08-15' }) }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const item = await snoozeDeadline('dl-1', '2025-08-15');

    expect(fetchMock).toHaveBeenCalledWith('/api/deadlines/dl-1/snooze', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ until: '2025-08-15' }),
    });
    expect(item.snoozedUntil).toBe('2025-08-15');
  });
});

describe('deleteDeadline', () => {
  it('DELETEs the deadline', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true, deleted: true }));
    vi.stubGlobal('fetch', fetchMock);

    await deleteDeadline('dl-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/deadlines/dl-1', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  });
});

describe('seedDeadlines', () => {
  it('POSTs seed request with taxYear and jurisdictions', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true, count: 12 }));
    vi.stubGlobal('fetch', fetchMock);

    const count = await seedDeadlines(2025, ['DE', 'PT']);

    expect(fetchMock).toHaveBeenCalledWith('/api/deadlines/seed', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ taxYear: 2025, jurisdictions: ['DE', 'PT'] }),
    });
    expect(count).toBe(12);
  });
});
