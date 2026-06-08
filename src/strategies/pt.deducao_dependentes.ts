/**
 * F4 (B-tier) — pt.deducao_dependentes
 *
 * Portugal dependent (children) tax credit: €600 per dependent under 3 years
 * old as of 31 Dec, €750 for second child, etc. (art. 78.º-A CIRS).
 *
 * Source (verified 2026-06-08):
 *   - Art. 78.º-A CIRS: https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs78a.aspx
 *
 * Requires number of dependents (not in CalculatorInput). Informational.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'pt.deducao_dependentes';

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'family',
  titleZh: '葡萄牙未成年子女税收抵免 (Dedução de Dependentes)',
  descriptionZh:
    '《CIRS》art. 78.º-A:每名未成年/在读子女基础抵免 €600/年;3岁以下首胎升至 €726,第二胎及以后年龄 3岁以下抵免 €750-€900。需提供子女数量和年龄 (numDependents/dependentAges) 才能精确估算。',
  eligibility: {
    countries: ['PT'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: 'Art. 78.º-A CIRS',
    url: 'https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs78a.aspx',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, _baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'PT') {
      return { applicable: false, reason: '此抵免项仅适用于葡萄牙', confidence: 1 };
    }
    return {
      applicable: true,
      reason:
        '每名未成年/在读子女基础抵免 €600/年 (3岁以下首胎 €726,后续胎更高)。需提供子女数量和年龄才能精确估算',
      estimatedSavingsEur: null,
      confidence: 0.7,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
