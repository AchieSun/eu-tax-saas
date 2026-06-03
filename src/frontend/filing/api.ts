/**
 * W4 T4.1 — Filing draft thin fetch client for /api/forms/:c/:y/:f and its
 * /render sub-resource.
 *
 * Keeps every HTTP touchpoint in one module so the view layer never reaches
 * for `fetch` directly. Errors are normalised to thrown Error instances
 * with stable `.message` strings (`UNAUTHORIZED`, `RATE_LIMITED`,
 * `FORM_NOT_FOUND`, `NO_ACTIVE_FIELDS`) so callers can branch on them.
 *
 * The DOM helpers (`blobToObjectUrl`, `downloadBlob`) are intentionally
 * excluded from the unit-test surface — vitest runs in pure Node and we
 * deliberately don't pull in jsdom (see vitest.config.ts).
 */

import type { FormMetadata, RenderResult } from './types';

const UNAUTHORIZED = 'UNAUTHORIZED';
const RATE_LIMITED = 'RATE_LIMITED';

/**
 * GET /api/forms/:country/:year/:form — fetch the active mapping metadata
 * (version + content hash) plus the full field roster.
 */
export async function fetchFormMetadata(
  country: string,
  year: number,
  form: string,
): Promise<FormMetadata> {
  const res = await fetch(`/api/forms/${country}/${year}/${form}`, {
    credentials: 'include',
  });
  if (res.status === 401) throw new Error(UNAUTHORIZED);
  if (res.status === 404) throw new Error('FORM_NOT_FOUND');
  if (!res.ok) throw new Error(`fetchFormMetadata failed: ${res.status}`);
  return (await res.json()) as FormMetadata;
}

/**
 * POST /api/forms/:country/:year/:form/render — generate a rendered PDF
 * draft. Returns the PDF as a Blob plus the diagnostic counters lifted out
 * of the X-Render-* headers.
 */
export async function renderForm(
  picker: { country: string; year: number; form: string },
  data: Record<string, unknown>,
  options?: { watermark?: false | { text?: string } },
): Promise<RenderResult> {
  const res = await fetch(`/api/forms/${picker.country}/${picker.year}/${picker.form}/render`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, watermark: options?.watermark }),
  });
  if (res.status === 401) throw new Error(UNAUTHORIZED);
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') ?? '?';
    const err = new Error(RATE_LIMITED) as Error & { retryAfter?: string };
    err.retryAfter = retryAfter;
    throw err;
  }
  if (res.status === 404) throw new Error('FORM_NOT_FOUND');
  if (res.status === 422) throw new Error('NO_ACTIVE_FIELDS');
  if (res.status === 400) {
    let msg = 'Validation failed';
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* body wasn't JSON — keep the default message */
    }
    throw new Error(msg);
  }
  if (!res.ok) throw new Error(`renderForm failed: ${res.status}`);

  const pdfBlob = await res.blob();
  return {
    pdfBlob,
    warnings: Number.parseInt(res.headers.get('X-Render-Warnings') ?? '0', 10),
    filledFields: Number.parseInt(res.headers.get('X-Render-Filled-Fields') ?? '0', 10),
    mappingVersion: Number.parseInt(res.headers.get('X-Render-Mapping-Version') ?? '0', 10),
    mappingHash: res.headers.get('X-Render-Mapping-Hash') ?? '',
  };
}

/**
 * Build a blob: URL the caller can plug into `<iframe src>` or `<a href>`.
 * DOM-only helper — excluded from unit tests (no jsdom in vitest config).
 */
export function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * Trigger a browser download for the given blob with the supplied filename.
 * DOM-only helper — excluded from unit tests (no jsdom in vitest config).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
