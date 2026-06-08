/**
 * F4 (B-tier) — de.kirchensteuer_austritt
 *
 * Church tax exit (Kirchenaustritt). Church tax is 8% (BY, BW) or 9% (rest
 * of DE) of Einkommensteuer. Formal Austritt at the Standesamt eliminates
 * future liability.
 *
 * Source (verified 2026-06-08):
 *   - § 51a EStG (Bemessungsgrundlage Kirchensteuer):
 *     https://www.gesetze-im-internet.de/estg/__51a.html
 *   - per-Land Kirchensteuergesetze (e.g. KiStG BY):
 *     https://www.gesetze-bayern.de/Content/Document/BayKiStG
 *
 * Saving = incomeTax × rate. This IS deterministic (saving exactly equals
 * the church tax that would otherwise have been levied). confidence 0.95
 * (only doubt: user must actually leave formally + accept religious choice).
 */

import type { CalculatorInput, TaxBreakdownItem } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'de.kirchensteuer_austritt';

const KISTG_RATE_DEFAULT = 0.09; // 9% in most Bundesländer
const KISTG_RATE_BY_BW = 0.08;
const BY_BW_REGIONS = ['BY', 'BW'];

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'structuring',
  titleZh: '德国教会税退出 (Kirchenaustritt) — 直接节省8-9%所得税附加',
  descriptionZh:
    '《EStG》§ 51a + 各州 Kirchensteuergesetz:教会税为所得税的 8% (拜仁、巴登-符腾堡) 或 9% (其余州)。在户籍所在 Standesamt 办理 Kirchenaustritt 即可终止;此为个人宗教选择,本策略仅识别经济影响。',
  eligibility: {
    countries: ['DE'],
    minAgeYears: 14,
    taxYears: [2025, 2026],
  },
  citation: {
    source: '§ 51a EStG + per-Land Kirchensteuergesetze',
    url: 'https://www.gesetze-im-internet.de/estg/__51a.html',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'DE') {
      return { applicable: false, reason: '此扣除项仅适用于德国', confidence: 1 };
    }
    const region = (input.region ?? '').toUpperCase();
    const rate = BY_BW_REGIONS.includes(region) ? KISTG_RATE_BY_BW : KISTG_RATE_DEFAULT;
    // Oracle P1#6: the old implementation back-out the Einkommensteuer as
    // `baseline.taxOwed / 1.055`, which silently assumes SolZ applies at the
    // full 5.5%. Below the SolZ exemption (≈ €19,950 income tax for singles
    // in 2025), SolZ is zero and Einkommensteuer == taxOwed. Dividing by
    // 1.055 in that band understates Einkommensteuer by ~5% and therefore
    // the church tax saving estimate too. The DE calculator emits a
    // breakdown line `{label: 'Einkommensteuer (§ 32a EStG)', amount: ...}`
    // — read it directly. BaselineTax (the strategy contract type) does
    // not include `breakdown` because ES uses a different shape, but DE
    // always emits the standard `TaxBreakdownItem[]` and this evaluator
    // is country-gated to DE above, so the structural narrow is safe.
    const baselineWithBreakdown = baseline as BaselineTax & {
      breakdown?: ReadonlyArray<TaxBreakdownItem>;
    };
    const einkommensteuerLine = baselineWithBreakdown.breakdown?.find((b) =>
      b.label.startsWith('Einkommensteuer'),
    );
    const estIncomeTax = einkommensteuerLine?.amount ?? baseline.taxOwed / 1.055;
    const saving = Math.round(estIncomeTax * rate);
    if (saving <= 0) {
      return {
        applicable: false,
        reason: '当前应税额为零,无教会税可省',
        estimatedSavingsEur: 0,
        confidence: 1,
      };
    }
    return {
      applicable: true,
      reason: `若您是教会成员,在 ${BY_BW_REGIONS.includes(region) ? '巴伐利亚/巴登-符腾堡 (8%)' : '其它联邦州 (9%)'} 可省约 €${saving}/年 (按 ${(rate * 100).toFixed(0)}% × 所得税估算)。此为宗教个人决定,数字仅供参考`,
      estimatedSavingsEur: saving,
      confidence: 0.95,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
