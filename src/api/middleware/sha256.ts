/**
 * sha256.ts — Shared SHA-256 hex helper for audit logging chokepoints.
 *
 * Extracted from audit.ts (Oracle P0-1 W4 review) so both the global hash-only
 * audit middleware and the per-route audit writes (e.g. watermark-off render
 * trail) hash bodies through a single canonical implementation.
 *
 * GDPR Art. 4(1): hex SHA-256 is NOT personal data when used as a
 * collision-resistant fingerprint without an adjacent rainbow-table-friendly
 * salt store. Keeps `audit_log` free of raw PII.
 */
export const MAX_HASH_BYTES = 65536; // 64 KB — max bytes hashed per call
export const OVERSIZED_THRESHOLD = 1048576; // 1 MB — refuse to even start

/**
 * Compute the lowercase hex SHA-256 digest of `input`. Accepts a string
 * (encoded as UTF-8) or any BufferSource (Uint8Array / ArrayBuffer / view).
 *
 * The function does NOT enforce MAX_HASH_BYTES on its own — callers must
 * slice before calling so the cap is visible at the call site (matches the
 * audit middleware's existing `buf.slice(0, MAX_HASH_BYTES)` pattern).
 */
export async function sha256Hex(input: BufferSource | string): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
