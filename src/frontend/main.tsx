/**
 * Taxmora SPA entry point.
 *
 * Mounts the Solid app shell into #root. The app is a client-rendered SPA
 * (hash-based tab navigation) served from /app via the Workers static assets
 * binding — see vite.config.ts and the `assets` block in wrangler.toml.
 *
 * API calls are same-origin (/api/*), so no CORS or base-URL configuration
 * is needed here.
 *
 * i18n: sync <html lang> with the detected locale (localStorage → navigator
 * language → default en) before mounting, so the first paint already carries
 * the right document language.
 *
 * Auth gate: the app shell must not render for anonymous visitors. We call
 * checkSession() before mounting — a 401 redirects to /sign-in?next=… (see
 * src/frontend/auth-gate.ts) and the shell stays unmounted, so there is no
 * broken-shell flash, no dashboard 401 and no unhandled rejection.
 */

import { render } from 'solid-js/web';
import App from './App';
import { checkSession } from './auth-gate';
import { locale } from './i18n';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

document.documentElement.lang = locale() === 'zh' ? 'zh-CN' : 'en';

async function boot(): Promise<void> {
  const ok = await checkSession();
  if (!ok) return; // redirected to /sign-in — do not mount the shell.
  // Re-read the root inside boot: TypeScript's null-narrowing from the
  // module-level throw does not survive into the async function.
  const mountRoot = document.getElementById('root');
  if (!mountRoot) return;
  render(() => <App />, mountRoot);
}

void boot();
