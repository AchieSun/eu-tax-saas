/**
 * F4 (B-tier) — de.riester
 *
 * Riester pension state subsidy (Grundzulage + Kinderzulage) plus optional
 * Sonderausgabenabzug under § 10a EStG up to €2,100/year.
 *
 * Source (verified 2026-06-08):
 *   - § 10a + § 79-99 EStG: https://www.gesetze-im-internet.de/estg/__10a.html
 *   - Deutsche Rentenversicherung Riester guide:
 *     https://www.deutsche-rentenversicherung.de/DRV/DE/Rente/Allgemeine-Informationen/Riester-Rente/riester-rente_node.html
 *
 * Grundzulage 2025: €175/year + €185/Kind (€300 post-2008). Plus tax
 * deduction up to €2,100; the tax authority computes whichever is better.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'de.riester';

const DE_RIESTER_MAX_DEDUCTION = 2_100;
const DE_RIESTER_GRUNDZULAGE = 175;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'deduction',
  titleZh: '德国 Riester 养老金补贴 + 税收扣除',
  descriptionZh:
    '《EStG》§ 10a + § 79-99:Riester-Rente 由国家直接补贴 (Grundzulage €175 + Kinderzulage €185-€300/孩) 并可附加 Sonderausgabenabzug 上限 €2,100/年。税务局自动选择补贴或扣除中较优方式 (Günstigerprüfung)。',
  eligibility: {
    countries: ['DE'],
    incomeTypes: ['salary'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: '§ 10a + § 79-99 EStG',
    url: 'https://www.gesetze-im-internet.de/estg/__10a.html',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'DE') {
      return { applicable: false, reason: '此补贴仅适用于德国', confidence: 1 };
    }
    if (input.incomeType !== 'salary') {
      return {
        applicable: false,
        reason: 'Riester 主要面向 Pflichtversicherte (强制社保者),通常为工资所得者',
        confidence: 0.9,
      };
    }
    const deductionSaving = Math.round(DE_RIESTER_MAX_DEDUCTION * baseline.marginalRate);
    const totalBest = Math.max(deductionSaving, DE_RIESTER_GRUNDZULAGE);
    return {
      applicable: true,
      reason: `Grundzulage €${DE_RIESTER_GRUNDZULAGE} vs 扣除节税 €${deductionSaving} (按边际税率 ${(baseline.marginalRate * 100).toFixed(1)}%),税局自动取优,本年最多约 €${totalBest}。有孩可再加 €185-€300/孩`,
      estimatedSavingsEur: totalBest,
      confidence: 0.65,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
