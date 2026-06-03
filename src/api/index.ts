/**
 * Hono API entry point — Cloudflare Workers handler.
 * Wires Better Auth (per-request) + F1 calculator routes.
 *
 * Compatible with both raw Workers and SolidStart server middleware.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { D1Database, KVNamespace, R2Bucket, Ai, Queue, IncomingRequestCfProperties } from '@cloudflare/workers-types';
import { createAuth, type Auth } from '../auth/auth';
import { auditMiddleware } from './middleware/audit';
import { calculateRoutes } from './routes/calculate';
import { daysRoutes } from './routes/days';
import { residencyRoutes } from './routes/residency';
import { formsRoutes } from './routes/forms';
import adminRoutes from './routes/admin';

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
app.use(
  '*',
  cors({
    origin: (origin) => origin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 600,
  }),
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
