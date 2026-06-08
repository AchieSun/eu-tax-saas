/**
 * F4 (B-tier) — nl.hypotheekrente
 *
 * Netherlands mortgage interest deduction in Box 1 (eigenwoningforfait
 * regime). Rate gradually phased down to 36.97% by 2025 (was 49% in 2013).
 *
 * Source (verified 2026-06-08):
 *   - Wet IB 2001 art. 3.119a (hypotheekrenteaftrek):
 *     https://wetten.overheid.nl/jci1.3:c:BWBR0011353
 *   - Belastingdienst eigen woning:
 *     https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/woning/
 *
 * Default: assume €5,000 annual mortgage interest → saving ≈ €5,000 × 0.3697.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'nl.hypotheekrente';

const NL_HRA_MAX_RATE_2025 = 0.3697;
const ASSUMED_ANNUAL_INTEREST = 5_000;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'deduction',
  titleZh: '荷兰按揭利息扣除 (Hypotheekrenteaftrek)',
  descriptionZh:
    '《Wet IB 2001》art. 3.119a:自住房按揭利息可在 Box 1 扣除,2025 年最高扣除率为 36.97% (自 2013 年逐步从 49% 降至此值)。需提供年度利息支出 (annualMortgageInterestEur) 才能精确计算。',
  eligibility: {
    countries: ['NL'],
    incomeTypes: ['salary', 'self_employed'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: 'Wet IB 2001 art. 3.119a',
    url: 'https://wetten.overheid.nl/jci1.3:c:BWBR0011353',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, _baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'NL') {
      return { applicable: false, reason: '此扣除项仅适用于荷兰', confidence: 1 };
    }
    const saving = Math.round(ASSUMED_ANNUAL_INTEREST * NL_HRA_MAX_RATE_2025);
    return {
      applicable: true,
      reason: `按年利息 €${ASSUMED_ANNUAL_INTEREST.toLocaleString()} × 36.97% 估算,可省约 €${saving}/年。需提供实际年利息支出 (annualMortgageInterestEur) 才能精确计算`,
      estimatedSavingsEur: saving,
      confidence: 0.65,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
