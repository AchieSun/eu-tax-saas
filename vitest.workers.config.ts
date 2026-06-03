import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

/**
 * Workers-pool Vitest config for integration tests that need real
 * Cloudflare bindings (D1, R2, KV, AI) via Miniflare.
 *
 * Scope: tests/workers/**\/*.test.ts only — pure-node unit tests stay in
 * `vitest.config.ts`. The W4 PDF rendering endpoint (and any future
 * R2/D1-dependent endpoint) MUST have its integration test live here so we
 * exercise real bindings instead of mocks (Oracle P2#7).
 *
 * Bindings come from `wrangler.test.toml`, which uses ephemeral placeholder
 * IDs — Miniflare ignores the real IDs and gives each test run a fresh,
 * in-memory D1/R2/KV.
 */
export default defineWorkersConfig({
  test: {
    include: ['tests/workers/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.toml' },
        miniflare: {
          // Ephemeral: no on-disk persistence between test runs.
          d1Persist: false,
          r2Persist: false,
          kvPersist: false,
        },
      },
    },
  },
});
