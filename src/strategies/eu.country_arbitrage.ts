/**
 * F4 (B-tier) — eu.country_arbitrage
 *
 * Cross-country residency arbitrage: compare effective tax rates across the
 * 5 implemented countries (DE / NL / PT / ES / UK) for the user's income
 * profile. The "saving" surfaced is the gap between the user's current
 * country's tax and the lowest-tax country among peers.
 *
 * Source (verified 2026-06-08):
 *   - EU Treaty on the Functioning of the EU art. 21 (freedom of movement):
 *     https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:12012E021
 *   - OECD Model Tax Convention: https://www.oecd.org/tax/treaties/model-tax-convention-on-income-and-on-capital-condensed-version-20745419.htm
 *
 * Confidence 0.6 — actual relocation is a multi-factor decision (cost of
 * living, healthcare, social ties); pure tax-rate arbitrage is informational.
 */

import { compareCountries } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'eu.country_arbitrage';

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'arbitrage',
  titleZh: '欧盟跨国居民身份套利 — 比较5国有效税率',
  descriptionZh:
    '基于欧盟《TFEU》第21条自由迁徙权,在 DE/NL/PT/ES/UK 之间比较相同收入下的有效税负。本策略仅识别税率差异;真实迁居决策需综合社保、生活成本、家庭、签证等多维因素,请勿仅凭此数字搬家。',
  eligibility: {
    countries: ['ES', 'PT', 'DE', 'NL', 'UK'],
    minAgeYears: 18,
    taxYears: [2025],
  },
  citation: {
    source: 'TFEU art. 21 (free movement) + OECD Model Tax Convention',
    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:12012E021',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    const peers = compareCountries({
      taxYear: input.taxYear,
      incomeType: input.incomeType,
      grossIncome: input.grossIncome,
      specialStatus: 'none',
      filingStatus: input.filingStatus,
      age: input.age,
    });
    let bestTax = baseline.taxOwed;
    let bestCountry = input.country;
    for (const p of peers) {
      if (p.taxOwed < bestTax) {
        bestTax = p.taxOwed;
        bestCountry = p.country;
      }
    }
    const delta = baseline.taxOwed - bestTax;
    if (delta <= 0) {
      return {
        applicable: false,
        reason: `您当前居住的 ${input.country} 已是 5 国中税负最低`,
        estimatedSavingsEur: 0,
        confidence: 0.6,
      };
    }
    return {
      applicable: true,
      reason: `相同收入下,${bestCountry} 比 ${input.country} 少缴税约 €${Math.round(delta)}/年。但跨国搬迁涉及社保、医疗、家庭等多重因素,本数字仅供参考`,
      estimatedSavingsEur: Math.round(delta),
      confidence: 0.6,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
