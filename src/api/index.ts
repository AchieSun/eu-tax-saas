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
  VectorizeIndex,
} from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { type Auth, createAuth } from '../auth/auth';
import { createDb } from '../db';
import { users } from '../db/schema';
import { auditMiddleware } from './middleware/audit';
import { rateLimitD1 } from './middleware/rate-limit-d1';
import adminRoutes from './routes/admin';
import { calculateRoutes } from './routes/calculate';
import { dashboardRoutes } from './routes/dashboard';
import { daysRoutes } from './routes/days';
import { deadlinesRoutes } from './routes/deadlines';
import { formsRoutes } from './routes/forms';
import { ragRoutes } from './routes/rag';
import { ragAdminRoutes } from './routes/rag-admin';
import { residencyRoutes } from './routes/residency';
import { strategiesRoutes } from './routes/strategies';

export interface Bindings {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  QUEUE: Queue;
  ENVIRONMENT: string;
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  EU_TAX_SAAS_BOT_CONTACT?: string;
  PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  CREEM_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_NAME?: string;
  /** Cloudflare API token used to authenticate with AI Gateway when authenticated gateway is enabled. */
  AI_GATEWAY_API_TOKEN?: string;
  /** DeepSeek per-1M-token input cost (USD). Override list price. Default 0.27. */
  DEEPSEEK_COST_INPUT_USD_PER_M?: string;
  /** DeepSeek per-1M-token output cost (USD). Override list price. Default 1.1. */
  DEEPSEEK_COST_OUTPUT_USD_PER_M?: string;
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
app.use('/api/deadlines', auditMiddleware());
app.use('/api/deadlines/*', auditMiddleware());
app.use('/api/dashboard', auditMiddleware());
app.use('/api/dashboard/*', auditMiddleware());
app.use('/api/admin', auditMiddleware());
app.use('/api/admin/*', auditMiddleware());
// Oracle P1-2 (W4 review): /api/forms is legally consequential — every
// render embeds user data into a draft tax PDF, so it deserves the same
// hash-only audit trail as /calculate and /admin. This emits a generic
// source='api' row alongside the per-render source='render-watermark-off'
// row from P0-1 (the two complement each other rather than overlapping).
app.use('/api/forms', auditMiddleware());
app.use('/api/forms/*', auditMiddleware());
// F4 strategy library — persist endpoint writes recommendations to D1;
// list/evaluate are pure but hashing them is still useful for analytics.
app.use('/api/strategies', auditMiddleware());
app.use('/api/strategies/*', auditMiddleware());
app.use('/api/admin/rag', auditMiddleware());
app.use('/api/admin/rag/*', auditMiddleware());
app.use('/api/rag', auditMiddleware());
app.use('/api/rag/*', auditMiddleware());
app.use('/api/rag/qa', rateLimitD1({ keyPrefix: 'rag-qa', windowSeconds: 60, max: 5 }));
// F5 RAG admin upsert: computationally expensive (embedding batch + Vectorize write).
// Limit to 10 upserts/min per admin to prevent quota exhaustion / accidental floods.
app.use(
  '/api/admin/rag/upsert',
  rateLimitD1({ keyPrefix: 'rag-admin-upsert', windowSeconds: 60, max: 10 }),
);

// ── App routes ──────────────────────────────────────────────────────────────
app.route('/api/calculate', calculateRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/days', daysRoutes);
app.route('/api/deadlines', deadlinesRoutes);
app.route('/api/forms', formsRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/admin/rag', ragAdminRoutes);
app.route('/api/rag', ragRoutes);
app.route('/api/residency', residencyRoutes);
app.route('/api/strategies', strategiesRoutes);

// ── 404 fallback ────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error', err);
  const isDev = c.env.ENVIRONMENT === 'development';
  const message = isDev ? (err.message ?? 'Internal Server Error') : 'Internal Server Error';
  return c.json({ error: message }, 500);
});

export default app;
