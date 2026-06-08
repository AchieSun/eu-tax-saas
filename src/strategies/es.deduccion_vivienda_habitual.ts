/**
 * F4 (B-tier) — es.deduccion_vivienda_habitual
 *
 * Spain legacy primary-residence mortgage deduction. Closed to new mortgages
 * after 2012-12-31 but ACTIVE for grandfathered mortgages (purchased before
 * 2013) — 15% of payments up to €9,040/year (€1,356 max credit).
 *
 * Source (verified 2026-06-08):
 *   - DT 18ª LIRPF (Disposición Transitoria 18ª, Ley 35/2006):
 *     https://www.boe.es/eli/es/l/2006/11/28/35
 *   - AEAT Manual Práctico 2025 — Deducciones inversión vivienda habitual
 *
 * Requires mortgage purchase date + 2025 mortgage payments (not in input).
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'es.deduccion_vivienda_habitual';

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'deduction',
  titleZh: '西班牙主居所按揭利息扣除 (Deducción inversión vivienda habitual, 历史保留)',
  descriptionZh:
    '《LIRPF》DT 18ª 过渡条款:2013-01-01 前购买的主居所按揭仍可享受 15% 抵免 (基础上限 €9,040,最高 €1,356)。新合同 (2013 及以后) 已不再适用。需提供按揭购买日期 + 2025 年还款额才能精确估算。',
  eligibility: {
    countries: ['ES'],
    minAgeYears: 18,
    taxYears: [2025],
  },
  citation: {
    source: 'DT 18ª LIRPF (Ley 35/2006)',
    url: 'https://www.boe.es/eli/es/l/2006/11/28/35',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, _baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'ES') {
      return { applicable: false, reason: '此扣除项仅适用于西班牙', confidence: 1 };
    }
    return {
      applicable: true,
      reason:
        '此扣除项仅适用于 2013-01-01 前签订的按揭合同。最大节税额 €1,356/年 (基础上限 €9,040 × 15%)。需提供按揭购买日期 + 2025 年还款额',
      estimatedSavingsEur: null,
      confidence: 0.7,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
