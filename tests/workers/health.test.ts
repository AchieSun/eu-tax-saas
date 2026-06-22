import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedUser, setupTestEnv } from '../helpers/workers-env';

/**
 * Smoke test for the @cloudflare/vitest-pool-workers harness.
 *
 * If this suite passes, downstream W4 PDF-rendering integration tests can
 * trust:
 *   1. SELF.fetch routes into our real Hono app from src/api/index.ts
 *   2. Drizzle migrations apply cleanly to the ephemeral Miniflare D1
 *   3. The seedUser helper produces a row that satisfies every NOT NULL
 *      constraint in the users table (Better Auth + app extensions)
 */
describe('Workers harness — smoke test', () => {
  beforeAll(async () => {
    await setupTestEnv();
  });

  it('SELF.fetch reaches the Worker and /api/health returns 200', async () => {
    const res = await SELF.fetch('http://test.local/api/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      env: string;
      timestamp: number;
      version: string;
    };
    expect(body.status).toBe('ok');
    expect(body.env).toBe('test'); // from wrangler.test.toml [vars].ENVIRONMENT
    expect(typeof body.timestamp).toBe('number');
    expect(body.version).toBe('0.1.0');
  });

  it('migrations applied: users table accepts INSERT via seedUser()', async () => {
    const user = await seedUser({ role: 'admin' });
    expect(user.id).toBeTruthy();
    expect(user.email).toMatch(/@test\.local$/);
    expect(user.role).toBe('admin');
  });

  it('migrations applied: form_field_mappings has W4 coordinate columns', async () => {
    // PRAGMA table_info is the cheapest way to assert column existence.
    const { env } = await import('cloudflare:test');
    const result = await env.DB.prepare('PRAGMA table_info(form_field_mappings)').all<{
      name: string;
    }>();
    const columns = result.results.map((r) => r.name);
    expect(columns).toContain('x_coord');
    expect(columns).toContain('y_coord');
    expect(columns).toContain('field_kind');
    expect(columns).toContain('pdf_r2_key');
  });

  it('R2 binding is functional (PUT then GET roundtrip)', async () => {
    const { env } = await import('cloudflare:test');
    const key = `smoke/${crypto.randomUUID()}.bin`;
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

    await env.R2.put(key, payload);
    const obj = await env.R2.get(key);
    expect(obj).not.toBeNull();
    const buf = new Uint8Array(await obj?.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(payload));
  });
});
