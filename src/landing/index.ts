/**
 * Landing page route registration.
 *
 * Mounts static, merchant-review-friendly HTML pages at the root path so
 * Paddle/Creem reviewers and visitors see a complete public site even though
 * the main SolidStart SPA is not yet wired to the Worker entry point.
 */

import type { IncomingRequestCfProperties } from '@cloudflare/workers-types';
import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../api';
import { createAuth } from '../auth/auth';
import { registerCompareRoutes } from './compare';
import {
  cookiePage,
  homePage,
  impressumPage,
  pricingPage,
  privacyPage,
  refundPage,
  signInPage,
  signUpPage,
  termsPage,
} from './pages';

type App = Hono<{ Bindings: Bindings; Variables: Variables }>;

const HTML = 'text/html; charset=utf-8';

/**
 * Landing pages are registered BEFORE the auth-setting middleware in
 * src/api/index.ts, so `c.get('auth')` is still unset when these
 * handlers run - create the per-request instance here instead (same
 * workaround #4 pattern).
 */
function resolveAuth(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  return (
    c.get('auth') ??
    createAuth(
      c.env,
      (c.req.raw as unknown as { cf?: IncomingRequestCfProperties }).cf,
      new URL(c.req.url).origin,
    )
  );
}

export function registerLandingRoutes(app: App): void {
  app.get('/', async (c) => {
    // Logged-in visitors skip the marketing page and land straight in the
    // app. One session lookup (D1/KV read) per home-page hit is fine -
    // this page exists to catch anonymous article traffic.
    try {
      const session = await resolveAuth(c).api.getSession({ headers: c.req.raw.headers });
      if (session) return c.redirect('/app', 302);
    } catch (err) {
      // Fail-open: a broken session lookup must never 500 the landing
      // page - anonymous visitors still get the marketing page.
      console.error('landing /: session check failed', err);
    }
    return c.html(homePage(), 200, { 'Content-Type': HTML });
  });
  app.get('/pricing', (c) => c.html(pricingPage(), 200, { 'Content-Type': HTML }));
  app.get('/sign-in', (c) => c.html(signInPage(), 200, { 'Content-Type': HTML }));
  app.get('/sign-up', (c) => c.html(signUpPage(), 200, { 'Content-Type': HTML }));
  app.get('/terms', (c) => c.html(termsPage(), 200, { 'Content-Type': HTML }));
  app.get('/privacy', (c) => c.html(privacyPage(), 200, { 'Content-Type': HTML }));
  app.get('/refund', (c) => c.html(refundPage(), 200, { 'Content-Type': HTML }));
  app.get('/cookie-policy', (c) => c.html(cookiePage(), 200, { 'Content-Type': HTML }));
  app.get('/impressum', (c) => c.html(impressumPage(), 200, { 'Content-Type': HTML }));
  registerCompareRoutes(app);
}
