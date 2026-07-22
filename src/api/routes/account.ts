import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDb } from '../../db';
import { users } from '../../db/schema';
import { getCreemClient } from '../../payment/creem';
import type { Bindings, Variables } from '../index';

function requireSession(c: {
  get: (key: 'session') => { user: { id: string } } | undefined;
}): { userId: string } | null {
  const userId = c.get('session')?.user?.id;
  return userId ? { userId } : null;
}

export const accountRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

accountRoutes.get('/', async (c) => {
  const session = requireSession(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);

  const db = createDb(c.env.DB);
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      subscriptionStatus: users.subscriptionStatus,
      paymentProvider: users.paymentProvider,
      paymentSubscriptionId: users.paymentSubscriptionId,
      paymentCustomerId: users.paymentCustomerId,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) return c.json({ error: 'user_not_found' }, 404);

  return c.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      subscriptionStatus: user.subscriptionStatus,
      paymentProvider: user.paymentProvider,
      paymentSubscriptionId: user.paymentSubscriptionId,
      paymentCustomerId: user.paymentCustomerId,
    },
  });
});

accountRoutes.post('/cancel', async (c) => {
  const session = requireSession(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);

  const db = createDb(c.env.DB);
  const [user] = await db
    .select({
      paymentSubscriptionId: users.paymentSubscriptionId,
      paymentProvider: users.paymentProvider,
      subscriptionStatus: users.subscriptionStatus,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) return c.json({ error: 'user_not_found' }, 404);
  if (user.subscriptionStatus !== 'active') {
    return c.json({ error: 'no_active_subscription' }, 400);
  }
  if (!user.paymentSubscriptionId) {
    return c.json({ error: 'subscription_id_missing' }, 400);
  }
  if (user.paymentProvider !== 'creem') {
    return c.json({ error: 'unsupported_payment_provider' }, 400);
  }

  const apiKey = c.env.CREEM_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'creem_not_configured' }, 500);
  }

  const environment: 'test' | 'production' =
    c.env.ENVIRONMENT === 'production' ? 'production' : 'test';
  const client = getCreemClient(apiKey, environment);

  try {
    const cancelled = await client.cancelSubscription({
      subscriptionId: user.paymentSubscriptionId,
      mode: 'scheduled',
      onExecute: 'cancel',
    });

    await db
      .update(users)
      .set({
        subscriptionStatus: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(users.id, session.userId));

    return c.json({
      ok: true,
      subscription: {
        id: cancelled.id,
        status: cancelled.status,
        canceledAt: cancelled.canceled_at ?? null,
        currentPeriodEnd: cancelled.current_period_end_date ?? null,
      },
    });
  } catch (error) {
    console.error('Failed to cancel Creem subscription', error);
    const message = error instanceof Error ? error.message : 'cancel_failed';
    return c.json({ error: message }, 500);
  }
});
