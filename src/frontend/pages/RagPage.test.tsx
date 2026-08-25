/**
 * RagPage tests — mock fetch for the RAG Q&A API client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../i18n';
import RagPage from './RagPage';
import { askQuestion } from './rag/api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RagPage component', () => {
  it('exports a default Solid component', () => {
    expect(typeof RagPage).toBe('function');
  });
});

describe('RagPage i18n', () => {
  it('switches copy between zh and en locales', () => {
    setLocale('zh');
    expect(t('rag.title')).toBe('税法问答 (RAG)');
    expect(t('rag.option.DE')).toBe('德国 DE');

    setLocale('en');
    expect(t('rag.title')).toBe('Tax-law Q&A (RAG)');
    expect(t('rag.option.DE')).toBe('Germany DE');
  });
});

describe('askQuestion', () => {
  it('POSTs question with optional filters and credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        answer: 'Dividends are taxed at 28%.',
        confidence: 'high',
        reasoning: 'From PT IRS articles.',
        taxYear: 2025,
        warnings: null,
        citations: [
          {
            id: '1',
            sourceUrl: 'https://example.com',
            sourceTitle: 'PT IRS',
            authority: 'AT',
            score: 0.95,
          },
        ],
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await askQuestion('How are dividends taxed in Portugal?', 'PT', 2025);

    expect(fetchMock).toHaveBeenCalledWith('/api/rag/qa', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        question: 'How are dividends taxed in Portugal?',
        jurisdiction: 'PT',
        taxYear: 2025,
      }),
    });
    expect(result.answer).toContain('28%');
    expect(result.confidence).toBe('high');
    expect(result.citations).toHaveLength(1);
  });

  it('throws UNAUTHORIZED on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })));
    await expect(askQuestion('test')).rejects.toThrow('UNAUTHORIZED');
  });

  it('throws NO_CONTEXT on 422', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 422 })));
    await expect(askQuestion('test')).rejects.toThrow('NO_CONTEXT');
  });
});
