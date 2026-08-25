/**
 * F4 (B-tier) — eu.183day_planning
 *
 * 183-day residency planning: avoid unintended tax residency in a high-tax
 * country by staying under the 183-day physical-presence threshold (or the
 * country-specific equivalent: UK SRT, DE 6-month rule, etc.).
 *
 * Source (verified 2026-06-08):
 *   - OECD Model Tax Convention art. 4 (residency tie-breaker):
 *     https://www.oecd.org/tax/treaties/model-tax-convention-on-income-and-on-capital-condensed-version-20745419.htm
 *   - UK HMRC SRT: https://www.gov.uk/hmrc-internal-manuals/residence-domicile-and-remittance-basis/rdrm11000
 *
 * Saving estimated via F2 residency module (out of strategy library scope);
 * confidence 0.5.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'eu.183day_planning';

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'structuring',
  titleZh: '183天天数规划 — 避免触发非预期税务居民身份',
  descriptionZh:
    'OECD 范本 art. 4 居民身份判定;各国普遍以 183天物理停留作为关键门槛 (UK 用 SRT 复合测试,DE 用连续6个月规则)。本策略协助识别您是否接近某国天数红线;精确节税额由 F2 居民评估模块提供。',
  titleEn: '183-day planning — avoid unintentionally triggering tax residency',
  descriptionEn:
    "Residency tie-breaker under OECD Model art. 4; most countries use 183 days of physical presence as the key threshold (the UK uses the composite SRT; Germany a 6-consecutive-month rule). This strategy helps spot whether you are close to a country's day-count red line; a precise saving figure comes from the F2 residency module.",
  eligibility: {
    countries: ['ES', 'PT', 'DE', 'NL', 'UK'],
    minAgeYears: 18,
    taxYears: [2025],
  },
  citation: {
    source: 'OECD MTC art. 4 + UK HMRC Statutory Residence Test',
    url: 'https://www.gov.uk/hmrc-internal-manuals/residence-domicile-and-remittance-basis/rdrm11000',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, _baseline: BaselineTax): StrategyEvaluation {
    if (input.country === 'UK') {
      return {
        applicable: true,
        reason:
          '英国采用复合 SRT 测试 (法定居民/非居民/充分关联),仅看天数不够。需通过 F2 模块输入 ties + workdays 精确判定',
        reasonEn:
          'The UK uses the composite Statutory Residence Test (automatic residence / non-residence / sufficient ties) — day count alone is not enough. Enter ties + workdays in the F2 module for a precise determination',
        estimatedSavingsEur: null,
        confidence: 0.5,
      };
    }
    return {
      applicable: true,
      reason: `${input.country} 通常以 183 天/年作为税务居民门槛之一。请通过 F2 居民评估提供每月天数明细,以判断是否需要规划`,
      reasonEn: `${input.country} commonly treats 183 days/year as one of its tax-residency thresholds. Provide a monthly day-count breakdown via the F2 residency assessment to see whether planning is needed`,
      estimatedSavingsEur: null,
      confidence: 0.5,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
