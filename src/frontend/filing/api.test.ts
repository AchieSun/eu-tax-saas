/**
 * W4 T4.1 — Unit tests for the filing fetch client.
 *
 * Runs under pure Node (vitest.config.ts: environment='node') — fetch is
 * stubbed via vi.stubGlobal so we never make real network calls. The DOM
 * helpers (blobToObjectUrl, downloadBlob) are intentionally NOT exercised
 * here; they require a browser environment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFormMetadata, renderForm } from './api';
import type { FormMetadata } from './types';

// Minimal fixture mirroring the GET /api/forms/:c/:y/:f response.
const sampleMetadata: FormMetadata = {
  country: 'DE',
  taxYear: 2024,
  formType: 'mantelbogen',
  version: 1,
  contentHash: 'abc123',
  versionCreatedAt: '2025-01-01T00:00:00.000Z',
  fields: [
    {
      key: 'taxpayer_first_name',
      acroName: 'taxpayer_first_name',
      fieldType: 'text',
      fieldKind: 'acroform',
      dataPath: 'taxpayer.firstName',
      pageNumber: 1,
      xCoord: null,
      yCoord: null,
      fontSize: null,
      sourcePath: 'taxpayer.firstName',
      citation: 'BMF §1',
    },
  ],
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function blobResponse(headers: Record<string, string>): Response {
  return new Response(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', ...headers },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchFormMetadata', () => {
  it('happy path → shape matches FormMetadata', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(sampleMetadata));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchFormMetadata('DE', 2024, 'mantelbogen');

    expect(fetchMock).toHaveBeenCalledWith('/api/forms/DE/2024/mantelbogen', {
      credentials: 'include',
      // Oracle P1-4 (W4 review): X-Requested-With marker on GET as well.
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(result.country).toBe('DE');
    expect(result.taxYear).toBe(2024);
    expect(result.formType).toBe('mantelbogen');
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]?.dataPath).toBe('taxpayer.firstName');
  });

  it('401 → throws UNAUTHORIZED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })));
    await expect(fetchFormMetadata('DE', 2024, 'mantelbogen')).rejects.toThrow('UNAUTHORIZED');
  });

  it('404 → throws FORM_NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })));
    await expect(fetchFormMetadata('DE', 2024, 'mantelbogen')).rejects.toThrow('FORM_NOT_FOUND');
  });

  it('500 → throws generic failure message with status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })));
    await expect(fetchFormMetadata('DE', 2024, 'mantelbogen')).rejects.toThrow(
      'fetchFormMetadata failed: 500',
    );
  });
});

describe('renderForm', () => {
  const picker = { country: 'DE', year: 2024, form: 'mantelbogen' };

  it('happy path → returns blob + populated header values', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      blobResponse({
        'X-Render-Warnings': '2',
        'X-Render-Filled-Fields': '7',
        'X-Render-Mapping-Version': '3',
        'X-Render-Mapping-Hash': 'deadbeefcafebabe',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderForm(picker, { taxpayer: { firstName: 'Ada' } });

    expect(result.pdfBlob).toBeInstanceOf(Blob);
    expect(result.warnings).toBe(2);
    expect(result.filledFields).toBe(7);
    expect(result.mappingVersion).toBe(3);
    expect(result.mappingHash).toBe('deadbeefcafebabe');
    // Oracle P1-4 (W4 review): header missing → warningDetail is null.
    expect(result.warningDetail).toBeNull();
  });

  it('401 → throws UNAUTHORIZED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })));
    await expect(renderForm(picker, {})).rejects.toThrow('UNAUTHORIZED');
  });

  it('429 → throws RATE_LIMITED with retryAfter from header', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }),
        ),
    );
    try {
      await renderForm(picker, {});
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as Error & { retryAfter?: string };
      expect(e.message).toBe('RATE_LIMITED');
      expect(e.retryAfter).toBe('3600');
    }
  });

  it('422 → throws NO_ACTIVE_FIELDS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 422 })));
    await expect(renderForm(picker, {})).rejects.toThrow('NO_ACTIVE_FIELDS');
  });

  it('404 → throws FORM_NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })));
    await expect(renderForm(picker, {})).rejects.toThrow('FORM_NOT_FOUND');
  });

  it('400 with json body → throws Error using body.error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ error: 'bad_field_xyz' }, { status: 400 })),
    );
    await expect(renderForm(picker, {})).rejects.toThrow('bad_field_xyz');
  });

  it('posts correct JSON body including watermark:false and credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      blobResponse({
        'X-Render-Warnings': '0',
        'X-Render-Filled-Fields': '0',
        'X-Render-Mapping-Version': '1',
        'X-Render-Mapping-Hash': 'h',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await renderForm(picker, { foo: 'bar' }, { watermark: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/forms/DE/2024/mantelbogen/render');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    // Oracle P1-4 (W4 review): X-Requested-With marker is required on
    // every browser fetch so the backend CORS heuristics can distinguish
    // us from cross-site form posts.
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    });
    const parsed = JSON.parse(init.body as string) as { data: unknown; watermark: unknown };
    expect(parsed.data).toEqual({ foo: 'bar' });
    expect(parsed.watermark).toBe(false);
  });

  it('500 unknown failure → throws generic failure message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })));
    await expect(renderForm(picker, {})).rejects.toThrow('renderForm failed: 500');
  });

  // ── Oracle P1-4 (W4 review): structured 4xx surfacing + warningDetail ──
  it('400 with zod issues[] body → throws flattened code + path: message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'validation',
            issues: [
              { path: ['data', 'taxpayer', 'firstName'], message: 'required' },
              { path: ['data', 'taxpayer', 'taxId'], message: 'must match /^DE/' },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    await expect(renderForm(picker, {})).rejects.toThrow(
      'validation: data.taxpayer.firstName: required; data.taxpayer.taxId: must match /^DE/',
    );
  });

  it('422 with mapping_unverified + issues[] → flattens detail into thrown message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'mapping_unverified',
            issues: [{ path: ['fields', '3', 'pdfField'], message: 'TBD_taxpayer_first_name' }],
          },
          { status: 422 },
        ),
      ),
    );
    await expect(renderForm(picker, {})).rejects.toThrow(
      'mapping_unverified: fields.3.pdfField: TBD_taxpayer_first_name',
    );
  });

  it('422 with empty body → falls back to legacy NO_ACTIVE_FIELDS code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 422 })));
    await expect(renderForm(picker, {})).rejects.toThrow('NO_ACTIVE_FIELDS');
  });

  it('parses X-Render-Warning-Detail JSON into RenderResult.warningDetail', async () => {
    const detailPayload = {
      items: [
        {
          dataPath: 'taxpayer.lastName',
          fieldName: 'txt_last_name',
          reason: 'missing-data',
        },
        {
          dataPath: 'taxpayer.firstName',
          fieldName: 'txt_first_name',
          reason: 'transliterated',
          detail: 'replaced 1 non-WinAnsi char(s) [ü]',
        },
      ],
      truncated: false,
      total: 2,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        blobResponse({
          'X-Render-Warnings': '2',
          'X-Render-Filled-Fields': '5',
          'X-Render-Mapping-Version': '1',
          'X-Render-Mapping-Hash': 'h',
          'X-Render-Warning-Detail': JSON.stringify(detailPayload),
        }),
      ),
    );
    const result = await renderForm(picker, {});
    expect(result.warningDetail).not.toBeNull();
    expect(result.warningDetail?.total).toBe(2);
    expect(result.warningDetail?.truncated).toBe(false);
    expect(result.warningDetail?.items).toHaveLength(2);
    expect(result.warningDetail?.items[0]?.reason).toBe('missing-data');
    expect(result.warningDetail?.items[1]?.detail).toMatch(/replaced 1 non-WinAnsi/);
  });

  it('warningDetail is null when X-Render-Warning-Detail is malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        blobResponse({
          'X-Render-Warnings': '1',
          'X-Render-Filled-Fields': '0',
          'X-Render-Mapping-Version': '1',
          'X-Render-Mapping-Hash': 'h',
          'X-Render-Warning-Detail': '{not valid json',
        }),
      ),
    );
    const result = await renderForm(picker, {});
    expect(result.warningDetail).toBeNull();
    expect(result.warnings).toBe(1);
  });

  it('fetchFormMetadata 4xx with issues[] also surfaces flattened message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'validation',
            issues: [{ path: ['country'], message: 'unsupported' }],
          },
          { status: 400 },
        ),
      ),
    );
    await expect(fetchFormMetadata('ZZ', 2024, 'mantelbogen')).rejects.toThrow(
      'validation: country: unsupported',
    );
  });
});
