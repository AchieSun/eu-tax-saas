/**
 * Cloudflare Workers entry point.
 *
 * Re-exports the Hono app. In a future iteration we'll mount the SolidStart
 * SSR handler alongside the API; for W1 we expose just the JSON API surface.
 */

export { default } from './api';
