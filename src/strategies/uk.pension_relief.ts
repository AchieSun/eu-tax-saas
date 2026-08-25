/**
 * F4 (B-tier) — uk.pension_relief
 *
 * UK pension annual allowance: contributions up to £60,000 (2025/26) or
 * 100% of earnings (whichever lower) receive marginal-rate tax relief.
 *
 * Source (verified 2026-06-08):
 *   - Finance Act 2023 (raised allowance from £40k to £60k):
 *     https://www.legislation.gov.uk/ukpga/2023/30
 *   - HMRC Pension Tax Manual PTM053000:
 *     https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm053000
 *
 * Default: assume user contributes £5,000/year → saving = £5,000 × marginal rate.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'uk.pension_relief';

const UK_PENSION_ANNUAL_ALLOWANCE_2025 = 60_000;
const ASSUMED_CONTRIBUTION = 5_000;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'deduction',
  titleZh: '英国养老金供款税收减免 (£60,000 年度额度)',
  descriptionZh:
    '《2023 财政法》将养老金年度额度上调至 £60,000 (或 100% 收入,以较低者为准),供款按边际税率获得税收减免 (Higher-rate/Additional-rate 纳税人可通过 SA 申报追加退税)。本估算按供款 £5,000 × 边际税率给出潜在节税额。',
  titleEn: 'UK pension contribution tax relief (£60,000 annual allowance)',
  descriptionEn:
    'The Finance Act 2023 raised the pension annual allowance to £60,000 (or 100% of earnings, whichever is lower); contributions receive relief at your marginal rate (Higher-rate/Additional-rate taxpayers claim the extra via Self Assessment). This estimate uses a £5,000 contribution × marginal rate.',
  eligibility: {
    countries: ['UK'],
    incomeTypes: ['salary', 'self_employed'],
    minAgeYears: 18,
    taxYears: [2025],
  },
  citation: {
    source: 'Finance Act 2023 + HMRC PTM053000',
    url: 'https://www.legislation.gov.uk/ukpga/2023/30',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'UK') {
      return {
        applicable: false,
        reason: '此减免仅适用于英国',
        reasonEn: 'This relief only applies in the UK',
        confidence: 1,
      };
    }
    const saving = Math.round(ASSUMED_CONTRIBUTION * baseline.marginalRate);
    return {
      applicable: true,
      reason: `按供款 £${ASSUMED_CONTRIBUTION.toLocaleString()} × 边际税率 ${(baseline.marginalRate * 100).toFixed(1)}% 估算可省 £${saving}/年。年度额度上限 £${UK_PENSION_ANNUAL_ALLOWANCE_2025.toLocaleString()} (或 100% 收入,取较低者)`,
      reasonEn: `Estimated at a £${ASSUMED_CONTRIBUTION.toLocaleString()} contribution × your ${(baseline.marginalRate * 100).toFixed(1)}% marginal rate, saving £${saving}/year. Annual allowance caps at £${UK_PENSION_ANNUAL_ALLOWANCE_2025.toLocaleString()} (or 100% of earnings, whichever is lower)`,
      estimatedSavingsEur: saving,
      confidence: 0.7,
      assumptions: [
        {
          field: 'pensionContributionEur',
          defaultValue: ASSUMED_CONTRIBUTION,
          rationale: `Conservative round-number proxy (£${ASSUMED_CONTRIBUTION}); actual annual allowance ceiling £${UK_PENSION_ANNUAL_ALLOWANCE_2025} or 100% of earnings, whichever lower`,
        },
      ],
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
