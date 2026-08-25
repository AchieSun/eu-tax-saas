/**
 * F4 (B-tier) — nl.pension_lijfrente
 *
 * NL annuity / private pension (lijfrente) contribution deduction in Box 1
 * under jaarruimte calculation. Generic cap for 2025 is ~ €34,550 jaarruimte
 * × marginal rate.
 *
 * Source (verified 2026-06-08):
 *   - Wet IB 2001 art. 3.127 (jaarruimte):
 *     https://wetten.overheid.nl/jci1.3:c:BWBR0011353
 *   - Belastingdienst jaarruimte:
 *     https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/inkomstenbelasting/aftrekposten/jaarruimte-berekenen
 *
 * Default: assume €5,000 contribution; saving = contribution × marginal rate.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'nl.pension_lijfrente';

const ASSUMED_LIJFRENTE_CONTRIBUTION = 5_000;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'deduction',
  titleZh: '荷兰个人年金扣除 (Lijfrente jaarruimte)',
  descriptionZh:
    '《Wet IB 2001》art. 3.127:个人 lijfrente 贡献按年度可用空间 (jaarruimte) 扣除应税基数,2025 一般上限约 €34,550。本估算按贡献 €5,000 × 边际税率给出潜在节税额。需通过 Belastingdienst 在线工具确认您实际的 jaarruimte。',
  titleEn: 'Netherlands annuity deduction (Lijfrente jaarruimte)',
  descriptionEn:
    'Wet IB 2001 art. 3.127: personal lijfrente (annuity) contributions are deducted from the taxable base within your annual room (jaarruimte), generically capped around €34,550 in 2025. This estimate uses a €5,000 contribution × marginal rate. Confirm your actual jaarruimte with the Belastingdienst online tool.',
  eligibility: {
    countries: ['NL'],
    incomeTypes: ['salary', 'self_employed'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: 'Wet IB 2001 art. 3.127',
    url: 'https://wetten.overheid.nl/jci1.3:c:BWBR0011353',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'NL') {
      return {
        applicable: false,
        reason: '此扣除项仅适用于荷兰',
        reasonEn: 'This deduction only applies in the Netherlands',
        confidence: 1,
      };
    }
    const saving = Math.round(ASSUMED_LIJFRENTE_CONTRIBUTION * baseline.marginalRate);
    return {
      applicable: true,
      reason: `按贡献 €${ASSUMED_LIJFRENTE_CONTRIBUTION.toLocaleString()} × 边际税率 ${(baseline.marginalRate * 100).toFixed(1)}% 估算节省 €${saving}/年。实际节税额上限取决于您的 jaarruimte (一般 ≤ €34,550)`,
      reasonEn: `Estimated at a €${ASSUMED_LIJFRENTE_CONTRIBUTION.toLocaleString()} contribution × your ${(baseline.marginalRate * 100).toFixed(1)}% marginal rate, saving €${saving}/year. The actual ceiling depends on your jaarruimte (generally ≤ €34,550)`,
      estimatedSavingsEur: saving,
      confidence: 0.65,
      assumptions: [
        {
          field: 'lijfrenteContributionEur',
          defaultValue: ASSUMED_LIJFRENTE_CONTRIBUTION,
          rationale:
            'Conservative round-number proxy; actual jaarruimte ceiling 2025 ≈ €34,550 — use Belastingdienst tool to confirm yours',
        },
      ],
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
