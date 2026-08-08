/**
 * Landing page route registration.
 *
 * Mounts static, merchant-review-friendly HTML pages at the root path so
 * Paddle/Creem reviewers and visitors see a complete public site even though
 * the main SolidStart SPA is not yet wired to the Worker entry point.
 */

import type { Hono } from 'hono';
import type { Bindings, Variables } from '../api';
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

export function registerLandingRoutes(app: App): void {
  app.get('/', (c) => c.html(homePage(), 200, { 'Content-Type': HTML }));
  app.get('/pricing', (c) => c.html(pricingPage(), 200, { 'Content-Type': HTML }));
  app.get('/sign-in', (c) => c.html(signInPage(), 200, { 'Content-Type': HTML }));
  app.get('/sign-up', (c) => c.html(signUpPage(), 200, { 'Content-Type': HTML }));
  app.get('/terms', (c) => c.html(termsPage(), 200, { 'Content-Type': HTML }));
  app.get('/privacy', (c) => c.html(privacyPage(), 200, { 'Content-Type': HTML }));
  app.get('/refund', (c) => c.html(refundPage(), 200, { 'Content-Type': HTML }));
  app.get('/cookie-policy', (c) => c.html(cookiePage(), 200, { 'Content-Type': HTML }));
  app.get('/impressum', (c) => c.html(impressumPage(), 200, { 'Content-Type': HTML }));
}
