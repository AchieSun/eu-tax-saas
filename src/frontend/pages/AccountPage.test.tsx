/**
 * AccountPage tests - 升级区单一 €29/年创始价 CTA（t7）。
 *
 * t7 之前升级区有月付/年付两个按钮（月付指向已废弃的 €10 月付价位）；
 * 现移除月付按钮，只保留一个年付 CTA，文案对齐创始价单一叙事。
 * vitest 跑在 node 环境（无 DOM），按项目惯例做模块级导出断言 +
 * 字典断言（与 DeadlinesPage.test.tsx / views.i18n.test.tsx 同构）。
 */
import { describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../i18n';
import { messages } from '../i18n/dictionaries';
import AccountPage from './AccountPage';

describe('AccountPage component', () => {
  it('exports a default Solid component', () => {
    expect(typeof AccountPage).toBe('function');
  });
});

describe('AccountPage upgrade CTA i18n (€29 founding-price narrative)', () => {
  it('renders the single annual CTA with founding-price copy in both locales', () => {
    setLocale('zh');
    expect(t('account.upgrade.title')).toBe('升级到 Taxmora Pro');
    expect(t('account.upgrade.subtitle')).toBe('解锁无水印 PDF 税表生成与完整 AI 策略报告。');
    expect(t('account.upgrade.annual')).toBe('升级 Pro - €29/年创始价，锁定永久');
    expect(t('account.upgrade.redirecting')).toBe('跳转中…');

    setLocale('en');
    expect(t('account.upgrade.title')).toBe('Upgrade to Taxmora Pro');
    expect(t('account.upgrade.subtitle')).toBe(
      'Unlock watermark-free PDF tax forms and full AI strategy reports.',
    );
    expect(t('account.upgrade.annual')).toBe('Get the founding price - €29/year');
    expect(t('account.upgrade.redirecting')).toBe('Redirecting…');
  });

  it('drops the retired monthly plan key from both dictionaries', () => {
    // 月付按钮已删除 - 字典中不应再存在该 key（zh/en key 集合一致性由
    // i18n/index.test.ts 校验，这里锁定月付 key 本身已退役）。
    expect(messages.zh['account.upgrade.monthly']).toBeUndefined();
    expect(messages.en['account.upgrade.monthly']).toBeUndefined();

    // 两本字典都缺失时 t() 回显 key 本身（静默 warn 一次性提示）。
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(t('account.upgrade.monthly')).toBe('account.upgrade.monthly');
    } finally {
      warnMock.mockRestore();
    }
  });

  it('keeps upgrade error copy resolvable in both locales', () => {
    setLocale('zh');
    expect(t('account.upgrade.errorLogin')).toBe('请先登录后再升级。');
    expect(t('account.upgrade.errorGeneric', { message: 'X' })).toContain('X');

    setLocale('en');
    expect(t('account.upgrade.errorLogin')).toBe('Please sign in before upgrading.');
    expect(t('account.upgrade.errorGeneric', { message: 'X' })).toContain('X');
  });

  it('resolves every subscription status label the page renders', () => {
    const statuses = ['free', 'active', 'cancelled', 'past_due'] as const;

    for (const status of statuses) {
      const key = `account.status.${status}`;
      setLocale('zh');
      expect(t(key)).not.toBe(key);
      setLocale('en');
      expect(t(key)).not.toBe(key);
    }
  });
});
