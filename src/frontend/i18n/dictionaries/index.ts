/**
 * 聚合字典 — 所有字典模块在此合并为 { zh, en } 两张消息表。
 *
 * 扩展模式（新页面双语）：在 dictionaries/ 下新建文件导出一个
 * BilingualDictionary（如 strategies.ts 导出 `export const strategiesDict = { zh: {...}, en: {...} }`），
 * 然后在本文件加一行 import 并加入 registeredDictionaries 数组即可。
 * 键为扁平点分命名空间（'strategies.title' 等），en 缺失的 key 自动回退 zh。
 */
import { calendarDict } from './calendar';
import { compareDict } from './compare';
import { deadlinesDict } from './deadlines';
import { en as enCore } from './en';
import { filingDict } from './filing';
import { paywallDict } from './paywall';
import { ragDict } from './rag';
import { residencyDict } from './residency';
import { strategiesDict } from './strategies';
import { zh as zhCore } from './zh';

export interface BilingualDictionary {
  readonly zh: Record<string, string>;
  readonly en: Record<string, string>;
}

/** 已注册字典列表 — 主字典（App 外壳 + 核心页面）在最前，页面字典随后追加。 */
export const registeredDictionaries: readonly BilingualDictionary[] = [
  { zh: zhCore, en: enCore },
  residencyDict,
  ragDict,
  deadlinesDict,
  strategiesDict,
  calendarDict,
  filingDict,
  compareDict,
  paywallDict,
];

export const messages: Readonly<Record<'zh' | 'en', Record<string, string>>> = {
  zh: Object.assign({}, ...registeredDictionaries.map((dict) => dict.zh)),
  en: Object.assign({}, ...registeredDictionaries.map((dict) => dict.en)),
};
