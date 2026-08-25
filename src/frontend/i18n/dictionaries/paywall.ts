/**
 * PaywallCard 字典 — 共享升级卡片（F3/F4 Pro 门禁）。
 *
 * 402 的服务端 message（订阅后解锁完整功能）为中文常量，前端不展示原文，
 * 一律用本地错误码映射文案（strategies/filing 字典的 *.error.* 键）覆盖。
 * pro.sub 的 <strong>Taxmora Pro</strong> 拆为前缀/后缀两个 key，JSX 保住加粗。
 */
import type { BilingualDictionary } from './index';

export const paywallDict: BilingualDictionary = {
  zh: {
    'paywall.card.ariaLabel': 'Pro 功能已锁定',
    'paywall.signedOut.sub': '登录后即可升级解锁此功能。',
    'paywall.signedOut.button': '登录 / 注册',
    'paywall.pro.subPrefix': '此功能为',
    'paywall.pro.subSuffix': '会员专属。升级后解锁：',
    'paywall.pro.checkingOut': '正在跳转支付…',
    'paywall.pro.upgrade': '升级到 Pro',
    'paywall.pro.note': '由 Creem 安全处理支付 · 可随时在账户页取消',
    'paywall.error.unauthorized': '请先登录后再升级。',
    'paywall.error.checkoutFailed': '无法发起支付 ({message}). 请稍后重试或联系支持.',
  },
  en: {
    'paywall.card.ariaLabel': 'Pro feature locked',
    'paywall.signedOut.sub': 'Sign in to upgrade and unlock this feature.',
    'paywall.signedOut.button': 'Sign in / Sign up',
    'paywall.pro.subPrefix': 'This feature is exclusive to',
    'paywall.pro.subSuffix': '— upgrade to unlock:',
    'paywall.pro.checkingOut': 'Redirecting to checkout…',
    'paywall.pro.upgrade': 'Upgrade to Pro',
    'paywall.pro.note': 'Payments handled securely by Creem · cancel anytime from Account',
    'paywall.error.unauthorized': 'Please sign in before upgrading.',
    'paywall.error.checkoutFailed':
      'Could not start checkout ({message}). Please retry later or contact support.',
  },
};
