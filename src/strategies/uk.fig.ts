/**
 * F4 — UK FIG (Foreign Income & Gains) 4-year regime
 *
 * Source (verified 2026-06-08):
 *   - Finance Act 2025 Schedule 9: https://www.legislation.gov.uk/ukpga/2025/8/schedule/9
 *
 * ⚠️ UK Non-Dom REMITTANCE BASIS is ABOLISHED since 2025-04-06. NEVER recommend
 * remittance basis — recommend FIG instead.
 */

import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'uk.fig';

const STRATEGY: Strategy = {
  id: ID,
  tier: 'A',
  category: 'special_status',
  titleZh: '英国 FIG 制度 — 新入境居民前4年境外收入免税 (取代已废除的 Non-Dom 汇入制)',
  descriptionZh:
    '英国《2025财政法》Schedule 9 引入 FIG (Foreign Income & Gains) 制度:新入境英国税务居民前4个税年,境外收入与境外资本利得 100% 免英国税。⚠️ 旧的 Non-Dom Remittance Basis 自 2025-04-06 已被废除,请勿推荐汇入制;FIG 是其替代品,但要求迁入英国前必须有连续10个税年非英国居民身份,且仅前4个税年有效,需每年通过 SA109 Box 28/29 申请。',
  eligibility: {
    countries: ['UK'],
    specialStatuses: ['fig'],
    minAgeYears: 18,
    taxYears: [2025],
  },
  citation: {
    source: 'Finance Act 2025 Schedule 9',
    url: 'https://www.legislation.gov.uk/ukpga/2025/8/schedule/9',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'UK') {
      return { applicable: false, reason: '此策略仅适用于英国税务居民', confidence: 1 };
    }
    if (input.specialStatus !== 'fig') {
      return {
        applicable: false,
        reason: '需要满足 FIG 资格 (前10年非英国居民 + 在前4个税年内) 并通过 SA109 申请',
        confidence: 1,
      };
    }
    const figResult = calculateTax({
      ...input,
      specialStatus: 'fig',
      region: input.region ?? 'EWN',
    });
    const delta = baseline.taxOwed - figResult.taxOwed;
    if (delta <= 0) {
      return {
        applicable: false,
        reason: '此情形 FIG 不带来节省 (基线已是零税)',
        estimatedSavingsEur: 0,
        confidence: 1,
      };
    }
    return {
      applicable: true,
      reason: `FIG 制度对境外收入 100% 免税,可节省约 £${Math.round(delta)}/年 (前4个税年)。请通过 F2 居民评估确认10年非居民前提`,
      estimatedSavingsEur: Math.round(delta),
      confidence: 0.9,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
