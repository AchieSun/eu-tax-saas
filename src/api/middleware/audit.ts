/**
 * Hash-only audit logging middleware (Oracle P1#9).
 *
 * Captures SHA-256 hashes of request/response bodies for /api/calculate,
 * /api/residency, and /api/days routes. Never stores raw body content.
 *
 * GDPR Art. 4(1): SHA-256 hashes are NOT personal data when collision-resistant
 * hashing is used and no PII is stored alongside.
 */

import { createMiddleware } from 'hono/factory';
import { createDb } from '../../db';
import { auditLog } from '../../db/schema';
import type { Bindings, Variables } from '../index';

const MAX_HASH_BYTES = 65536;        // 64 KB — max bytes to hash
const OVERSIZED_THRESHOLD = 1048576; // 1 MB — refuse to even start hashing

/**
 * Compute SHA-256 hex digest of input data.
 * Accepts BufferSource (Uint8Array / ArrayBuffer) or string.
 */
async function sha256Hex(input: BufferSource | string): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function auditMiddleware() {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
    async (c, next) => {
      // ── Capture input hash BEFORE handler consumes body ──────────────
      let inputHash: string | null = null;
      if (c.req.method !== 'GET' && c.req.method !== 'DELETE') {
        // Content-Length short-circuit: don't even try to hash huge bodies
        const contentLength = parseInt(c.req.header('content-length') ?? '0', 10);
        if (contentLength > OVERSIZED_THRESHOLD) {
          inputHash = 'oversized';
        } else {
          const cloned = c.req.raw.clone();
          const buf = await cloned.arrayBuffer();
          if (buf.byteLength > 0) {
            // Slice to MAX_HASH_BYTES so we never hash more than needed
            const slice = buf.byteLength > MAX_HASH_BYTES
              ? buf.slice(0, MAX_HASH_BYTES)
              : buf;
            inputHash = await sha256Hex(new Uint8Array(slice));
          }
        }
      }

      // ── Run handler (catch errors so we still audit) ─────────────────
      let handlerError: unknown = null;
      try {
        await next();
      } catch (err) {
        handlerError = err;
      }

      // ── Capture output hash AFTER handler runs ───────────────────────
      let resultHash: string | null = null;
      let statusCode = 500;
      if (c.res) {
        statusCode = c.res.status;
        if (c.res.body) {
          try {
            const cloned = c.res.clone();
            const buf = await cloned.arrayBuffer();
            if (buf.byteLength > 0) {
              resultHash = await sha256Hex(buf);
            }
          } catch {
            // Response may not be clonable if handler threw mid-stream
          }
        }
      }

      // ── Resolve userId from session (anonymous if unavailable) ───────
      const session = c.get('session');
      const userId = session?.user?.id ?? null;

      // ── Fire-and-forget write — never block response ─────────────────
      // Guard: skip write if no DB binding (e.g. test environment)
      if (c.env?.DB) {
        const db = createDb(c.env.DB);
        const promise = db
          .insert(auditLog)
          .values({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            userIdOrNull: userId,
            route: new URL(c.req.url).pathname,
            method: c.req.method,
            inputHash,
            resultHash,
            statusCode,
            source: 'api',
          })
          .then(
            () => {},
            (err: unknown) =>
              console.error('audit write failed', err),
          );

        // executionCtx throws in non-Workers environments (e.g. tests)
        let hasWaitUntil = false;
        try {
          hasWaitUntil = typeof c.executionCtx?.waitUntil === 'function';
        } catch {
          // Not in Workers runtime
        }

        if (hasWaitUntil) {
          c.executionCtx!.waitUntil(promise);
        } else {
          // Fallback for test environments without Workers runtime
          await promise;
        }
      }

      // ── Re-throw so onError handler can produce proper response ──────
      if (handlerError) throw handlerError;
    },
  );
}
