/**
 * paywall/PaywallCard.tsx — shared upgrade prompt shown when a Pro feature
 * is locked (F3 watermark-free PDF, F4 full strategy report).
 *
 * States:
 *   - signed out            → login prompt (redirects to #account)
 *   - signed in, not Pro    → upgrade CTA that starts Creem checkout
 *   - checkout failed       → error banner with retry
 *
 * Styling follows DESIGN.md: white card, default border, 12px radius, blue
 * primary CTA, danger palette only for the error banner.
 */

import { type Component, For, Show, createSignal } from 'solid-js';
import { type MeInfo, isPro, startCheckout } from './api';

export interface PaywallCardProps {
  /** Signed-in state; null = signed out. */
  me: MeInfo | null;
  /** Feature title shown in the card heading, e.g. '无水印 PDF 生成'. */
  title: string;
  /** Feature bullets describing what upgrading unlocks. */
  bullets: string[];
  /** Called after a successful checkout redirect handoff (unused today). */
  onNavigate?: () => void;
}

const PaywallCard: Component<PaywallCardProps> = (props) => {
  const [checkingOut, setCheckingOut] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const pro = () => isPro(props.me);

  const onUpgrade = async () => {
    setError(null);
    setCheckingOut(true);
    try {
      const url = await startCheckout('monthly');
      // Creem hosts the payment page; success returns to /api/payment/success
      // which activates the subscription and renders a confirmation page.
      window.location.assign(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg === 'UNAUTHORIZED'
          ? '请先登录后再升级 (Please sign in first).'
          : `无法发起支付 (${msg}). 请稍后重试或联系支持.`,
      );
    } finally {
      setCheckingOut(false);
    }
  };

  const onLogin = () => {
    props.onNavigate?.();
    window.location.hash = 'account';
  };

  return (
    <div class="pw-card" role="region" aria-label="Pro feature locked">
      <div class="pw-badge">PRO</div>
      <h3 class="pw-title">{props.title}</h3>
      <Show
        when={props.me !== null}
        fallback={
          <>
            <p class="pw-sub">登录后即可升级解锁此功能。</p>
            <button type="button" class="pw-btn" onClick={() => onLogin()}>
              登录 / 注册
            </button>
          </>
        }
      >
        <p class="pw-sub">
          此功能为 <strong>Taxmora Pro</strong> 会员专属。升级后解锁：
        </p>
        <ul class="pw-list">
          <For each={props.bullets}>{(b) => <li>{b}</li>}</For>
        </ul>
        <Show when={!pro()}>
          <button
            type="button"
            class="pw-btn"
            onClick={() => void onUpgrade()}
            disabled={checkingOut()}
          >
            {checkingOut() ? '正在跳转支付…' : '升级到 Pro'}
          </button>
          <p class="pw-note">由 Creem 安全处理支付 · 可随时在账户页取消</p>
        </Show>
      </Show>
      <Show when={error()}>
        <div class="pw-error" role="alert">
          {error()}
        </div>
      </Show>
    </div>
  );
};

export default PaywallCard;

export const paywallStyles = `
.pw-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  max-width: 480px;
}
.pw-badge {
  display: inline-block;
  background: #eff6ff;
  color: #2563eb;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  margin-bottom: 0.75rem;
}
.pw-title {
  margin: 0 0 0.5rem;
  font-size: 1.125rem;
  font-weight: 700;
  color: #111827;
}
.pw-sub { margin: 0 0 0.75rem; font-size: 0.9rem; color: #374151; line-height: 1.5; }
.pw-list {
  margin: 0 0 1rem;
  padding-left: 1.25rem;
  font-size: 0.875rem;
  color: #374151;
  line-height: 1.6;
}
.pw-list li { margin-bottom: 0.25rem; }
.pw-btn {
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  padding: 0.625rem 1.25rem;
  min-height: 40px;
  cursor: pointer;
  transition: background-color 150ms, opacity 150ms;
}
.pw-btn:hover:not(:disabled) { background: #1d4ed8; }
.pw-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.pw-note { margin: 0.5rem 0 0; font-size: 0.75rem; color: #9ca3af; }
.pw-error {
  margin-top: 0.75rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  border-radius: 8px;
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
}
`;
