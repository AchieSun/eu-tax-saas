/**
 * Taxmora SPA entry point.
 *
 * Mounts the Solid app shell into #root. The app is a client-rendered SPA
 * (hash-based tab navigation) served from /app via the Workers static assets
 * binding — see vite.config.ts and the `assets` block in wrangler.toml.
 *
 * API calls are same-origin (/api/*), so no CORS or base-URL configuration
 * is needed here.
 */

import { render } from 'solid-js/web';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

render(() => <App />, root);
