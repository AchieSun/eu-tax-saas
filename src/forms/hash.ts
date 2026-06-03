/**
 * hash.ts — Canonical JSON SHA-256 hashing for form mappings (W4 T0.5).
 *
 * Used as the content seed for `form_mapping_versions.content_hash`, which in
 * turn feeds the cache-key for ETag headers and Workers Cache lookups, so
 * cache invalidates automatically when a mapping changes.
 *
 * Design contract:
 *   - Hash is computed over a CANONICAL JSON serialisation: at every nesting
 *     level the object keys are sorted alphabetically before stringifying.
 *     This makes `{a:1,b:2}` and `{b:2,a:1}` produce the same hash.
 *   - Arrays preserve their element order (semantic in mappings — field order
 *     drives PDF stamping order).
 *   - SHA-256 hex digest, lower-case.
 *   - Runtime-agnostic: uses the Web Crypto API (`crypto.subtle.digest`)
 *     which is available in both Node (>=20) and the Workers runtime. We
 *     deliberately do NOT import `node:crypto` so this helper can be called
 *     from the Workers bundle without a polyfill.
 */

/**
 * Recursively sort object keys at every nesting level. Arrays are returned
 * as-is (their order is semantic). Primitives are passed through.
 *
 * `null`, numbers, strings, booleans, and Dates are leaf values. Anything
 * unsupported by JSON.stringify (functions, symbols, undefined fields) is
 * silently dropped, matching JSON.stringify semantics.
 */
function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalise);
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    out[k] = canonicalise(obj[k]);
  }
  return out;
}

/**
 * Stable canonical JSON string for any JSON-serialisable input.
 * Exported for tests + callers that want the canonical form without hashing.
 */
export function canonicalJSON(input: unknown): string {
  return JSON.stringify(canonicalise(input));
}

/**
 * SHA-256 hex digest of the canonical JSON representation of `input`.
 *
 * Properties:
 *   - Key-order invariant: `{a:1,b:2}` and `{b:2,a:1}` produce the same hash.
 *   - Deterministic: same logical input → same hash, byte-for-byte.
 *   - Collision-resistant for the purposes of cache invalidation.
 */
export async function canonicalJSONHash(input: unknown): Promise<string> {
  const json = canonicalJSON(input);
  const bytes = new TextEncoder().encode(json);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
