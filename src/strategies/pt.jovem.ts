/**
 * F4 — PT IRS Jovem (Young workers' income tax relief)
 *
 * Phase-out (OE 2025): Y1 100% → Y2-4 75% → Y5-7 50% → Y8-10 25%.
 * Cap: 55 × IAS (€28,737.50 for 2025) of exempted income per year.
 *
 * Source (verified 2026-06-08):
 *   - Art. 12.º-B CIRS: https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs12b.aspx
 *
 * Default to Year 1 (100% exemption) for max potential saving; confidence 0.8.
 */

import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'pt.jovem';

const PT_JOVEM_MAX_AGE = 35;
const PT_JOVEM_EXEMPT_CAP_2025 = 28_737.5;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'A',
  category: 'special_status',
  titleZh: '葡萄牙 IRS Jovem — 35岁以下青年劳动者前10年所得税减免',
  descriptionZh:
    '葡萄牙《CIRS》art. 12.º-B (Lei 82/2023, 经 Lei 73-A/2025 修订):18-35 岁青年的工资或自雇所得享受为期10年的递减式免税:第1年100%、第2-4年75%、第5-7年50%、第8-10年25%。年度免税额上限为 55 × IAS (2025年为 €28,737.50)。仅适用于职业生涯前10年累计未使用过此优惠的纳税人。',
  eligibility: {
    countries: ['PT'],
    incomeTypes: ['salary', 'self_employed'],
    minAgeYears: 18,
    maxAgeYears: PT_JOVEM_MAX_AGE,
    taxYears: [2025, 2026],
  },
  citation: {
    source: 'Art. 12.º-B CIRS (Lei 82/2023 OE 2024 + Lei 73-A/2025 OE 2026)',
    url: 'https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs12b.aspx',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'PT') {
      return { applicable: false, reason: '此策略仅适用于葡萄牙税务居民', confidence: 1 };
    }
    if (input.incomeType !== 'salary' && input.incomeType !== 'self_employed') {
      return {
        applicable: false,
        reason: 'IRS Jovem 仅适用于 Cat A (工资) 或 Cat B (自雇) 所得',
        confidence: 1,
      };
    }
    if (input.age === undefined) {
      return {
        applicable: false,
        reason: '需要提供年龄 (age) 才能判断资格 (要求 18-35 岁)',
        confidence: 0.9,
      };
    }
    if (input.age < 18 || input.age > PT_JOVEM_MAX_AGE) {
      return {
        applicable: false,
        reason: `IRS Jovem 要求年龄 18-${PT_JOVEM_MAX_AGE} 岁,您当前 ${input.age} 岁`,
        confidence: 1,
      };
    }
    const exemptIncome = Math.min(input.grossIncome, PT_JOVEM_EXEMPT_CAP_2025);
    const taxableIncome = Math.max(0, input.grossIncome - exemptIncome);
    const jovemResult = calculateTax({
      ...input,
      grossIncome: taxableIncome,
      specialStatus: 'none',
    });
    const delta = baseline.taxOwed - jovemResult.taxOwed;
    if (delta <= 0) {
      return {
        applicable: false,
        reason: '此情形 IRS Jovem 不带来节省',
        estimatedSavingsEur: 0,
        confidence: 1,
      };
    }
    return {
      applicable: true,
      reason: `假设第1年100%免税档 (最优情形,免税额封顶 €${PT_JOVEM_EXEMPT_CAP_2025.toLocaleString()}),最多可节省约 €${Math.round(delta)}/年。第2-4年降至75%,第5-7年50%,第8-10年25%`,
      estimatedSavingsEur: Math.round(delta),
      confidence: 0.8,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
