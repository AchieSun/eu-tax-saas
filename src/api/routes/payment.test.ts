import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema';
import type { Bindings, Variables } from '../index';
import { creemWebhookRoutes, paymentRoutes } from './payment';

const mockCheckoutResponse = {
  id: 'ch_test_123',
  object: 'checkout',
  checkout_url: 'https://creem.io/test/checkout/ch_test_123',
  status: 'pending',
};

interface UserRow {
  id: string;
  subscription_status: string;
  payment_provider: string | null;
  payment_subscription_id: string | null;
  payment_customer_id: string | null;
}

let usersStore: UserRow[] = [];

function resetStore() {
  usersStore = [];
}

async function batchExecutor(
  sql: string,
  params: unknown[],
  _method: 'all' | 'run' | 'get' | 'values',
): Promise<{ rows: unknown[] }> {
  const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();

  if (normalized.startsWith('UPDATE') && normalized.includes('"USERS"')) {
    const userId = params[params.length - 1] as string;
    const row = usersStore.find((r) => r.id === userId);
    if (row) {
      const subscriptionStatus = params[0] as string;
      const paymentProvider = params[1] as string | null;
      const paymentSubscriptionId = params[2] as string | null;
      const paymentCustomerId = params[3] as string | null;
      row.subscription_status = subscriptionStatus;
      row.payment_provider = paymentProvider;
      row.payment_subscription_id = paymentSubscriptionId;
      row.payment_customer_id = paymentCustomerId;
    }
    return { rows: [] };
  }

  return { rows: [] };
}

vi.mock('../../db', () => ({
  createDb: vi.fn(() => drizzle(batchExecutor, { schema })),
}));

function createTestApp(session: { user: { id: string } } | null) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (session) c.set('session', session);
    await next();
  });
  app.route('/api/payment', paymentRoutes);
  app.route('/api/webhooks', creemWebhookRoutes);
  return app;
}

function requestWithEnv(
  app: ReturnType<typeof createTestApp>,
  path: string,
  init?: RequestInit,
  env: Partial<Bindings> = {},
) {
  return app.request(path, init, {
    DB: {} as Bindings['DB'],
    KV: {} as Bindings['KV'],
    R2: {} as Bindings['R2'],
    AI: {} as Bindings['AI'],
    VECTORIZE: {} as Bindings['VECTORIZE'],
    QUEUE: {} as Bindings['QUEUE'],
    ENVIRONMENT: 'development',
    APP_URL: 'http://localhost:8787',
    BETTER_AUTH_SECRET: 'test-secret',
    CREEM_API_KEY: 'creem_test_key',
    CREEM_MONTHLY_PRODUCT_ID: 'prod_monthly_test',
    CREEM_YEARLY_PRODUCT_ID: 'prod_yearly_test',
    ...env,
  } as Bindings);
}

async function signCreemRedirect(url: string, apiKey: string): Promise<string> {
  const parsed = new URL(url);
  const parts: string[] = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (value === '' || value === null || value === undefined) continue;
    parts.push(`${key}=${value}`);
  }
  parts.push(`salt=${apiKey}`);
  const canonical = parts.join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('POST /api/payment/checkout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns checkout URL for authenticated user', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockCheckoutResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const app = createTestApp({ user: { id: 'test-user' } });
    const res = await requestWithEnv(app, '/api/payment/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly' }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { checkoutUrl: string };
    expect(json.checkoutUrl).toBe(mockCheckoutResponse.checkout_url);

    const fetchCall = fetchSpy.mock.calls[0];
    expect(fetchCall).toBeDefined();
    const [url, init] = fetchCall as [string, RequestInit];
    expect(url).toBe('https://test-api.creem.io/v1/checkouts');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.product_id).toBe('prod_monthly_test');
    expect(body.success_url).toBe('http://localhost:8787/api/payment/success');
    expect(body.request_id).toBe('test-user');
    expect(body.metadata).toEqual({ userId: 'test-user', plan: 'monthly' });

    fetchSpy.mockRestore();
  });

  it('rejects unauthenticated requests', async () => {
    const app = createTestApp(null);
    const res = await requestWithEnv(app, '/api/payment/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly' }),
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('unauthorized');
  });

  it('returns 500 when monthly product is not configured', async () => {
    const app = createTestApp({ user: { id: 'test-user' } });
    const res = await requestWithEnv(
      app,
      '/api/payment/checkout',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'monthly' }),
      },
      { CREEM_MONTHLY_PRODUCT_ID: undefined },
    );

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string; plan: string };
    expect(json.error).toBe('product_not_configured');
    expect(json.plan).toBe('monthly');
  });
});

describe('GET /api/payment/test-checkout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects to Creem checkout in development', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockCheckoutResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const app = createTestApp(null);
    const res = await requestWithEnv(app, '/api/payment/test-checkout?plan=monthly');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(mockCheckoutResponse.checkout_url);
  });

  it('returns 403 in production', async () => {
    const app = createTestApp(null);
    const res = await requestWithEnv(app, '/api/payment/test-checkout?plan=monthly', undefined, {
      ENVIRONMENT: 'production',
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('not_available_in_production');
  });
});

describe('GET /api/payment/success', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('activates subscription for a valid redirect', async () => {
    usersStore.push({
      id: 'user-123',
      subscription_status: 'free',
      payment_provider: null,
      payment_subscription_id: null,
      payment_customer_id: null,
    });

    const baseUrl =
      'http://localhost:8787/api/payment/success?request_id=user-123&checkout_id=ch_123&order_id=ord_123&customer_id=cust_123&subscription_id=sub_123&product_id=prod_123';
    const signature = await signCreemRedirect(baseUrl, 'creem_test_key');
    const url = `${baseUrl}&signature=${signature}`;

    const app = createTestApp(null);
    const res = await requestWithEnv(app, url);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Payment successful');

    const user = usersStore.find((u) => u.id === 'user-123');
    expect(user?.subscription_status).toBe('active');
    expect(user?.payment_provider).toBe('creem');
    expect(user?.payment_subscription_id).toBe('sub_123');
    expect(user?.payment_customer_id).toBe('cust_123');
  });

  it('rejects an invalid redirect signature', async () => {
    const url =
      'http://localhost:8787/api/payment/success?request_id=user-123&checkout_id=ch_123&subscription_id=sub_123&product_id=prod_123&signature=invalid';

    const app = createTestApp(null);
    const res = await requestWithEnv(app, url);

    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain('Invalid redirect');
  });
});

describe('POST /api/webhooks/creem', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects requests without webhook secret', async () => {
    const app = createTestApp(null);
    const res = await requestWithEnv(app, '/api/webhooks/creem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'subscription.paid' }),
    });

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('not_configured');
  });

  it('updates subscription status from a paid webhook', async () => {
    usersStore.push({
      id: 'user-123',
      subscription_status: 'free',
      payment_provider: null,
      payment_subscription_id: null,
      payment_customer_id: null,
    });

    const secret = 'whsec_test';
    const event = {
      event_type: 'subscription.paid',
      data: {
        subscription: { id: 'sub_123' },
        customer: { id: 'cust_123' },
        metadata: { userId: 'user-123' },
      },
    };
    const body = JSON.stringify(event);
    const signature = await hmacSha256Hex(body, secret);

    const app = createTestApp(null);
    const res = await requestWithEnv(
      app,
      '/api/webhooks/creem',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'creem-signature': signature,
        },
        body,
      },
      { CREEM_WEBHOOK_SECRET: secret },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { received: boolean };
    expect(json.received).toBe(true);

    const user = usersStore.find((u) => u.id === 'user-123');
    expect(user?.subscription_status).toBe('active');
    expect(user?.payment_subscription_id).toBe('sub_123');
  });
});
