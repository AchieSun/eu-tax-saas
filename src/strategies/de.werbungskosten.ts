/**
 * F4 (B-tier) — de.werbungskosten
 *
 * German itemised work-related expenses. Default Arbeitnehmer-Pauschbetrag
 * is €1,230 (2025) — any itemised total beyond that reduces taxable income.
 *
 * Source (verified 2026-06-08):
 *   - § 9a Nr. 1 EStG (Pauschbetrag): https://www.gesetze-im-internet.de/estg/__9a.html
 *   - § 9 EStG (Werbungskosten Katalog): https://www.gesetze-im-internet.de/estg/__9.html
 *
 * Default expectation: user has commute + home office that exceed €1,230;
 * estimate saving = €500 × marginal rate. confidence 0.6.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'de.werbungskosten';

const DE_WK_PAUSCHBETRAG_2025 = 1_230;
const ASSUMED_EXCESS_OVER_PAUSCHALE = 500;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'deduction',
  titleZh: '德国工作相关支出列举扣除 (Werbungskosten)',
  descriptionZh:
    '《EStG》§ 9 列举的工作支出 (通勤、远程办公、培训、工作服等) 若超过 €1,230/年 (2025 Pauschbetrag) 则按实际数额扣除应税基数。常见超额项:每月通勤≥30 公里、永久家庭办公室。本估算假设每年超出 Pauschale €500,按边际税率估算。',
  titleEn: 'Germany itemised work-expense deduction (Werbungskosten)',
  descriptionEn:
    'Work expenses itemised under § 9 EStG (commuting, home office, training, work clothing, etc.) are deducted at actual amounts once they exceed the €1,230/year allowance (2025 Pauschbetrag). Common exceedances: commutes ≥30 km each way, a permanent home office. This estimate assumes €500/year above the allowance, valued at your marginal rate.',
  eligibility: {
    countries: ['DE'],
    incomeTypes: ['salary'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: '§ 9 + § 9a EStG',
    url: 'https://www.gesetze-im-internet.de/estg/__9.html',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'DE') {
      return {
        applicable: false,
        reason: '此扣除项仅适用于德国',
        reasonEn: 'This deduction only applies in Germany',
        confidence: 1,
      };
    }
    if (input.incomeType !== 'salary') {
      return {
        applicable: false,
        reason: 'Werbungskosten 仅适用于工资所得',
        reasonEn: 'Werbungskosten only applies to employment income',
        confidence: 1,
      };
    }
    const saving = Math.round(ASSUMED_EXCESS_OVER_PAUSCHALE * baseline.marginalRate);
    return {
      applicable: true,
      reason: `若您的实际工作支出超过 €${DE_WK_PAUSCHBETRAG_2025} Pauschale,每超 €100 按边际税率 ${(baseline.marginalRate * 100).toFixed(1)}% 可省 €${(baseline.marginalRate * 100).toFixed(0)}。本估算假设超额 €${ASSUMED_EXCESS_OVER_PAUSCHALE}/年`,
      reasonEn: `If your actual work expenses exceed the €${DE_WK_PAUSCHBETRAG_2025} allowance, every extra €100 saves €${(baseline.marginalRate * 100).toFixed(0)} at your ${(baseline.marginalRate * 100).toFixed(1)}% marginal rate. This estimate assumes €${ASSUMED_EXCESS_OVER_PAUSCHALE}/year of excess`,
      estimatedSavingsEur: saving,
      confidence: 0.6,
      assumptions: [
        {
          field: 'workExpensesAboveZeroEur',
          defaultValue: DE_WK_PAUSCHBETRAG_2025 + ASSUMED_EXCESS_OVER_PAUSCHALE,
          rationale: `Assumes user has €${ASSUMED_EXCESS_OVER_PAUSCHALE} of itemised work expenses above the €${DE_WK_PAUSCHBETRAG_2025} Arbeitnehmer-Pauschbetrag (typical for commuters > 30km or permanent home office)`,
        },
      ],
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
