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
 * language → default zh) before mounting, so the first paint already carries
 * the right document language.
 */

import { render } from 'solid-js/web';
import App from './App';
import { locale } from './i18n';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

document.documentElement.lang = locale() === 'zh' ? 'zh-CN' : 'en';

render(() => <App />, root);
