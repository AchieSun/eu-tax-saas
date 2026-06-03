/**
 * Hono API entry point — Cloudflare Workers handler.
 * Wires Better Auth (per-request) + F1 calculator routes.
 *
 * Compatible with both raw Workers and SolidStart server middleware.
 *
 * Oracle P0-3 (W4 review): the CORS layer used to echo `Origin` back
 * verbatim with `credentials: true`, meaning any attacker site could ride
 * the user's session cookie into POST /render. The new gate computes an
 * allowlist per request from `c.env.APP_URL` (+ localhost in development),
 * so unknown origins receive NO `Access-Control-Allow-Origin` header at
 * all — the browser then refuses the cross-origin response.
 */

import type {
  Ai,
  D1Database,
  IncomingRequestCfProperties,
  KVNamespace,
  Queue,
  R2Bucket,
} from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { type Auth, createAuth } from '../auth/auth';
import { createDb } from '../db';
import { users } from '../db/schema';
import { auditMiddleware } from './middleware/audit';
import adminRoutes from './routes/admin';
import { calculateRoutes } from './routes/calculate';
import { daysRoutes } from './routes/days';
import { formsRoutes } from './routes/forms';
import { residencyRoutes } from './routes/residency';

export interface Bindings {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  AI: Ai;
  QUEUE: Queue;
  ENVIRONMENT: string;
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  CREEM_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_NAME?: string;
}

export interface Variables {
  auth: Auth;
  userId?: string;
  session?: { user: { id: string } };
}

export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('*', logger());

// ── Oracle P0-3 (W4 review): per-request CORS allowlist ─────────────────────
// Builds the allowed-origin set from `c.env.APP_URL` at request time (Workers
// resolves env per-request, not at module init). The origin function returns
// `null` for unknown origins, which tells hono/cors to omit the ACAO header
// entirely — the browser then refuses the cross-origin response. We never
// echo `Origin` back verbatim when `credentials: true`.
function allowOrigin(env: Bindings, origin: string | undefined): string | null {
  if (!origin) return null;
  const allowed = new Set<string>();
  if (env.APP_URL) allowed.add(env.APP_URL);
  if (env.ENVIRONMENT === 'development') {
    allowed.add('http://localhost:3000');
    allowed.add('http://localhost:8787');
    allowed.add('http://127.0.0.1:3000');
    allowed.add('http://127.0.0.1:8787');
  }
  return allowed.has(origin) ? origin : null;
}

app.use('*', (c, next) =>
  cors({
    origin: (origin) => allowOrigin(c.env, origin),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 600,
  })(c, next),
);

// ── Workaround #4: per-request Better Auth instance ─────────────────────────
app.use('*', async (c, next) => {
  const auth = createAuth(
    c.env,
    (c.req.raw as unknown as { cf?: IncomingRequestCfProperties }).cf,
    new URL(c.req.url).origin,
  );
  c.set('auth', auth);
  await next();
});

// ── Session middleware: populates c.get('session') for downstream routes ────
app.use('/api/*', async (c, next) => {
  const auth = c.get('auth');
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) c.set('session', session as { user: { id: string } });
  await next();
});

// ── Better Auth handler (mounts /api/auth/*) ────────────────────────────────
app.all('/api/auth/*', (c) => c.get('auth').handler(c.req.raw));

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    env: c.env.ENVIRONMENT,
    timestamp: Date.now(),
    version: '0.1.0',
  }),
);

// ── Oracle P0-1 (W4 review): GET /api/me ──────────────────────────────────
// Tiny endpoint the FilingDraftView mounts on load so the UI can hide the
// "Include DRAFT watermark" toggle from non-admins. Authed users get
// `{ userId, role }`; anon gets 401. Deliberately NOT mounted under audit
// middleware — it's a session-echo, not a state-changing operation.
app.get('/api/me', async (c) => {
  const session = c.get('session');
  if (!session?.user?.id) return c.json({ error: 'unauthorized' }, 401);
  const db = createDb(c.env.DB);
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  return c.json({ userId: session.user.id, role: row?.role ?? 'user' });
});

// ── Hash-only audit logging (Oracle P1#9) — mounts AFTER auth middleware ────
app.use('/api/calculate', auditMiddleware());
app.use('/api/calculate/*', auditMiddleware());
app.use('/api/residency', auditMiddleware());
app.use('/api/residency/*', auditMiddleware());
app.use('/api/days', auditMiddleware());
app.use('/api/days/*', auditMiddleware());
app.use('/api/admin', auditMiddleware());
app.use('/api/admin/*', auditMiddleware());

// ── App routes ──────────────────────────────────────────────────────────────
app.route('/api/calculate', calculateRoutes);
app.route('/api/days', daysRoutes);
app.route('/api/residency', residencyRoutes);
app.route('/api/forms', formsRoutes);
app.route('/api/admin', adminRoutes);

// ── 404 fallback ────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  // biome-ignore lint/suspicious/noConsoleLog: server-side error logging
  console.error('Unhandled error', err);
  return c.json({ error: err.message ?? 'Internal Server Error' }, 500);
});

export default app;
