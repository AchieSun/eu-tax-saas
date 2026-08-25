/**
 * i18n 基建 — 零依赖的轻量双语方案（zh / en）。
 *
 * - locale 是一个模块级 Solid signal：任何组件里读 t() 都天然响应式，
 *   setLocale 切换后全站文案即时更新，无需刷新。
 * - 初值：localStorage('taxmora-locale') → navigator.language 以 zh 开头 → 'zh'，
 *   否则 'en'。SSR 安全：window/localStorage/navigator 缺失时默认 'zh'。
 * - t(key, params)：查当前 locale 字典，缺失回退 zh 并对每个 key 仅
 *   console.warn 一次（开发期提示补翻译，运行时不再刷屏）。
 * - useI18n()：返回 { t, locale, setLocale }，组件内使用的统一入口。
 *
 * 字典聚合见 ./dictionaries/index.ts — 新页面字典按其注释扩展，不要另起炉灶。
 */
import { createSignal } from 'solid-js';
import { messages } from './dictionaries';

export type Locale = 'zh' | 'en';

export const LOCALE_STORAGE_KEY = 'taxmora-locale';

export const LOCALES: readonly Locale[] = ['zh', 'en'];

/** 插值参数：模板中的 {name} 占位符会被同名参数替换。 */
export type TranslateParams = Readonly<Record<string, string | number>>;

type LocaleSignal = [() => Locale, (next: Locale) => void];

function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en';
}

/** SSR 安全的持久化 locale 读取（localStorage / navigator 均可能不存在）。 */
export function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  try {
    const stored = window.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage 不可用（隐私模式等）— 落到 navigator 检测
  }
  const language =
    typeof navigator !== 'undefined' && typeof navigator.language === 'string'
      ? navigator.language
      : '';
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 模块级全局 locale signal — 整个 SPA 共享一个实例。 */
const [locale, setLocaleSignal]: LocaleSignal = createSignal<Locale>(detectInitialLocale());

/** 一次性警告集合：key 级去重，避免每次渲染重复告警。 */
const warnedKeys = new Set<string>();

function interpolate(template: string, params: TranslateParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * 翻译函数：key 命中当前 locale 字典 → 返回；缺失 → 回退 zh 并 warn 一次；
 * zh 也缺失 → 返回 key 本身（便于肉眼定位漏网 key）。
 * 直接以 signal 读取（locale()），因此任何 JSX 中使用 t() 都是响应式的。
 */
export function t(key: string, params?: TranslateParams): string {
  const current = locale();
  const entry = messages[current][key] ?? messages.zh[key];
  if (entry === undefined) {
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`[i18n] missing translation key: ${key}`);
    }
    return interpolate(key, params);
  }
  if (current !== 'zh' && messages[current][key] === undefined) {
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`[i18n] key "${key}" missing in "${current}", falling back to zh`);
    }
  }
  return interpolate(entry, params);
}

/** 设置 locale：写 signal + 持久化 localStorage + 同步 <html lang>。 */
export function setLocale(next: Locale): void {
  setLocaleSignal(next);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // 持久化失败不影响本次会话内的切换
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  }
}

/** useI18n() — 组件内统一入口；返回的 t 与模块级 t 同一实现。 */
export function useI18n(): { t: typeof t; locale: () => Locale; setLocale: typeof setLocale } {
  return { t, locale, setLocale };
}

export { locale, messages };
