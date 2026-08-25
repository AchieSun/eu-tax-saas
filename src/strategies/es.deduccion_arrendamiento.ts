/**
 * F4 — ES Deducción por arrendamiento de vivienda habitual (Madrid)
 *
 * Madrid CCAA tenant tax credit. 30% of rent on primary residence, capped at
 * €1,237.20/year, tenants under 35, income ≤ €25,620 (single).
 *
 * Source (verified 2026-06-08):
 *   - Art. 8 Decreto Legislativo 1/2010 (BOCM):
 *     https://www.bocm.es/boletin/CM_Orden_BOCM/2010/10/25/BOCM-20101025-1.PDF
 *
 * Requires `rentPaidEur` (not in CalculatorInput). Returns applicable:true with
 * null saving when basic gates pass; W6 will provide richer context.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'es.deduccion_arrendamiento';

const MAD_RENT_MAX_AGE = 35;
const MAD_RENT_INCOME_CAP_SINGLE = 25_620;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'A',
  category: 'deduction',
  titleZh: '西班牙马德里 — 主居所租金扣除 (Deducción por arrendamiento)',
  descriptionZh:
    '马德里自治区《D.Leg 1/2010》第8条:35岁以下租户 (或残疾≥33%/多子女家庭) 可在 cuota autonómica 中扣除主居所年租金的30%,上限 €1,237.20/年。年收入需 ≤ €25,620 (单身)。此策略需要房租金额和年龄两项额外数据,目前 CalculatorInput 不包含,请通过 W6 富上下文 API 提供。',
  titleEn: 'Spain (Madrid) — primary-residence rent deduction (Deducción por arrendamiento)',
  descriptionEn:
    "Art. 8 of Madrid's D.Leg 1/2010: tenants under 35 (or with ≥33% disability / large families) may deduct 30% of annual rent on their primary residence from the regional tax liability (cuota autonómica), capped at €1,237.20/year. Annual income must be ≤ €25,620 (single). This strategy needs two extra data points — rent paid and age — which CalculatorInput currently lacks; provide them via the W6 rich-context API.",
  eligibility: {
    countries: ['ES'],
    minAgeYears: 18,
    maxAgeYears: MAD_RENT_MAX_AGE,
    maxIncome: MAD_RENT_INCOME_CAP_SINGLE,
    taxYears: [2025],
  },
  citation: {
    source: 'Art. 8 D.Leg 1/2010 Madrid (Texto Refundido tributos cedidos)',
    url: 'https://www.bocm.es/boletin/CM_Orden_BOCM/2010/10/25/BOCM-20101025-1.PDF',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, _baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'ES') {
      return {
        applicable: false,
        reason: '此策略仅适用于西班牙税务居民',
        reasonEn: 'This strategy only applies to Spanish tax residents',
        confidence: 1,
      };
    }
    if (input.region !== 'MAD') {
      return {
        applicable: false,
        reason: '此扣除项仅适用于马德里自治区 (region=MAD)',
        reasonEn: 'This deduction only applies in the Madrid region (region=MAD)',
        confidence: 1,
      };
    }
    if (input.age === undefined) {
      return {
        applicable: false,
        reason: '需要提供年龄 (age) 才能判断资格 (要求 < 35 岁)',
        reasonEn: 'Age (age) is required to assess eligibility (must be < 35)',
        confidence: 0.9,
      };
    }
    if (input.age >= MAD_RENT_MAX_AGE) {
      return {
        applicable: false,
        reason: `马德里租金扣除要求 < ${MAD_RENT_MAX_AGE} 岁,您当前 ${input.age} 岁`,
        reasonEn: `The Madrid rent deduction requires being under ${MAD_RENT_MAX_AGE}; you are ${input.age}`,
        confidence: 1,
      };
    }
    if (input.grossIncome > MAD_RENT_INCOME_CAP_SINGLE) {
      return {
        applicable: false,
        reason: `马德里租金扣除要求年收入 ≤ €${MAD_RENT_INCOME_CAP_SINGLE.toLocaleString()},您当前 €${input.grossIncome.toLocaleString()}`,
        reasonEn: `The Madrid rent deduction requires annual income ≤ €${MAD_RENT_INCOME_CAP_SINGLE.toLocaleString()}; yours is €${input.grossIncome.toLocaleString()}`,
        confidence: 1,
      };
    }
    return {
      applicable: true,
      reason:
        '符合马德里租金扣除资格基本条件 (年龄 < 35 且收入 ≤ €25,620)。最大节税额为 min(房租×30%, €1,237.20)。需要房租金额才能精确估算,请通过 /api/strategies/evaluate 提供 rentPaidEur',
      reasonEn:
        'You meet the basic eligibility for the Madrid rent deduction (under 35 and income ≤ €25,620). Maximum saving is min(rent × 30%, €1,237.20). A precise estimate needs your rent amount — provide rentPaidEur via /api/strategies/evaluate',
      estimatedSavingsEur: null,
      confidence: 0.85,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
