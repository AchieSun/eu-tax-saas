import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDb } from '../../db';
import { users } from '../../db/schema';
import {
  getCreemClient,
  verifyCreemRedirectSignature,
  verifyCreemWebhookSignature,
} from '../../payment/creem';
import type { Bindings, Variables } from '../index';

function requireSession(c: {
  get: (key: 'session') => { user: { id: string } } | undefined;
}): { userId: string } | null {
  const userId = c.get('session')?.user?.id;
  return userId ? { userId } : null;
}

interface CheckoutResult {
  checkoutUrl: string;
}

async function buildCheckout(
  env: Bindings,
  userId: string,
  plan: 'monthly' | 'annual',
): Promise<CheckoutResult> {
  const productId = plan === 'annual' ? env.CREEM_YEARLY_PRODUCT_ID : env.CREEM_MONTHLY_PRODUCT_ID;
  if (!productId) {
    throw new Error(`product_not_configured:${plan}`);
  }

  const apiKey = env.CREEM_API_KEY;
  if (!apiKey) {
    throw new Error('creem_not_configured');
  }

  const environment: 'test' | 'production' =
    env.ENVIRONMENT === 'production' ? 'production' : 'test';
  const client = getCreemClient(apiKey, environment);

  const checkout = await client.createCheckout({
    productId,
    successUrl: `${env.APP_URL}/api/payment/success`,
    requestId: userId,
    metadata: { userId, plan },
  });

  return { checkoutUrl: checkout.checkout_url };
}

function renderSuccessHtml(options: {
  title: string;
  heading: string;
  message: string;
}): string {
  const { title, heading, message } = options;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 600px; margin: 4rem auto; padding: 0 1rem; color: #0f172a; }
    h1 { font-size: 1.75rem; }
    p { color: #475569; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <h1>${heading}</h1>
  <p>${message}</p>
  <p><a href="/">Back to home</a></p>
</body>
</html>`;
}

export const paymentRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

paymentRoutes.post('/checkout', async (c) => {
  const session = requireSession(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const plan = body.plan === 'annual' ? 'annual' : 'monthly';

  try {
    const result = await buildCheckout(c.env, session.userId, plan);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'checkout_failed';
    if (message.startsWith('product_not_configured:')) {
      const failedPlan = message.split(':')[1];
      return c.json({ error: 'product_not_configured', plan: failedPlan }, 500);
    }
    return c.json({ error: message }, 500);
  }
});

// Dev-only bypass for local checkout smoke tests; guarded against production below.
paymentRoutes.get('/test-checkout', async (c) => {
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'not_available_in_production' }, 403);
  }

  const plan = c.req.query('plan') === 'annual' ? 'annual' : 'monthly';
  try {
    const result = await buildCheckout(c.env, 'dev-test-user', plan);
    return c.redirect(result.checkoutUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'checkout_failed';
    return c.json({ error: message }, 500);
  }
});

paymentRoutes.get('/success', async (c) => {
  const apiKey = c.env.CREEM_API_KEY;
  if (!apiKey) {
    return c.html(
      renderSuccessHtml({
        title: 'Payment Error · Taxmora',
        heading: 'Configuration error',
        message: 'Payment provider is not configured. Please contact support.',
      }),
      500,
    );
  }

  const isValid = await verifyCreemRedirectSignature(c.req.url, apiKey);
  if (!isValid) {
    return c.html(
      renderSuccessHtml({
        title: 'Payment Error · Taxmora',
        heading: 'Invalid redirect',
        message:
          'We could not verify this payment redirect. Please contact support if you were charged.',
      }),
      401,
    );
  }

  const requestId = c.req.query('request_id');
  const subscriptionId = c.req.query('subscription_id');
  const customerId = c.req.query('customer_id');

  if (!requestId || !subscriptionId) {
    return c.html(
      renderSuccessHtml({
        title: 'Payment Error · Taxmora',
        heading: 'Missing payment details',
        message: 'Some payment details are missing. Please contact support.',
      }),
      400,
    );
  }

  try {
    const db = createDb(c.env.DB);
    await db
      .update(users)
      .set({
        subscriptionStatus: 'active',
        paymentProvider: 'creem',
        paymentSubscriptionId: subscriptionId,
        paymentCustomerId: customerId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, requestId));

    return c.html(
      renderSuccessHtml({
        title: 'Welcome to Taxmora Pro',
        heading: 'Payment successful',
        message: 'Your subscription is now active. You can start using Taxmora Pro features.',
      }),
    );
  } catch (error) {
    console.error('Failed to update subscription after payment', error);
    return c.html(
      renderSuccessHtml({
        title: 'Payment Error · Taxmora',
        heading: 'Payment received',
        message:
          'We received your payment but could not activate your account automatically. Please contact support.',
      }),
      500,
    );
  }
});

export const creemWebhookRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function resolveStatusFromEvent(eventType: string): 'active' | 'cancelled' | 'past_due' | null {
  switch (eventType) {
    case 'subscription.paid':
    case 'subscription.active':
    case 'subscription.trialing':
    case 'subscription.update':
      return 'active';
    case 'subscription.canceled':
    case 'subscription.expired':
    case 'subscription.paused':
      return 'cancelled';
    case 'subscription.past_due':
      return 'past_due';
    default:
      return null;
  }
}

function extractUserIdFromEvent(event: Record<string, unknown>): string | null {
  const metadata =
    typeof event.metadata === 'object' && event.metadata !== null
      ? (event.metadata as Record<string, unknown>)
      : null;
  if (typeof metadata?.userId === 'string') return metadata.userId;

  const data =
    typeof event.data === 'object' && event.data !== null
      ? (event.data as Record<string, unknown>)
      : null;
  const dataMetadata =
    typeof data?.metadata === 'object' && data.metadata !== null
      ? (data.metadata as Record<string, unknown>)
      : null;
  if (typeof dataMetadata?.userId === 'string') return dataMetadata.userId;

  return null;
}

function extractSubscriptionIdFromEvent(event: Record<string, unknown>): string | null {
  const data =
    typeof event.data === 'object' && event.data !== null
      ? (event.data as Record<string, unknown>)
      : null;
  const subscription =
    typeof data?.subscription === 'object' && data.subscription !== null
      ? (data.subscription as Record<string, unknown>)
      : null;
  if (typeof subscription?.id === 'string') return subscription.id;
  if (typeof data?.subscription_id === 'string') return data.subscription_id;
  return null;
}

function extractCustomerIdFromEvent(event: Record<string, unknown>): string | null {
  const data =
    typeof event.data === 'object' && event.data !== null
      ? (event.data as Record<string, unknown>)
      : null;
  const customer =
    typeof data?.customer === 'object' && data.customer !== null
      ? (data.customer as Record<string, unknown>)
      : null;
  if (typeof customer?.id === 'string') return customer.id;
  if (typeof data?.customer_id === 'string') return data.customer_id;
  return null;
}

creemWebhookRoutes.post('/creem', async (c) => {
  const secret = c.env.CREEM_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('CREEM_WEBHOOK_SECRET not configured');
    return c.json({ error: 'not_configured' }, 500);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header('creem-signature');

  const isValid = await verifyCreemWebhookSignature(rawBody, signature, secret);
  if (!isValid) {
    return c.json({ error: 'invalid_signature' }, 401);
  }

  const event = JSON.parse(rawBody) as Record<string, unknown>;
  const eventType = typeof event.event_type === 'string' ? event.event_type : 'unknown';
  console.info('Creem webhook received', { eventType });

  const status = resolveStatusFromEvent(eventType);
  if (!status) {
    return c.json({ received: true, ignored: true });
  }

  const userId = extractUserIdFromEvent(event);
  const subscriptionId = extractSubscriptionIdFromEvent(event);
  const customerId = extractCustomerIdFromEvent(event);

  if (!userId || !subscriptionId) {
    console.warn('Webhook missing userId or subscriptionId', { eventType, userId, subscriptionId });
    return c.json({ received: true, ignored: true });
  }

  try {
    const db = createDb(c.env.DB);
    await db
      .update(users)
      .set({
        subscriptionStatus: status,
        paymentProvider: 'creem',
        paymentSubscriptionId: subscriptionId,
        paymentCustomerId: customerId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return c.json({ received: true });
  } catch (error) {
    console.error('Failed to process Creem webhook', error);
    return c.json({ error: 'database_error' }, 500);
  }
});
