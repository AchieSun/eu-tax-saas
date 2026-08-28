/**
 * i18n 基建测试 — locale signal 初值/持久化、回退逻辑、插值、useI18n。
 *
 * vitest 环境是 node（见 vitest.config.ts），没有真实 window/document —
 * 正好天然覆盖 SSR 安全分支。带 DOM 的用例显式 stub window/localStorage/navigator。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LOCALE_STORAGE_KEY = 'taxmora-locale';

describe('detectInitialLocale', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns en when window is undefined (SSR-safe)', async () => {
    vi.stubGlobal('window', undefined);
    const { detectInitialLocale } = await import('./index');

    expect(detectInitialLocale()).toBe('en');
  });

  it('returns stored locale from localStorage', async () => {
    const storage = new Map<string, string>([[LOCALE_STORAGE_KEY, 'en']]);
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
      },
    });
    const { detectInitialLocale } = await import('./index');

    expect(detectInitialLocale()).toBe('en');
  });

  it('defaults to en when nothing is stored (no navigator sniffing)', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
      },
    });
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    const { detectInitialLocale } = await import('./index');

    expect(detectInitialLocale()).toBe('en');

    vi.resetModules();
    vi.stubGlobal('navigator', { language: 'en-US' });
    const fresh = await import('./index');

    expect(fresh.detectInitialLocale()).toBe('en');
  });

  it('returns en when localStorage throws (private mode)', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('quota');
        },
        setItem: () => {
          throw new Error('quota');
        },
      },
    });
    const { detectInitialLocale } = await import('./index');

    expect(detectInitialLocale()).toBe('en');
  });
});

describe('t() translation + fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('translates known keys in both locales', async () => {
    const { t, setLocale } = await import('./index');

    setLocale('zh');
    expect(t('app.tab.dashboard')).toBe('仪表盘');
    setLocale('en');
    expect(t('app.tab.dashboard')).toBe('Dashboard');
  });

  it('interpolates {name} params', async () => {
    const { t, setLocale } = await import('./index');

    setLocale('zh');
    expect(t('dashboard.welcomeName', { name: 'Sun' })).toBe('欢迎回来，Sun');
    setLocale('en');
    expect(t('dashboard.welcomeName', { name: 'Sun' })).toBe('Welcome back, Sun');
  });

  it('falls back to zh and warns once for keys missing in en', async () => {
    const { messages } = await import('./dictionaries');
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { t, setLocale } = await import('./index');

    // 注入一个 zh-only key（模拟 en 字典缺 key）
    (messages.zh as Record<string, string | undefined>).__testZhOnly = '中文兜底';
    try {
      setLocale('en');
      expect(t('__testZhOnly')).toBe('中文兜底');
      expect(warnMock).toHaveBeenCalledTimes(1);
      expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('__testZhOnly'));

      // 第二次调用不再告警（一次性去重）
      expect(t('__testZhOnly')).toBe('中文兜底');
      expect(warnMock).toHaveBeenCalledTimes(1);
    } finally {
      (messages.zh as Record<string, string | undefined>).__testZhOnly = undefined;
      warnMock.mockRestore();
    }
  });

  it('returns the key itself when missing in both locales', async () => {
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { t } = await import('./index');

    expect(t('definitely.not.a.key')).toBe('definitely.not.a.key');
    warnMock.mockRestore();
  });

  it('keeps interpolation params untouched when a placeholder has no value', async () => {
    const { setLocale, t } = await import('./index');
    // Default locale is now 'en'; pin 'zh' so this asserts the zh template itself.
    setLocale('zh');

    expect(t('dashboard.welcomeName')).toBe('欢迎回来，{name}');
    setLocale('en');
  });
});

describe('setLocale persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists to localStorage and updates <html lang>', async () => {
    const storage = new Map<string, string>();
    const htmlElement = { lang: '' };
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
      },
    });
    vi.stubGlobal('document', { documentElement: htmlElement });
    const { setLocale } = await import('./index');

    setLocale('en');
    expect(storage.get(LOCALE_STORAGE_KEY)).toBe('en');
    expect(htmlElement.lang).toBe('en');

    setLocale('zh');
    expect(storage.get(LOCALE_STORAGE_KEY)).toBe('zh');
    expect(htmlElement.lang).toBe('zh-CN');
  });

  it('still switches the signal when localStorage is unavailable', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    });
    const { locale, setLocale, t } = await import('./index');

    setLocale('en');
    expect(locale()).toBe('en');
    expect(t('app.tab.dashboard')).toBe('Dashboard');
  });
});

describe('useI18n', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('exposes t / locale / setLocale consistently', async () => {
    const { useI18n } = await import('./index');

    const i18n = useI18n();
    expect(typeof i18n.t).toBe('function');
    expect(typeof i18n.locale).toBe('function');
    expect(typeof i18n.setLocale).toBe('function');

    i18n.setLocale('en');
    expect(i18n.locale()).toBe('en');
    expect(i18n.t('app.tab.account')).toBe('Account');
  });
});

describe('dictionary consistency', () => {
  it('zh and en core dictionaries share the same key set', async () => {
    const { messages } = await import('./dictionaries');

    const zhKeys = Object.keys(messages.zh)
      .filter((key) => messages.zh[key] !== undefined)
      .sort();
    const enKeys = Object.keys(messages.en)
      .filter((key) => messages.en[key] !== undefined)
      .sort();
    expect(enKeys).toEqual(zhKeys);
    expect(zhKeys.length).toBeGreaterThan(50);
  });

  it('exposes registeredDictionaries for page dictionary extension', async () => {
    const { registeredDictionaries, messages } = await import('./dictionaries');

    expect(registeredDictionaries.length).toBeGreaterThanOrEqual(1);
    expect(messages.zh['app.tab.dashboard']).toBe('仪表盘');
    expect(messages.en['app.tab.dashboard']).toBe('Dashboard');
  });

  it('resolves every app.tab.* key consumed by the App shell', async () => {
    const { t, setLocale } = await import('./index');
    const tabs = [
      'onboarding',
      'dashboard',
      'compare',
      'calendar',
      'filing',
      'residency',
      'strategies',
      'rag',
      'deadlines',
      'account',
    ];

    for (const tab of tabs) {
      const key = `app.tab.${tab}`;
      setLocale('zh');
      expect(t(key)).not.toBe(key);
      setLocale('en');
      expect(t(key)).not.toBe(key);
    }
  });
});
