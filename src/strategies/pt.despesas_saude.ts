/**
 * F4 (B-tier) — pt.despesas_saude
 *
 * Portugal health expenses tax credit: 15% of qualifying medical expenses,
 * capped at €1,000/year (art. 78.º-C CIRS).
 *
 * Source (verified 2026-06-08):
 *   - Art. 78.º-C CIRS: https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs78c.aspx
 *
 * Max possible saving: €1,000 (when health expenses ≥ €6,667). Default: max.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'pt.despesas_saude';

const PT_HEALTH_CAP = 1_000;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'deduction',
  titleZh: '葡萄牙医疗费用抵免 (Despesas de Saúde, 15% 上限 €1,000)',
  descriptionZh:
    '《CIRS》art. 78.º-C:15% 医疗费用 (含处方、医院、保险) 可抵免所得税,年度上限 €1,000 (即 ≥€6,667 医疗支出可达上限)。需通过 e-fatura 关联发票。需提供 medicalExpensesEur 才能精确估算实际节税额。',
  eligibility: {
    countries: ['PT'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: 'Art. 78.º-C CIRS',
    url: 'https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs78c.aspx',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, _baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'PT') {
      return { applicable: false, reason: '此抵免项仅适用于葡萄牙', confidence: 1 };
    }
    return {
      applicable: true,
      reason: `最高可抵免 €${PT_HEALTH_CAP}/年 (15% × 医疗支出上限 €6,667)。需提供实际医疗支出 (medicalExpensesEur) 才能精确估算`,
      estimatedSavingsEur: PT_HEALTH_CAP,
      confidence: 0.7,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
