import { defineConfig } from 'vitest/config';

/**
 * Pure-Node Vitest config for unit tests (rule engines, calculators).
 *
 * Rule engines are pure TypeScript functions with no Workers runtime dependencies,
 * so running them under Node is faster and avoids the miniflare AI binding issue
 * on Windows. API/integration tests using D1/KV/R2 will live in
 * `vitest.workers.config.ts` once we add them in W7.
 */
export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'tools/**/*.test.ts',
      'tests/fixtures/**/*.test.ts',
      'tests/e2e/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', '.wrangler', 'tests/workers/**'],
    globals: true,
    environment: 'node',
  },
});
