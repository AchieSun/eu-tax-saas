/**
 * compare-usage.integration.test.ts — REAL D1 verification (Miniflare).
 *
 * The unit test (compare-usage.test.ts) mocks createDb, which is exactly how
 * the "pass env instead of env.DB" bug shipped unnoticed: the mock never
 * exercised real drizzle. This integration test runs the public compare
 * endpoint against the real ephemeral D1 binding and asserts the telemetry
 * row actually lands.
 */

import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from '../helpers/workers-env';

describe('GET /api/public/compare — funnel telemetry against real D1', () => {
  beforeAll(async () => {
    await setupTestEnv();
  });

  it('records exactly one compare_usage row per successful computation', async () => {
    const res = await SELF.fetch(
      'http://test.local/api/public/compare?grossIncome=80000&taxYear=2026',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // waitUntil callbacks usually settle before the pool reports the request,
    // but poll briefly so a slow D1 write cannot flake the test.
    let rows: Array<Record<string, unknown>> = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await env.DB.prepare('SELECT * FROM compare_usage').all<Record<string, unknown>>();
      rows = result.results ?? [];
      if (rows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      gross_income: 80000,
      tax_year: 2026,
      income_type: 'salary',
      filing_status: 'single',
    });
    expect(typeof rows[0].id).toBe('string');
    expect(typeof rows[0].created_at).toBe('number');
  });

  it('does NOT record a row for invalid input (validation failure)', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM compare_usage').all<{
      c: number;
    }>();
    const res = await SELF.fetch('http://test.local/api/public/compare?grossIncome=-5');
    expect(res.status).toBe(400);
    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM compare_usage').all<{
      c: number;
    }>();
    expect(after.results[0].c).toBe(before.results[0].c);
  });
});
