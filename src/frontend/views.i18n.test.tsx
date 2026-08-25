/**
 * View-level i18n tests — FilingDraftView / CalendarView / CompareView /
 * PaywallCard share the same dictionary aggregation, so a compact per-view
 * suite keeps each page covered by at least one EN assertion without a DOM
 * environment (vitest runs under `node`).
 */
import { describe, expect, it } from 'vitest';
import CalendarView from './CalendarView';
import CompareView from './CompareView';
import FilingDraftView from './FilingDraftView';
import CountryPalette from './calendar/CountryPalette';
import MonthGrid from './calendar/MonthGrid';
import { setLocale, t } from './i18n';
import PaywallCard from './paywall/PaywallCard';

describe('view components export', () => {
  it('each view is a valid Solid component', () => {
    expect(typeof CalendarView).toBe('function');
    expect(typeof CompareView).toBe('function');
    expect(typeof FilingDraftView).toBe('function');
    expect(typeof PaywallCard).toBe('function');
    expect(typeof CountryPalette).toBe('function');
    expect(typeof MonthGrid).toBe('function');
  });
});

describe('FilingDraftView i18n', () => {
  it('switches copy between zh and en locales', () => {
    setLocale('zh');
    expect(t('filing.title')).toBe('税务草稿生成 (Filing Draft)');
    expect(t('filing.action.generate')).toBe('生成草稿 PDF');

    setLocale('en');
    expect(t('filing.title')).toBe('Filing draft (PDF)');
    expect(t('filing.action.generate')).toBe('Generate Draft PDF');
  });

  it('interpolates the rate-limit retry hint', () => {
    setLocale('zh');
    expect(t('filing.error.rateLimited', { retryAfter: '60' })).toContain('60');
    setLocale('en');
    expect(t('filing.error.rateLimited', { retryAfter: '60' })).toBe(
      'Daily generation limit reached (10/day). Retry in 60s.',
    );
  });
});

describe('CalendarView i18n', () => {
  it('switches copy between zh and en locales', () => {
    setLocale('zh');
    expect(t('calendar.title')).toBe('居留日历 · 标记每日所在国家');
    expect(t('calendar.month.0')).toBe('一月');
    expect(t('calendar.weekday.0')).toBe('一');
    expect(t('calendar.country.DE')).toBe('德国 DE');

    setLocale('en');
    expect(t('calendar.title')).toBe('Residency calendar · mark your daily country');
    expect(t('calendar.month.0')).toBe('January');
    expect(t('calendar.weekday.0')).toBe('Mo');
    expect(t('calendar.country.DE')).toBe('Germany DE');
  });

  it('interpolates the day counter', () => {
    setLocale('zh');
    expect(t('calendar.counter', { marked: 3, total: 31 })).toBe('已标记 3 天 / 共 31 天');
    setLocale('en');
    expect(t('calendar.counter', { marked: 3, total: 31 })).toBe('3 of 31 days marked');
  });
});

describe('CompareView i18n', () => {
  it('switches copy between zh and en locales (reverse bilingualization)', () => {
    setLocale('zh');
    expect(t('compare.title')).toBe('比较你在 5 个欧洲国家的税负');
    expect(t('compare.card.lowestTax')).toBe('税负最低');
    expect(t('compare.country.ES')).toBe('西班牙（马德里）');

    setLocale('en');
    expect(t('compare.title')).toBe('Compare your tax across 5 European countries');
    expect(t('compare.card.lowestTax')).toBe('Lowest tax');
    expect(t('compare.country.ES')).toBe('Spain (Madrid)');
  });
});

describe('PaywallCard i18n', () => {
  it('switches copy between zh and en locales', () => {
    setLocale('zh');
    expect(t('paywall.pro.upgrade')).toBe('升级到 Pro');
    expect(t('paywall.signedOut.button')).toBe('登录 / 注册');

    setLocale('en');
    expect(t('paywall.pro.upgrade')).toBe('Upgrade to Pro');
    expect(t('paywall.signedOut.button')).toBe('Sign in / Sign up');
  });

  it('covers the 402 checkout error locally instead of the server message', () => {
    setLocale('zh');
    expect(t('paywall.error.checkoutFailed', { message: 'X' })).toContain('无法发起支付');
    setLocale('en');
    expect(t('paywall.error.checkoutFailed', { message: 'X' })).toContain(
      'Could not start checkout',
    );
  });
});
