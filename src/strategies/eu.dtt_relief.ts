/**
 * F4 (B-tier) — eu.dtt_relief
 *
 * Double Tax Treaty foreign tax credit. When the user has foreign-source
 * income already taxed abroad, claim a credit in the home country up to the
 * amount of home tax attributable to that income (art. 23A/23B OECD MTC).
 *
 * Source (verified 2026-06-08):
 *   - OECD Model Tax Convention art. 23A (exemption) / 23B (credit):
 *     https://www.oecd.org/tax/treaties/model-tax-convention-on-income-and-on-capital-condensed-version-20745419.htm
 *
 * Requires `foreignTaxPaid` (not in CalculatorInput). Returns informational.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'eu.dtt_relief';

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'arbitrage',
  titleZh: '避免双重征税 — 境外已缴税款抵免 (DTT Foreign Tax Credit)',
  descriptionZh:
    '依据 OECD 范本 art. 23A/23B 和各国双边税收协定,境外已缴所得税通常可在居民国按"对应限额法"抵免。需要提供境外已缴税额 (foreignTaxPaid) 和适用的双边协定条款才能精确计算抵免额。常见适用情形:跨境工作者、海外房产租金、跨国分红。',
  titleEn: 'Avoid double taxation — foreign tax credit under DTTs',
  descriptionEn:
    'Under OECD Model art. 23A/23B and bilateral tax treaties, foreign income tax already paid can generally be credited in your country of residence under the ordinary-credit method. A precise credit figure needs the foreign tax paid (foreignTaxPaid) and the applicable treaty article. Typical cases: cross-border workers, overseas rental income, cross-border dividends.',
  eligibility: {
    countries: ['ES', 'PT', 'DE', 'NL', 'UK'],
    minAgeYears: 18,
    taxYears: [2025],
  },
  citation: {
    source: 'OECD Model Tax Convention art. 23A / 23B',
    url: 'https://www.oecd.org/tax/treaties/model-tax-convention-on-income-and-on-capital-condensed-version-20745419.htm',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, _baseline: BaselineTax): StrategyEvaluation {
    if (input.incomeType === 'salary' || input.incomeType === 'self_employed') {
      return {
        applicable: true,
        reason:
          '如您有境外已缴税款,可在居民国按"对应限额法"申请抵免。需要 foreignTaxPaid 字段才能精确计算,请通过 /api/strategies/evaluate 提供。',
        reasonEn:
          'If you have foreign tax already paid, you can claim a credit under the ordinary-credit method in your country of residence. A precise calculation needs the foreignTaxPaid field — provide it via /api/strategies/evaluate.',
        estimatedSavingsEur: null,
        confidence: 0.55,
      };
    }
    return {
      applicable: true,
      reason:
        '此策略对所有有境外所得的纳税人都可能适用,需提供境外已缴税额 (foreignTaxPaid) 才能估算节税额',
      reasonEn:
        'This strategy may apply to any taxpayer with foreign-source income; the foreign tax paid (foreignTaxPaid) is needed to estimate the saving',
      estimatedSavingsEur: null,
      confidence: 0.5,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
