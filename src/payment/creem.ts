/**
 * Lightweight Creem REST client for Cloudflare Workers.
 *
 * We use `fetch` directly instead of the official `creem` Node SDK to avoid
 * Node-runtime dependencies and keep the Worker bundle small.
 */

const CREEM_API_BASE = {
  test: 'https://test-api.creem.io/v1',
  production: 'https://api.creem.io/v1',
} as const;

export interface CreemCheckoutInput {
  productId: string;
  successUrl: string;
  requestId?: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

export interface CreemCheckout {
  id: string;
  checkout_url: string;
  status: string;
}

export interface CreemCancelSubscriptionInput {
  subscriptionId: string;
  mode?: 'immediate' | 'scheduled';
  onExecute?: 'cancel' | 'pause';
}

export interface CreemSubscription {
  id: string;
  status: string;
  canceled_at?: string | null;
  current_period_end_date?: string;
}

export interface CreemClient {
  createCheckout(input: CreemCheckoutInput): Promise<CreemCheckout>;
  cancelSubscription(input: CreemCancelSubscriptionInput): Promise<CreemSubscription>;
}

export function getCreemClient(
  apiKey: string,
  environment: 'test' | 'production' = 'test',
): CreemClient {
  const baseUrl = CREEM_API_BASE[environment];

  async function request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      throw new Error(`Creem API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    createCheckout: (input): Promise<CreemCheckout> =>
      request('/checkouts', {
        method: 'POST',
        body: {
          product_id: input.productId,
          success_url: input.successUrl,
          ...(input.requestId ? { request_id: input.requestId } : {}),
          ...(input.customerEmail ? { customer: { email: input.customerEmail } } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      }),

    cancelSubscription: (input): Promise<CreemSubscription> =>
      request(`/subscriptions/${input.subscriptionId}/cancel`, {
        method: 'POST',
        body: {
          mode: input.mode ?? 'scheduled',
          ...(input.onExecute ? { onExecute: input.onExecute } : {}),
        },
      }),
  };
}

/**
 * Verify a Creem redirect URL signature.
 *
 * Creem appends a `signature` query parameter to the success_url after a
 * checkout completes. The signature is the lowercase-hex SHA-256 of a
 * canonical string built from the other query parameters (in URL order,
 * excluding empty values) followed by `salt={apiKey}`.
 *
 * @see https://docs.creem.io/features/checkout/checkout-api
 */
export async function verifyCreemRedirectSignature(
  requestUrl: string,
  apiKey: string,
): Promise<boolean> {
  const parsed = new URL(requestUrl);
  const signature = parsed.searchParams.get('signature');
  if (!signature || !apiKey) return false;

  const parts: string[] = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (key === 'signature') continue;
    if (value === '' || value === null || value === undefined) continue;
    parts.push(`${key}=${value}`);
  }
  parts.push(`salt=${apiKey}`);

  const canonical = parts.join('|');
  const encoder = new TextEncoder();
  const digestBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  const expectedSignature = Array.from(new Uint8Array(digestBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify a Creem webhook signature.
 *
 * The header name is `creem-signature` and the expected value is the
 * lowercase-hex HMAC-SHA256 of the raw request body, keyed by the webhook
 * secret shown in Dashboard → Developers → Webhooks.
 */
export async function verifyCreemWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return result === 0;
}
