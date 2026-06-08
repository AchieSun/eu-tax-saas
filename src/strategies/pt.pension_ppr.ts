/**
 * F4 (B-tier) — pt.pension_ppr
 *
 * Portugal PPR (Plano Poupança Reforma) contribution deduction: 20% of
 * contribution credited against tax, capped by age band:
 *   < 35: €400/year max credit (contribution €2,000)
 *   35-50: €350/year max credit (contribution €1,750)
 *   > 50: €300/year max credit (contribution €1,500)
 *
 * Source (verified 2026-06-08):
 *   - Art. 21.º Estatuto dos Benefícios Fiscais (EBF):
 *     https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/bf_rep/Pages/ebf021.aspx
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'pt.pension_ppr';

function maxCreditForAge(age: number | undefined): number {
  if (age === undefined) return 400; // assume best case
  if (age < 35) return 400;
  if (age <= 50) return 350;
  return 300;
}

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'deduction',
  titleZh: '葡萄牙 PPR 退休储蓄抵免 (Plano Poupança Reforma)',
  descriptionZh:
    '《EBF》art. 21.º:PPR 贡献的 20% 可抵免所得税,上限按年龄阶梯:<35 岁 €400/年,35-50 岁 €350/年,>50 岁 €300/年。对应贡献上限分别为 €2,000 / €1,750 / €1,500。本策略按年龄段返回该年龄最高节税额估算。',
  eligibility: {
    countries: ['PT'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: 'Art. 21.º Estatuto dos Benefícios Fiscais',
    url: 'https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/bf_rep/Pages/ebf021.aspx',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, _baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'PT') {
      return { applicable: false, reason: '此抵免项仅适用于葡萄牙', confidence: 1 };
    }
    const maxCredit = maxCreditForAge(input.age);
    return {
      applicable: true,
      reason: `按您的年龄段,PPR 贡献最高可抵免 €${maxCredit}/年 (贡献 €${maxCredit * 5} 时达上限)。注意:提前赎回非退休用途需补缴税款`,
      estimatedSavingsEur: maxCredit,
      confidence: 0.75,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
