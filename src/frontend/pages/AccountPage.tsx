import { type Component, Show, createResource, createSignal } from 'solid-js';
import { t } from '../i18n';
import { type SubscriptionPlan, startCheckout } from '../paywall/api';

interface AccountInfo {
  id: string;
  name: string;
  email: string;
  subscriptionStatus: 'free' | 'active' | 'cancelled' | 'past_due';
  paymentProvider: string | null;
  paymentSubscriptionId: string | null;
  paymentCustomerId: string | null;
}

interface CancelResult {
  id: string;
  status: string;
  canceledAt: string | null;
  currentPeriodEnd: string | null;
}

async function fetchAccount(): Promise<AccountInfo> {
  const res = await fetch('/api/account', { credentials: 'include' });
  if (res.status === 401) throw new Error(t('account.errors.loginRequired'));
  if (!res.ok) throw new Error(t('account.errors.fetchFailed', { status: res.status }));
  const body = (await res.json()) as { ok: boolean; user: AccountInfo };
  return body.user;
}

async function cancelSubscription(): Promise<CancelResult> {
  const res = await fetch('/api/account/cancel', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 401) throw new Error(t('account.errors.loginRequired'));
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? t('account.errors.cancelFailed', { status: res.status }));
  }
  const body = (await res.json()) as { ok: boolean; subscription: CancelResult };
  return body.subscription;
}

const statusLabel = (status: AccountInfo['subscriptionStatus']): string =>
  t(`account.status.${status}`);

const AccountPage: Component = () => {
  const [account, { refetch }] = createResource(fetchAccount);
  const [cancelling, setCancelling] = createSignal(false);
  const [cancelError, setCancelError] = createSignal<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = createSignal<CancelResult | null>(null);
  const [upgradingPlan, setUpgradingPlan] = createSignal<SubscriptionPlan | null>(null);
  const [upgradeError, setUpgradeError] = createSignal<string | null>(null);

  const onUpgrade = async (plan: SubscriptionPlan) => {
    setUpgradeError(null);
    setUpgradingPlan(plan);
    try {
      const url = await startCheckout(plan);
      window.location.assign(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUpgradeError(
        msg === 'UNAUTHORIZED'
          ? t('account.upgrade.errorLogin')
          : t('account.upgrade.errorGeneric', { message: msg }),
      );
    } finally {
      setUpgradingPlan(null);
    }
  };

  const onCancel = async () => {
    if (!confirm(t('account.cancel.confirm'))) return;
    setCancelling(true);
    setCancelError(null);
    setCancelSuccess(null);
    try {
      const result = await cancelSubscription();
      setCancelSuccess(result);
      await refetch();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div>
      <style>{styles}</style>

      <header class="acct-hero">
        <h1 class="acct-h1">{t('account.title')}</h1>
        <p class="acct-sub">{t('account.subtitle')}</p>
      </header>

      <Show when={account.loading}>
        <p class="acct-muted">{t('common.loading')}</p>
      </Show>

      <Show when={account.error}>
        <p class="acct-error">⚠️ {account.error.message}</p>
      </Show>

      <Show when={account()}>
        {(acc) => (
          <section class="acct-panel">
            <h2 class="acct-h2">{t('account.subscription.title')}</h2>

            <div class="acct-grid">
              <div class="acct-field">
                <span class="acct-label">{t('account.field.email')}</span>
                <span class="acct-value">{acc().email}</span>
              </div>
              <div class="acct-field">
                <span class="acct-label">{t('account.field.status')}</span>
                <span class={`acct-badge acct-badge-${acc().subscriptionStatus}`}>
                  {statusLabel(acc().subscriptionStatus)}
                </span>
              </div>
              <div class="acct-field">
                <span class="acct-label">{t('account.field.provider')}</span>
                <span class="acct-value">{acc().paymentProvider ?? t('account.none')}</span>
              </div>
              <div class="acct-field">
                <span class="acct-label">{t('account.field.subscriptionId')}</span>
                <span class="acct-value acct-mono">
                  {acc().paymentSubscriptionId ?? t('account.none')}
                </span>
              </div>
            </div>

            <Show when={acc().subscriptionStatus === 'active'}>
              <div class="acct-actions">
                <button
                  type="button"
                  class="acct-btn acct-btn-danger"
                  disabled={cancelling()}
                  onClick={() => void onCancel()}
                >
                  {cancelling() ? t('account.cancel.inProgress') : t('account.cancel.button')}
                </button>
              </div>
            </Show>

            <Show
              when={
                acc().subscriptionStatus !== 'active' && acc().subscriptionStatus !== 'past_due'
              }
            >
              <div class="acct-upgrade">
                <h3 class="acct-h3">{t('account.upgrade.title')}</h3>
                <p class="acct-upgrade-sub">{t('account.upgrade.subtitle')}</p>
                <div class="acct-upgrade-actions">
                  <button
                    type="button"
                    class="acct-btn acct-btn-primary"
                    disabled={upgradingPlan() !== null}
                    onClick={() => void onUpgrade('monthly')}
                  >
                    {upgradingPlan() === 'monthly'
                      ? t('account.upgrade.redirecting')
                      : t('account.upgrade.monthly')}
                  </button>
                  <button
                    type="button"
                    class="acct-btn acct-btn-outline"
                    disabled={upgradingPlan() !== null}
                    onClick={() => void onUpgrade('annual')}
                  >
                    {upgradingPlan() === 'annual'
                      ? t('account.upgrade.redirecting')
                      : t('account.upgrade.annual')}
                  </button>
                </div>
                <Show when={upgradeError()}>
                  <div class="acct-error" role="alert">
                    ⚠️ {upgradeError()}
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={cancelError()}>
              <p class="acct-error">⚠️ {cancelError()}</p>
            </Show>

            <Show when={cancelSuccess()}>
              <div class="acct-success">
                <p>{t('account.cancel.success.title')}</p>
                <p>
                  {t('account.cancel.success.until', {
                    date:
                      cancelSuccess()?.currentPeriodEnd ?? t('account.cancel.success.unknownDate'),
                  })}
                </p>
              </div>
            </Show>
          </section>
        )}
      </Show>
    </div>
  );
};

export default AccountPage;

const styles = `
.acct-hero { margin-bottom: 1.5rem; }
.acct-h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
.acct-sub { color: #6b7280; margin: 0; }
.acct-muted { color: #6b7280; }
.acct-error { color: #dc2626; }
.acct-panel {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem;
}
.acct-h2 { font-size: 1.125rem; margin: 0 0 1rem; }
.acct-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.acct-field { display: flex; flex-direction: column; gap: 0.25rem; }
.acct-label { font-size: 0.875rem; color: #6b7280; }
.acct-value { font-size: 0.95rem; color: #111827; word-break: break-all; }
.acct-mono { font-family: ui-monospace, monospace; font-size: 0.875rem; }
.acct-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
}
.acct-badge-free { background: #f3f4f6; color: #4b5563; }
.acct-badge-active { background: #d1fae5; color: #065f46; }
.acct-badge-cancelled { background: #fee2e2; color: #991b1b; }
.acct-badge-past_due { background: #fef3c7; color: #92400e; }
.acct-actions { margin-top: 0.5rem; }
.acct-btn {
  padding: 0.625rem 1rem;
  border-radius: 8px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.95rem;
}
.acct-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.acct-btn-danger { background: #dc2626; color: #fff; }
.acct-btn-danger:hover:not(:disabled) { background: #b91c1c; }
.acct-h3 { font-size: 1rem; margin: 0 0 0.5rem; font-weight: 700; color: #111827; }
.acct-upgrade {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid #e5e7eb;
}
.acct-upgrade-sub { margin: 0 0 0.875rem; color: #6b7280; font-size: 0.9rem; }
.acct-upgrade-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
.acct-btn-primary { background: #2563eb; color: #ffffff; }
.acct-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.acct-btn-outline {
  background: #ffffff;
  color: #2563eb;
  border: 1.5px solid #2563eb;
}
.acct-btn-outline:hover:not(:disabled) { background: #eff6ff; }
.acct-success {
  background: #d1fae5;
  border: 1px solid #a7f3d0;
  border-radius: 8px;
  padding: 1rem;
  color: #065f46;
}
`;
