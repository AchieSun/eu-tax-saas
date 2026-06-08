/**
 * F4 — EU/DE Ehegattensplitting (Joint-filing tax splitting)
 *
 * § 32a Abs. 5 EStG: T(x_joint) = 2 · T(x_joint / 2)
 *
 * Source (verified 2026-06-08):
 *   - § 32a Abs. 5 EStG: https://www.gesetze-im-internet.de/estg/__32a.html
 *
 * We approximate the benefit by assuming the spouse has €0 income (best case).
 */

import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'eu.splittingverfahren';

const STRATEGY: Strategy = {
  id: ID,
  tier: 'A',
  category: 'family',
  titleZh: '德国 Ehegattensplitting — 夫妻合并申报税率分割',
  descriptionZh:
    '德国《所得税法》§ 32a Abs. 5 规定:已婚夫妻 (或登记的伴侣关系) 可选择合并申报,适用分割税率公式 T(合并) = 2 · T(合并/2)。当夫妻收入差距较大时节税效果最显著 (一方零收入时节税最高)。默认即合并申报,如需分开申报需主动选择 Einzelveranlagung。',
  eligibility: {
    countries: ['DE'],
    incomeTypes: ['salary', 'self_employed'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: '§ 32a Abs. 5 EStG (Splittingverfahren) + § 26 EStG (Veranlagungswahlrecht)',
    url: 'https://www.gesetze-im-internet.de/estg/__32a.html',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'DE') {
      return { applicable: false, reason: '此策略仅适用于德国税务居民', confidence: 1 };
    }
    if (input.filingStatus === 'married_joint') {
      return {
        applicable: false,
        reason: '您已选择合并申报 (married_joint),Splittingverfahren 已自动应用',
        confidence: 1,
      };
    }
    if (input.filingStatus === 'single') {
      return {
        applicable: false,
        reason: '单身纳税人无法适用 Splittingverfahren,需要婚姻或注册伴侣关系',
        confidence: 1,
      };
    }
    // filingStatus === 'married_separate'
    const splittingResult = calculateTax({
      ...input,
      filingStatus: 'married_joint',
    });
    const delta = baseline.taxOwed - splittingResult.taxOwed;
    if (delta <= 0) {
      return {
        applicable: false,
        reason: '此情形 Splittingverfahren 不带来节省',
        estimatedSavingsEur: 0,
        confidence: 1,
      };
    }
    return {
      applicable: true,
      reason: `假设配偶零收入 (最优情形),Splittingverfahren 最多可节省约 €${Math.round(delta)}/年。实际节税额取决于配偶实际收入,差距越大节税越多`,
      estimatedSavingsEur: Math.round(delta),
      confidence: 0.8,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
