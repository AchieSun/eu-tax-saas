/**
 * paywall/api.ts — shared frontend client for subscription state + checkout.
 *
 * One module so every Pro-gated surface (F3 FilingDraftView watermark-free
 * PDF, F4 StrategiesPage full report, AccountPage upgrade CTA) resolves
 * "is this caller Pro?" and "start checkout" the exact same way:
 *
 *   - GET /api/me → { userId, role, subscriptionStatus } (401 → null session)
 *   - POST /api/payment/checkout { plan } → { checkoutUrl } (Creem hosted flow)
 *
 * Wire contract mirrors src/api/middleware/subscription.ts:
 *   Pro = role==='admin' || subscriptionStatus==='active'
 *   402 { error:'subscription_required', feature, subscriptionStatus }
 */

const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' } as const;

export interface MeInfo {
  userId: string;
  role: string;
  subscriptionStatus: 'free' | 'active' | 'cancelled' | 'past_due' | string;
}

export type SubscriptionPlan = 'monthly' | 'annual';

// NOTE (t3 followup): the 402 error class lives in
// src/frontend/pages/strategies/api.ts (SubscriptionRequiredError) — it is
// thrown by aiRecommendStrategies, the only endpoint whose 402 the UI needs
// to branch on structurally. Kept single-sourced there; do not re-add a
// duplicate here.

/**
 * Fetch the session echo. Returns null when signed out (401) — callers
 * render the signed-out state instead of an error banner.
 */
export async function fetchMe(): Promise<MeInfo | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'include', headers: { ...XHR_HEADERS } });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      userId?: string;
      role?: string;
      subscriptionStatus?: string;
    };
    if (!body.userId) return null;
    return {
      userId: body.userId,
      role: body.role ?? 'user',
      subscriptionStatus: body.subscriptionStatus ?? 'free',
    };
  } catch {
    return null;
  }
}

/** Mirror of the backend isPro() — single source of truth is the users row. */
export function isPro(me: MeInfo | null | undefined): boolean {
  if (!me) return false;
  return me.role === 'admin' || me.subscriptionStatus === 'active';
}

/**
 * Start a Creem hosted checkout for the given plan. Resolves with the
 * external checkoutUrl the caller should `window.location.assign` to.
 * Throws Error with the backend `error` code on failure.
 */
export async function startCheckout(plan: SubscriptionPlan): Promise<string> {
  const res = await fetch('/api/payment/checkout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify({ plan }),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) {
    let code = `checkout_failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) code = body.error;
    } catch {
      // keep status fallback
    }
    throw new Error(code);
  }
  const body = (await res.json()) as { checkoutUrl?: string };
  if (!body.checkoutUrl) throw new Error('checkout_failed');
  return body.checkoutUrl;
}
