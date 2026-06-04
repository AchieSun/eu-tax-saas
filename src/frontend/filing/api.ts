// Oracle P1-4 (W4 review): structured error surfacing + X-Requested-With + warning detail parsing.
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
 *
 * Oracle P1-4 (W4 review):
 *   - Every request sends `X-Requested-With: XMLHttpRequest` so the
 *     backend's CORS layer can distinguish browser fetches from cross-site
 *     form POSTs that lack the header.
 *   - 4xx JSON responses whose body contains a Zod-style `issues[]` array
 *     are flattened into the thrown Error's `.message` so users see the
 *     actual validation problem instead of a bare HTTP status code.
 *   - `renderForm` parses the new X-Render-Warning-Detail header (added by
 *     forms.ts in Oracle P1-3) and exposes it as `warningDetail` on the
 *     returned RenderResult so the view layer can render per-field
 *     warnings without making a second request.
 */

import type { FormMetadata, RenderResult } from './types';

const UNAUTHORIZED = 'UNAUTHORIZED';
const RATE_LIMITED = 'RATE_LIMITED';

// Oracle P1-4 (W4 review): browser-XHR marker for CORS heuristics.
const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' } as const;

/**
 * Oracle P1-4 (W4 review): pull a structured error message out of a 4xx
 * JSON body. Handles three shapes:
 *   1. `{ error: 'CODE', issues: [{ path: ['a','b'], message: 'X' }, ...] }`
 *      → `'CODE: a.b: X; ...'`
 *   2. `{ error: 'CODE' }`           → `'CODE'`
 *   3. anything else / non-JSON body → `fallback` argument
 *
 * Never throws — body parsing failures fall through to `fallback`. The
 * `.clone()` on Response is mandatory because callers may also want to
 * read the body as text after this returns.
 */
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

/**
 * Oracle P1-4 (W4 review): tolerant header-JSON parser. Returns `null` on
 * any failure (header missing, malformed JSON, wrong shape). Callers must
 * defensively treat the result as untrusted.
 */
function parseHeaderJSON<T>(headerValue: string | null): T | null {
  if (!headerValue) return null;
  try {
    return JSON.parse(headerValue) as T;
  } catch {
    return null;
  }
}

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
    // Oracle P1-4 (W4 review): mark as browser-XHR so CORS gating works.
    headers: { ...XHR_HEADERS },
  });
  if (res.status === 401) throw new Error(UNAUTHORIZED);
  if (res.status === 404) throw new Error('FORM_NOT_FOUND');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `fetchFormMetadata failed: ${res.status}`));
  }
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
    // Oracle P1-4 (W4 review): mark as browser-XHR so CORS gating works.
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
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
  if (res.status === 422) {
    // Oracle P1-4 (W4 review): surface 422 detail (mapping_unverified
    // listing the placeholder fields, no_active_mapping_fields, etc.)
    // while keeping NO_ACTIVE_FIELDS as the legacy fallback message.
    throw new Error(await extractErrorMessage(res, 'NO_ACTIVE_FIELDS'));
  }
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, `renderForm failed: ${res.status}`));
  }
  if (!res.ok) throw new Error(`renderForm failed: ${res.status}`);

  const pdfBlob = await res.blob();
  // Oracle P1-4 (W4 review): parse X-Render-Warning-Detail emitted by P1-3.
  const warningDetail = parseHeaderJSON<RenderResult['warningDetail']>(
    res.headers.get('X-Render-Warning-Detail'),
  );
  return {
    pdfBlob,
    warnings: Number.parseInt(res.headers.get('X-Render-Warnings') ?? '0', 10),
    filledFields: Number.parseInt(res.headers.get('X-Render-Filled-Fields') ?? '0', 10),
    mappingVersion: Number.parseInt(res.headers.get('X-Render-Mapping-Version') ?? '0', 10),
    mappingHash: res.headers.get('X-Render-Mapping-Hash') ?? '',
    warningDetail,
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
