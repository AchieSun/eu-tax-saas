/**
 * /compare — 免费五国税后收入对比落地页（获客引擎，无需登录）。
 *
 * 两个入口，均注册在 registerLandingRoutes 内（src/api/index.ts 中位于
 * Better Auth session 中间件与 audit 中间件之前，因此天然不需要登录、
 * 不写审计日志，且无需改动 src/api/index.ts 的挂载顺序）：
 *
 *   1. GET /compare                       — 服务端渲染的 HTML 计算器页面。
 *      表单 method=get，无 JS 也能直接提交（query 参数驱动），
 *      有 JS 时增强为 fetch + 局部刷新。
 *   2. GET /api/public/compare            — 公开 JSON API，zod 校验 query，
 *      rateLimitD1 按「每 IP 每分钟 10 次」限流（通过合成
 *      session.user.id = `ip:<client-ip>` 的桶键实现按 IP 计数）。
 *
 * 计算复用 F1 的 compareCountriesDetailed：五国各跑一次，specialStatus
 * 强制为 'none'（apples-to-apples），按 netIncome 降序返回。
 *
 * i18n（双语波）：?lang=en 切换整页英文（zh 为默认）。表单 GET 提交、
 * fetch 增强、JSON API 错误信息、国家名与标签全部跟随 lang 参数。
 */

import type { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import type { Bindings, Variables } from '../api';
import { rateLimitD1 } from '../api/middleware/rate-limit-d1';
import { compareCountriesDetailed } from '../rules';
import { FILING_STATUSES, INCOME_TYPES } from '../rules/common/types';
import type { Country, FilingStatus, IncomeType } from '../rules/common/types';
import { renderPage } from './layout';

type App = Hono<{ Bindings: Bindings; Variables: Variables }>;

export type CompareLang = 'zh' | 'en';

/** ?lang= 只接受 zh / en；缺省/非法值回落 zh（产品默认语言）。 */
export function resolveCompareLang(raw: string | null | undefined): CompareLang {
  return (raw ?? '').toLowerCase() === 'en' ? 'en' : 'zh';
}

// ─── 国家展示元数据 ──────────────────────────────────────────────────────────

const COUNTRY_META: Record<Country, { name: string; nameEn: string; flag: string }> = {
  DE: { name: '德国', nameEn: 'Germany', flag: '🇩🇪' },
  NL: { name: '荷兰', nameEn: 'Netherlands', flag: '🇳🇱' },
  PT: { name: '葡萄牙', nameEn: 'Portugal', flag: '🇵🇹' },
  ES: { name: '西班牙', nameEn: 'Spain', flag: '🇪🇸' },
  UK: { name: '英国', nameEn: 'United Kingdom', flag: '🇬🇧' },
};

const INCOME_TYPE_LABELS: Record<CompareLang, Record<IncomeType, string>> = {
  zh: {
    salary: '工资薪金',
    self_employed: '自雇 / 自由职业',
    dividends: '股息',
    interest: '利息',
    rental: '租金收入',
    capital_gains: '资本利得',
    crypto: '加密货币',
    other: '其他',
  },
  en: {
    salary: 'Salary',
    self_employed: 'Self-employed / freelance',
    dividends: 'Dividends',
    interest: 'Interest',
    rental: 'Rental income',
    capital_gains: 'Capital gains',
    crypto: 'Crypto',
    other: 'Other',
  },
};

const FILING_STATUS_LABELS: Record<CompareLang, Record<FilingStatus, string>> = {
  zh: {
    single: '单身申报',
    married_joint: '已婚合并申报',
    married_separate: '已婚分开申报',
  },
  en: {
    single: 'Single',
    married_joint: 'Married filing jointly',
    married_separate: 'Married filing separately',
  },
};

export const DISCLAIMER_TEXT =
  '本工具提供的计算结果仅供参考，不构成税务建议；重大决策请咨询持牌税务顾问。';
/**
 * 页面层双语字典（i18n 波）：zh 为默认；?lang=en 时整页文案（标题、表单
 * 标签、表头、CTA、错误提示、免责声明、计算口径注记）全部取 en 侧。
 * 校验文案同源，供 buildQuerySchema 生成对应语言的 zod 错误信息。
 * API 层（/api/public/compare）不读该字典 - 其错误 message 固定中文。
 */
const MESSAGES = {
  zh: {
    // zod 校验文案（buildQuerySchema 消费）
    grossRequired: '请输入税前年收入',
    grossInvalid: '税前年收入必须是数字',
    grossPositive: '税前年收入必须大于 0',
    grossMax: '税前年收入不能超过 €1,000,000,000',
    yearInvalid: '税年必须是数字',
    yearInt: '税年必须是整数',
    yearRange: '税年仅支持 2025 或 2026',
    incomeTypeInvalid: '收入类型不合法',
    filingStatusInvalid: '申报状态不合法',
    // 页面文案（comparePage 消费）
    docTitle: '五国税后收入对比计算器',
    metaDescription:
      '免费五国税后收入对比计算器：输入税前年收入，即时对比西班牙、葡萄牙、德国、荷兰、英国的到手净收入、税额与有效税率，无需注册。',
    heroTitle: '五国税后收入对比计算器',
    heroSubtitle:
      '输入税前年收入，立即对比 🇪🇸 西班牙 · 🇵🇹 葡萄牙 · 🇩🇪 德国 · 🇳🇱 荷兰 · 🇬🇧 英国 五国到手净收入 -- 免费、无需注册。',
    labelGross: '税前年收入（€）',
    placeholderGross: '如 60000',
    labelYear: '税年',
    labelType: '收入类型',
    labelFiling: '申报状态',
    submitLabel: '立即对比五国到手',
    formHint: '默认按各国标准税制单身申报计算；数据源为各国官方税率表（附法条引用）。',
    errGeneric: '输入不合法，请检查后重试',
    errAllFailed: '五国计算均失败，请稍后再试',
    resultsHeading: (year: number, gross: string) => `对比结果 · ${year} 税年 · 税前 ${gross}`,
    thCountry: '国家',
    thNet: '到手净收入',
    thTax: '税额',
    thRate: '有效税率',
    badge: '到手最高',
    provisionalNote: '注：部分国家该税年税率为暂定值（provisional），官方正式发布后将自动更新。',
    scopeNote:
      '计算口径：基于各国标准税制（不含 Beckham、IFICI、FIG、30% ruling、Forschungspauschale 等特殊人才制度），' +
      '社保与地区附加视各国规则处理；注册后可解锁特殊制度对比与逐项明细。',
    disclaimer: DISCLAIMER_TEXT,
    ctaTitle: '想知道怎么合法少缴？',
    ctaBody:
      '注册免费账号，用你的真实收入生成五国申报草稿；解锁 Pro 可查看逐项税额明细、' +
      '特殊人才制度（Beckham / IFICI / FIG / 30% ruling）对比与完整节税策略报告。',
    ctaPrimary: '免费注册，生成我的申报草稿',
    ctaSecondary: '查看完整节税策略',
  },
  en: {
    // zod validation copy (consumed by buildQuerySchema)
    grossRequired: 'Please enter your annual gross income',
    grossInvalid: 'Annual gross income must be a number',
    grossPositive: 'Annual gross income must be greater than 0',
    grossMax: 'Annual gross income cannot exceed €1,000,000,000',
    yearInvalid: 'Tax year must be a number',
    yearInt: 'Tax year must be an integer',
    yearRange: 'Only tax years 2025 and 2026 are supported',
    incomeTypeInvalid: 'Invalid income type',
    filingStatusInvalid: 'Invalid filing status',
    // Page copy (consumed by comparePage)
    docTitle: 'Five-Country Take-Home Pay Calculator',
    metaDescription:
      'Free take-home pay calculator for five countries: enter your annual gross income and instantly compare net income, tax owed and effective tax rates across Spain, Portugal, Germany, the Netherlands and the UK. No sign-up required.',
    heroTitle: 'Five-Country Take-Home Pay Calculator',
    heroSubtitle:
      'Enter your annual gross income and instantly compare take-home pay across 🇪🇸 Spain · 🇵🇹 Portugal · 🇩🇪 Germany · 🇳🇱 Netherlands · 🇬🇧 the UK - free, no sign-up required.',
    labelGross: 'Annual gross income (€)',
    placeholderGross: 'e.g. 60000',
    labelYear: 'Tax year',
    labelType: 'Income type',
    labelFiling: 'Filing status',
    submitLabel: 'Compare five countries now',
    formHint:
      "Defaults to each country's standard regime with single filing; rates come from official tax tables (with statute citations).",
    errGeneric: 'Invalid input - please check and try again',
    errAllFailed: 'All five country calculations failed; please try again later',
    resultsHeading: (year: number, gross: string) =>
      `Comparison · ${year} tax year · gross ${gross}`,
    thCountry: 'Country',
    thNet: 'Net income',
    thTax: 'Tax',
    thRate: 'Effective rate',
    badge: 'Highest net',
    provisionalNote:
      "Note: some countries' rates for this tax year are provisional; they will update automatically once officially published.",
    scopeNote:
      "Methodology: based on each country's standard regime (excluding special-status schemes such as Beckham, IFICI, FIG, the 30% ruling and Forschungspauschale); " +
      "social security and regional surcharges follow each country's rules. Sign up to unlock special-regime comparisons and line-item details.",
    disclaimer:
      'Estimates are for information only and do not constitute tax advice; consult a licensed tax advisor before making major decisions.',
    ctaTitle: 'Want to pay less - legally?',
    ctaBody:
      'Create a free account and generate filing drafts for all five countries from your real income. ' +
      'Unlock Pro for line-item tax breakdowns, special-regime comparisons (Beckham / IFICI / FIG / 30% ruling) and the full tax-saving strategy report.',
    ctaPrimary: 'Sign up free - draft my tax filings',
    ctaSecondary: 'See all tax-saving strategies',
  },
} as const;

// ─── Query 校验（zod，中英双语错误信息）─────────────────────────────────────

const MAX_GROSS_INCOME = 1_000_000_000;

/**
 * 构建当前语言的 query schema。zh 与 en 校验规则完全一致，仅错误信息不同；
 * schema 每次请求重建（zod 构建开销极小，换来零全局状态）。
 */
function buildQuerySchema(lang: CompareLang) {
  const m = MESSAGES[lang];
  return z.object({
    grossIncome: z.preprocess(
      (v) => {
        if (typeof v === 'string') {
          return v.trim() === '' ? undefined : Number(v);
        }
        return v;
      },
      z
        .number({
          required_error: m.grossRequired,
          invalid_type_error: m.grossInvalid,
        })
        .positive(m.grossPositive)
        .max(MAX_GROSS_INCOME, m.grossMax),
    ),
    taxYear: z.preprocess(
      (v) => {
        if (v === undefined || v === null || v === '') return 2026;
        if (typeof v === 'string') return Number(v);
        return v;
      },
      z
        .number({ invalid_type_error: m.yearInvalid })
        .int(m.yearInt)
        .refine((v) => v === 2025 || v === 2026, m.yearRange),
    ),
    incomeType: z.preprocess(
      (v) => (v === undefined || v === null || v === '' ? 'salary' : v),
      z.enum(INCOME_TYPES, { errorMap: () => ({ message: m.incomeTypeInvalid }) }),
    ),
    filingStatus: z.preprocess(
      (v) => (v === undefined || v === null || v === '' ? 'single' : v),
      z.enum(FILING_STATUSES, { errorMap: () => ({ message: m.filingStatusInvalid }) }),
    ),
  });
}

/** Back-compat: default-language schema (zh) — used by legacy tests/callers. */
export const publicCompareQuerySchema = buildQuerySchema('zh');

export type PublicCompareInput = z.infer<typeof publicCompareQuerySchema>;

// ─── 计算 ────────────────────────────────────────────────────────────────────

export interface CompareRow {
  country: Country;
  /** Country display name in the response language (zh default, en optional). */
  countryName: string;
  /** English name — always present so clients can switch without refetch. */
  countryNameEn: string;
  flag: string;
  grossIncome: number;
  taxOwed: number;
  netIncome: number;
  effectiveRate: number;
  provisional: boolean;
  breakdown: Array<{ label: string; amount: number }>;
  source: string;
}

/**
 * breakdown 摘要：DE/NL/PT 返回 TaxBreakdownItem[]（数组），ES/UK 返回
 * 结构化对象（如 {estatal, autonomico}）。这里统一压成 {label, amount}[]
 * 最多 8 条，供公开 API 消费，不泄露内部类型差异。
 */
function summarizeBreakdown(raw: unknown): Array<{ label: string; amount: number }> {
  const items: Array<{ label: string; amount: number }> = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object' && 'label' in item && 'amount' in item) {
        const label = String((item as { label: unknown }).label);
        const amount = (item as { amount: unknown }).amount;
        if (typeof amount === 'number' && Number.isFinite(amount)) {
          items.push({ label, amount });
        }
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        items.push({ label: key, amount: value });
      }
    }
  }
  return items.slice(0, 8);
}

export function runPublicCompare(
  input: PublicCompareInput,
  lang: CompareLang = 'zh',
): {
  rows: CompareRow[];
  countryErrors: Array<{ country: Country; error: string }>;
} {
  const entries = compareCountriesDetailed({ ...input, specialStatus: 'none' });
  const rows: CompareRow[] = [];
  const countryErrors: Array<{ country: Country; error: string }> = [];

  for (const entry of entries) {
    if (!entry.ok) {
      countryErrors.push({ country: entry.country, error: entry.error });
      continue;
    }
    const r = entry.result;
    const meta = COUNTRY_META[r.country];
    rows.push({
      country: r.country,
      countryName: lang === 'en' ? meta.nameEn : meta.name,
      countryNameEn: meta.nameEn,
      flag: meta.flag,
      grossIncome: r.grossIncome,
      taxOwed: r.taxOwed,
      netIncome: r.netIncome,
      effectiveRate: r.effectiveRate,
      provisional: r.provisional === true,
      breakdown: summarizeBreakdown((r as { breakdown?: unknown }).breakdown),
      source: r.source,
    });
  }

  rows.sort((a, b) => b.netIncome - a.netIncome);
  return { rows, countryErrors };
}

// ─── 数字格式化（欧洲习惯，如 €52,340）─────────────────────────────────────

export function formatEur(value: number): string {
  return `€${Math.floor(value).toLocaleString('en-US')}`;
}

export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// ─── HTML 页面 ────────────────────────────────────────────────────────────────

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * 表单参数（驱动 hasQuery 判定与 queryToObject 收集）。lang 不算表单参数：
 * 裸 /compare?lang=en（无其他参数）仍渲染空表单页（200），而非报「缺
 * grossIncome」错误；lang 由 queryToObject 单独并入，交给 zod 忽略。
 */
const COMPARE_PARAMS = ['grossIncome', 'taxYear', 'incomeType', 'filingStatus'] as const;
const COMPARE_LANG_PARAM = 'lang';

function queryToObject(query: URLSearchParams): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const key of [...COMPARE_PARAMS, COMPARE_LANG_PARAM]) {
    const value = query.get(key);
    if (value !== null) obj[key] = value;
  }
  return obj;
}

function selected(current: string | undefined, value: string): string {
  return current === value ? ' selected' : '';
}

const PAGE_STYLE = `
    .cmp-hero { text-align: center; padding-block: 0.5rem 1.5rem; }
    .cmp-hero h1 { font-size: 2.1rem; }
    .cmp-hero p { font-size: 1.05rem; }
    .cmp-card {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.25rem;
    }
    .cmp-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.875rem; align-items: end; }
    .cmp-form .cmp-submit-col { display: flex; }
    .cmp-field label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: #374151;
      margin-bottom: 0.25rem;
    }
    .cmp-field input, .cmp-field select {
      width: 100%;
      padding: 0.55rem 0.7rem;
      font-size: 0.95rem;
      font-family: inherit;
      color: #111827;
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 8px;
    }
    .cmp-field input:focus, .cmp-field select:focus { outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb; }
    .cmp-submit {
      background: #2563eb; color: #fff; font-weight: 600; font-size: 0.95rem;
      border: none; border-radius: 8px; padding: 0.65rem 1.1rem; cursor: pointer;
      white-space: nowrap;
    }
    .cmp-submit:hover:not(:disabled) { background: #1d4ed8; }
    .cmp-submit:disabled { opacity: 0.6; cursor: not-allowed; }
    .cmp-hint { font-size: 0.8rem; color: #6b7280; margin: 0.875rem 0 0; }
    .cmp-error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #991b1b;
      border-radius: 12px;
      padding: 0.875rem 1.125rem;
      margin-bottom: 1.25rem;
      font-size: 0.9rem;
    }
    .cmp-error p { margin: 0; color: #991b1b; font-weight: 500; }
    .cmp-results h2 { margin-top: 0; }
    .cmp-table-wrap { overflow-x: auto; }
    .cmp-table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
    .cmp-table th, .cmp-table td { padding: 0.625rem 0.75rem; border-bottom: 1px solid #e5e7eb; text-align: left; }
    .cmp-table th {
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; color: #6b7280; white-space: nowrap;
    }
    .cmp-table td.num, .cmp-table th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cmp-table td.num strong { color: #111827; }
    .cmp-table tr.cmp-top { background: #ecfdf5; }
    .cmp-table tr.cmp-top td { border-bottom-color: #d1fae5; }
    .cmp-badge {
      display: inline-block; margin-left: 0.375rem; padding: 0.1rem 0.5rem;
      border-radius: 999px; background: #d1fae5; color: #065f46;
      font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em;
      vertical-align: middle;
    }
    .cmp-note { font-size: 0.8rem; color: #6b7280; margin: 0.875rem 0 0; }
    .cmp-cta { text-align: center; }
    .cmp-cta h2 { margin-top: 0; }
    .cmp-disclaimer { font-size: 0.8rem; color: #6b7280; text-align: center; margin: 1.5rem 0 0; }
    @media (max-width: 480px) {
      .cmp-hero h1 { font-size: 1.6rem; }
      .cmp-form { grid-template-columns: 1fr 1fr; }
      .cmp-form .cmp-submit-col { grid-column: 1 / -1; }
      .cmp-submit { width: 100%; }
    }
`;

/** JS 增强：提交时 fetch JSON、渲染结果表。文案按 lang 输出（zh 用 \u 转义保持既有模式）。 */
function buildPageScript(lang: CompareLang): string {
  const i18n =
    lang === 'en'
      ? {
          badge: 'Highest net',
          scopeNote: MESSAGES.en.scopeNote.replace(/'/g, "\\'"),
          provisionalNote:
            'Note: some countries\\u2019 rates for this tax year are provisional; they will update automatically once officially published.',
          resultsTitle: 'Comparison \\u00B7 ',
          taxYearLabel: ' tax year \\u00B7 gross ',
          thCountry: 'Country',
          thNet: 'Net income',
          thTax: 'Tax',
          thRate: 'Effective rate',
          calculating: 'Calculating\\u2026',
          errRateLimited: 'Too many requests \\u2014 please try again in a minute.',
          errInvalid: 'Invalid input \\u2014 please check and try again.',
          errNetwork: 'Network error \\u2014 please try again.',
        }
      : {
          badge: '\\u5230\\u624B\\u6700\\u9AD8',
          scopeNote:
            '\\u8BA1\\u7B97\\u53E3\\u5F84\\uFF1A\\u57FA\\u4E8E\\u5404\\u56FD\\u6807\\u51C6\\u7A0E\\u5236\\uFF08\\u4E0D\\u542B Beckham\\u3001IFICI\\u3001FIG\\u300130% ruling\\u3001Forschungspauschale \\u7B49\\u7279\\u6B8A\\u4EBA\\u624D\\u5236\\u5EA6\\uFF09\\uFF0C\\u793E\\u4FDD\\u4E0E\\u5730\\u533A\\u9644\\u52A0\\u89C6\\u5404\\u56FD\\u89C4\\u5219\\u5904\\u7406\\uFF1B\\u6CE8\\u518C\\u540E\\u53EF\\u89E3\\u9501\\u7279\\u6B8A\\u5236\\u5EA6\\u5BF9\\u6BD4\\u4E0E\\u9010\\u9879\\u660E\\u7EC6\\u3002',
          provisionalNote:
            '\\u6CE8\\uFF1A\\u90E8\\u5206\\u56FD\\u5BB6\\u8BE5\\u7A0E\\u5E74\\u7A0E\\u7387\\u4E3A\\u6682\\u5B9A\\u503C\\uFF08provisional\\uFF09\\uFF0C\\u5B98\\u65B9\\u6B63\\u5F0F\\u53D1\\u5E03\\u540E\\u5C06\\u81EA\\u52A8\\u66F4\\u65B0\\u3002',
          resultsTitle: '\\u5BF9\\u6BD4\\u7ED3\\u679C \\u00B7 ',
          taxYearLabel: ' \\u7A0E\\u5E74 \\u00B7 \\u7A0E\\u524D ',
          thCountry: '\\u56FD\\u5BB6',
          thNet: '\\u5230\\u624B\\u51C0\\u6536\\u5165',
          thTax: '\\u7A0E\\u989D',
          thRate: '\\u6709\\u6548\\u7A0E\\u7387',
          calculating: '\\u8BA1\\u7B97\\u4E2D\\u2026',
          errRateLimited:
            '\\u8BF7\\u6C42\\u8FC7\\u4E8E\\u9891\\u7E41\\uFF0C\\u8BF7\\u4E00\\u5206\\u949F\\u540E\\u518D\\u8BD5\\u3002',
          errInvalid:
            '\\u8F93\\u5165\\u4E0D\\u5408\\u6CD5\\uFF0C\\u8BF7\\u68C0\\u67E5\\u540E\\u91CD\\u8BD5\\u3002',
          errNetwork: '\\u7F51\\u7EDC\\u9519\\u8BEF\\uFF0C\\u8BF7\\u91CD\\u8BD5\\u3002',
        };
  return `
    (function () {
      var i18n = {
        badge: '${i18n.badge}',
        scopeNote: '${i18n.scopeNote}',
        provisionalNote: '${i18n.provisionalNote}',
        resultsTitle: '${i18n.resultsTitle}',
        taxYearLabel: '${i18n.taxYearLabel}',
        thCountry: '${i18n.thCountry}',
        thNet: '${i18n.thNet}',
        thTax: '${i18n.thTax}',
        thRate: '${i18n.thRate}',
        calculating: '${i18n.calculating}',
        errRateLimited: '${i18n.errRateLimited}',
        errInvalid: '${i18n.errInvalid}',
        errNetwork: '${i18n.errNetwork}'
      };
      // API 的 countryName 固定中文；英文页改用响应里的 countryNameEn。
      var useEnNames = ${lang === 'en'};
      var form = document.getElementById('cmp-form');
      var resultsEl = document.getElementById('cmp-results');
      var errorEl = document.getElementById('cmp-error');
      if (!form || !resultsEl || !errorEl) return;

      function fmtEur(v) { return '\\u20AC' + Math.floor(v).toLocaleString('en-US'); }
      function fmtRate(r) { return (r * 100).toFixed(1) + '%'; }
      function showError(msg) {
        errorEl.querySelector('p').textContent = msg;
        errorEl.hidden = false;
        errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      function hideError() { errorEl.hidden = true; }

      function renderResults(data) {
        var rows = '';
        for (var i = 0; i < data.results.length; i++) {
          var r = data.results[i];
          var top = i === 0;
          rows += '<tr' + (top ? ' class="cmp-top"' : '') + '>'
            + '<td>' + r.flag + ' ' + (useEnNames && r.countryNameEn ? r.countryNameEn : r.countryName) + (top ? ' <span class="cmp-badge">' + i18n.badge + '</span>' : '') + '</td>'
            + '<td class="num"><strong>' + fmtEur(r.netIncome) + '</strong></td>'
            + '<td class="num">' + fmtEur(r.taxOwed) + '</td>'
            + '<td class="num">' + fmtRate(r.effectiveRate) + '</td>'
            + '</tr>';
        }
        var hasProvisional = false;
        for (var j = 0; j < data.results.length; j++) {
          if (data.results[j].provisional) { hasProvisional = true; break; }
        }
        var notes = '<p class="cmp-note">' + i18n.scopeNote + '</p>';
        if (hasProvisional) {
          notes += '<p class="cmp-note">' + i18n.provisionalNote + '</p>';
        }
        resultsEl.innerHTML = '<h2>' + i18n.resultsTitle + data.input.taxYear
          + i18n.taxYearLabel + fmtEur(data.input.grossIncome) + '</h2>'
          + '<div class="cmp-table-wrap"><table class="cmp-table"><thead><tr>'
          + '<th>' + i18n.thCountry + '</th><th class="num">' + i18n.thNet + '</th>'
          + '<th class="num">' + i18n.thTax + '</th><th class="num">' + i18n.thRate + '</th>'
          + '</tr></thead><tbody>' + rows + '</tbody></table></div>' + notes;
        resultsEl.hidden = false;
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        hideError();
        var params = new URLSearchParams(new FormData(form));
        var button = form.querySelector('button[type=submit]');
        var original = button.textContent;
        button.disabled = true;
        button.textContent = i18n.calculating;
        fetch('/api/public/compare?' + params.toString(), { headers: { 'X-Requested-With': 'fetch' } })
          .then(function (res) {
            return res.json().then(function (data) { return { res: res, data: data }; });
          })
          .then(function (r) {
            if (r.res.ok && r.data.ok) {
              renderResults(r.data);
              try { history.replaceState(null, '', '/compare?' + params.toString()); } catch (e) { /* noop */ }
            } else if (r.res.status === 429) {
              showError(i18n.errRateLimited);
            } else {
              showError((r.data && r.data.message) || i18n.errInvalid);
            }
          })
          .catch(function () { showError(i18n.errNetwork); })
          .finally(function () {
            button.disabled = false;
            button.textContent = original;
          });
      });
    })();
  `;
}

export function comparePage(query: URLSearchParams): { html: string; status: number } {
  // ?lang=en 切换整页英文；缺省/非法值回落中文（产品默认语言）。
  const lang = resolveCompareLang(query.get(COMPARE_LANG_PARAM));
  const m = MESSAGES[lang];
  const hasQuery = [...query.keys()].some((k) => (COMPARE_PARAMS as readonly string[]).includes(k));
  const raw = queryToObject(query);

  let rows: CompareRow[] = [];
  let errorMessage: string | null = null;
  let input: PublicCompareInput | null = null;

  if (hasQuery) {
    const parsed = buildQuerySchema(lang).safeParse(raw);
    if (parsed.success) {
      input = parsed.data;
      const computed = runPublicCompare(parsed.data, lang);
      rows = computed.rows;
      if (rows.length === 0) {
        errorMessage = m.errAllFailed;
      }
    } else {
      errorMessage = parsed.error.issues[0]?.message ?? m.errGeneric;
    }
  }

  const grossValue = raw.grossIncome !== undefined ? escapeHtml(raw.grossIncome) : '';
  const taxYearValue = raw.taxYear ?? '2026';
  const incomeTypeValue = raw.incomeType ?? 'salary';
  const filingStatusValue = raw.filingStatus ?? 'single';

  const rowsHtml = rows
    .map(
      (row, i) => `
          <tr${i === 0 ? ' class="cmp-top"' : ''}>
            <td>${row.flag} ${row.countryName}${i === 0 ? ` <span class="cmp-badge">${m.badge}</span>` : ''}</td>
            <td class="num"><strong>${formatEur(row.netIncome)}</strong></td>
            <td class="num">${formatEur(row.taxOwed)}</td>
            <td class="num">${formatRate(row.effectiveRate)}</td>
          </tr>`,
    )
    .join('');

  const provisionalNote = rows.some((r) => r.provisional)
    ? `<p class="cmp-note">${m.provisionalNote}</p>`
    : '';

  const resultsHtml =
    input !== null
      ? `
      <section class="cmp-card cmp-results" id="cmp-results">
        <h2>${m.resultsHeading(input.taxYear, formatEur(input.grossIncome))}</h2>
        <div class="cmp-table-wrap">
          <table class="cmp-table">
            <thead>
              <tr>
                <th scope="col">${m.thCountry}</th>
                <th scope="col" class="num">${m.thNet}</th>
                <th scope="col" class="num">${m.thTax}</th>
                <th scope="col" class="num">${m.thRate}</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}
            </tbody>
          </table>
        </div>
        ${provisionalNote}
        <p class="cmp-note">${m.scopeNote}</p>
      </section>`
      : '<section class="cmp-card cmp-results" id="cmp-results" hidden></section>';

  const incomeTypeOptions = INCOME_TYPES.map(
    (t) =>
      `<option value="${t}"${selected(incomeTypeValue, t)}>${INCOME_TYPE_LABELS[lang][t]}</option>`,
  ).join('');

  const filingStatusOptions = FILING_STATUSES.map(
    (s) =>
      `<option value="${s}"${selected(filingStatusValue, s)}>${FILING_STATUS_LABELS[lang][s]}</option>`,
  ).join('');

  const body = `
      <style>${PAGE_STYLE}</style>

      <section class="cmp-hero">
        <h1>${m.heroTitle}</h1>
        <p>
          ${m.heroSubtitle}
        </p>
      </section>

      <section class="cmp-card">
        <form class="cmp-form" id="cmp-form" action="/compare" method="get">
          ${lang === 'en' ? '<input type="hidden" name="lang" value="en">' : ''}
          <div class="cmp-field">
            <label for="cmp-gross">${m.labelGross}</label>
            <input id="cmp-gross" name="grossIncome" type="number" inputmode="decimal"
              min="1" max="1000000000" step="any" placeholder="${m.placeholderGross}" value="${grossValue}" required>
          </div>
          <div class="cmp-field">
            <label for="cmp-year">${m.labelYear}</label>
            <select id="cmp-year" name="taxYear" aria-label="${m.labelYear}">
              <option value="2025"${selected(taxYearValue, '2025')}>2025</option>
              <option value="2026"${selected(taxYearValue, '2026')}>2026</option>
            </select>
          </div>
          <div class="cmp-field">
            <label for="cmp-type">${m.labelType}</label>
            <select id="cmp-type" name="incomeType" aria-label="${m.labelType}">${incomeTypeOptions}
            </select>
          </div>
          <div class="cmp-field">
            <label for="cmp-filing">${m.labelFiling}</label>
            <select id="cmp-filing" name="filingStatus" aria-label="${m.labelFiling}">${filingStatusOptions}
            </select>
          </div>
          <div class="cmp-field cmp-submit-col">
            <button class="cmp-submit" type="submit">${m.submitLabel}</button>
          </div>
        </form>
        <p class="cmp-hint">${m.formHint}</p>
      </section>

      <div class="cmp-error" id="cmp-error" role="alert"${errorMessage ? '' : ' hidden'}>
        <p>${escapeHtml(errorMessage ?? '')}</p>
      </div>

      ${resultsHtml}

      <section class="cmp-card cmp-cta">
        <h2>${m.ctaTitle}</h2>
        <p>
          ${m.ctaBody}
        </p>
        <div class="cta-row">
          <a class="btn btn-primary" href="/app">${m.ctaPrimary}</a>
          <a class="btn btn-secondary" href="/app#strategies">${m.ctaSecondary}</a>
        </div>
      </section>

      <p class="cmp-disclaimer">${m.disclaimer}</p>

      <script>${buildPageScript(lang)}</script>
    `;

  return {
    html: renderPage({
      title: m.docTitle,
      path: '/compare',
      lang: lang === 'en' ? 'en' : 'zh-CN',
      metaDescription: m.metaDescription,
      body,
    }),
    status: errorMessage ? 400 : 200,
  };
}

// ─── 路由注册 ────────────────────────────────────────────────────────────────

/**
 * 把客户端 IP 映射成 rateLimitD1 的桶键（session.user.id）。
 * rateLimitD1 以 session user 维度计数；本端点位于会话中间件之前、
 * 天然匿名，因此合成 `ip:<client-ip>` 作为每 IP 独立桶。
 */
const ipBucket = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
  const direct = c.req.header('cf-connecting-ip')?.trim();
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = direct || forwarded || 'unknown';
  c.set('session', { user: { id: `ip:${ip}` } });
  await next();
});

export function registerCompareRoutes(app: App): void {
  // 公开落地页：无 JS 也能 GET 提交表单完成一次对比。
  app.get('/compare', (c) => {
    const { html, status } = comparePage(new URL(c.req.url).searchParams);
    return c.html(html, status as 200 | 400, { 'Content-Type': 'text/html; charset=utf-8' });
  });

  // 公开 JSON API：每 IP 每分钟 10 次；不挂 audit、不要求登录
  // （本路由注册在 session/audit 中间件之前，链路在其之前终止）。
  app.use('/api/public/compare', ipBucket);
  app.use(
    '/api/public/compare',
    rateLimitD1({ keyPrefix: 'public-compare', windowSeconds: 60, max: 10 }),
  );

  app.get('/api/public/compare', (c) => {
    const parsed = publicCompareQuerySchema.safeParse(
      queryToObject(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? '输入不合法';
      return c.json({ ok: false, error: 'validation', message }, 400);
    }
    const { rows, countryErrors } = runPublicCompare(parsed.data);
    if (rows.length === 0) {
      return c.json(
        {
          ok: false,
          error: 'computation_failed',
          message: '五国计算均失败，请稍后再试',
          countryErrors,
        },
        500,
      );
    }
    return c.json({
      ok: true,
      input: parsed.data,
      results: rows,
      countryErrors,
      generatedAt: new Date().toISOString(),
    });
  });

  // 非 GET 方法统一 405（CORS 预检 OPTIONS 由全局 cors 中间件先行处理）。
  app.on(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], '/api/public/compare', (c) =>
    c.json({ ok: false, error: 'method_not_allowed', message: '该端点仅支持 GET' }, 405),
  );
}
