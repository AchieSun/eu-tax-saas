import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

/**
 * Taxmora SPA build.
 *
 * Output goes to `dist/app/` which is served by the Cloudflare Workers
 * static-assets binding (see `assets` in wrangler.toml) at /app/... on
 * taxmora.com. `base: '/app/'` ensures asset URLs in the built HTML point
 * at /app/assets/*.
 */
export default defineConfig({
  plugins: [solidPlugin()],
  base: '/app/',
  build: {
    outDir: 'dist/app',
    emptyOutDir: true,
    sourcemap: false,
  },
  // The frontend lives under src/frontend; keep Vite from scanning the whole
  // repo (server code, scripts, tests) as part of the build graph.
  root: '.',
  resolve: {
    alias: {
      '~': '/src',
    },
  },
});
