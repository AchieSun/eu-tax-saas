/**
 * F4 — NL 30% Ruling
 *
 * Up to 5-year regime: 30% of gross employment income reimbursed tax-free.
 *
 * Source (verified 2026-06-08):
 *   - Wet IB 2001 art. 31a: https://wetten.overheid.nl/BWBR0011353
 *
 * ⚠️ 2024 sliding scale (30/20/10) was REVERSED by Belastingplan 2025 back to
 * flat 30% for all 5 years. NEVER model the sliding scale.
 */

import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'nl.30percent';

const NL_30PCT_MIN_INCOME_2025 = 46_660;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'A',
  category: 'special_status',
  titleZh: '荷兰 30% Ruling — 入境员工前5年30%工资免税',
  descriptionZh:
    '荷兰长期实行的 30% Ruling (Wet IB 2001 art. 31a):合格的入境员工,雇主可将30%总工资作为免税补贴,等效将应税基数降至70%。2025年取消了2024年提出的30/20/10递减方案,恢复全程30%平条款。需雇主从NL境外150公里以外招聘,且年薪≥€46,660(2025专业知识门槛)。',
  eligibility: {
    countries: ['NL'],
    incomeTypes: ['salary'],
    specialStatuses: ['30pct_ruling'],
    minIncome: NL_30PCT_MIN_INCOME_2025,
    taxYears: [2025, 2026],
  },
  citation: {
    source: 'Wet IB 2001 art. 31a (Belastingplan 2025 restored flat 30%)',
    url: 'https://wetten.overheid.nl/BWBR0011353',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'NL') {
      return { applicable: false, reason: '此策略仅适用于荷兰税务居民', confidence: 1 };
    }
    if (input.specialStatus !== '30pct_ruling') {
      return {
        applicable: false,
        reason: '需要先通过雇主向 Belastingdienst 申请并获批 30%-regeling',
        confidence: 1,
      };
    }
    if (input.incomeType !== 'salary') {
      return { applicable: false, reason: '30% Ruling 仅适用于工资所得 (Box 1)', confidence: 1 };
    }
    if (input.grossIncome < NL_30PCT_MIN_INCOME_2025) {
      return {
        applicable: false,
        reason: `年薪需 ≥ €${NL_30PCT_MIN_INCOME_2025.toLocaleString()} (2025专业知识门槛)`,
        confidence: 1,
      };
    }
    const rulingResult = calculateTax({
      ...input,
      grossIncome: input.grossIncome * 0.7,
      specialStatus: 'none',
    });
    const delta = baseline.taxOwed - rulingResult.taxOwed;
    if (delta <= 0) {
      return {
        applicable: false,
        reason: '此情形 30% Ruling 不带来节省',
        estimatedSavingsEur: 0,
        confidence: 1,
      };
    }
    return {
      applicable: true,
      reason: `30% Ruling 将应税基数降至70%,可节省约 €${Math.round(delta)}/年 (前5年)`,
      estimatedSavingsEur: Math.round(delta),
      confidence: 1,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
