/**
 * F4 — ES Beckham (Régimen Especial Impatriados)
 *
 * Spain's flat-tax regime for inbound expatriates under art. 93 LIRPF.
 * 24% on the first €600k of Spanish-source income, 47% on the excess.
 * Replaces the progressive IRPF for up to 6 tax years.
 *
 * Source (verified 2026-06-08):
 *   - Ley 35/2006, art. 93 (BOE): https://www.boe.es/eli/es/l/2006/11/28/35
 *   - Reformed by Ley 28/2022 ("Startups Law") effective 2023-01-01.
 */

import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'es.beckham';

const STRATEGY: Strategy = {
  id: ID,
  tier: 'A',
  category: 'special_status',
  titleZh: '西班牙 Beckham 法 — 6年24%统一税率（限新入境居民）',
  descriptionZh:
    '西班牙艺名"贝克汉姆法"(art. 93 LIRPF) 允许新入境的税务居民在6个税年内按24%统一税率纳税(收入<60万欧元部分;超出部分47%),通常在7-10万欧元工资以上即可击败累进税率。需在迁入后6个月内通过 Modelo 149 申请。',
  titleEn: 'Spain Beckham regime — 24% flat rate for 6 years (new residents only)',
  descriptionEn:
    'Spain\'s so-called "Beckham Law" (art. 93 LIRPF) lets newly arrived tax residents pay a flat 24% for up to 6 tax years (on the first €600k of Spanish-source income; 47% above). Typically beats progressive IRPF from roughly €70-100k salary. Apply via Modelo 149 within 6 months of moving.',
  eligibility: {
    countries: ['ES'],
    incomeTypes: ['salary', 'self_employed'],
    specialStatuses: ['beckham'],
    minAgeYears: 18,
    taxYears: [2025],
  },
  citation: {
    source: 'Ley 35/2006 art. 93 (modificado por Ley 28/2022 "Startups")',
    url: 'https://www.boe.es/eli/es/l/2006/11/28/35',
    lastVerified: '2020-01-01',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'ES') {
      return {
        applicable: false,
        reason: '此策略仅适用于西班牙税务居民',
        reasonEn: 'This strategy only applies to Spanish tax residents',
        confidence: 1,
      };
    }
    if (input.specialStatus !== 'beckham') {
      return {
        applicable: false,
        reason: '需要先通过 Modelo 149 申请 Beckham 身份才能享受 24% 统一税率',
        reasonEn:
          'You must first obtain Beckham status via Modelo 149 to qualify for the 24% flat rate',
        confidence: 1,
      };
    }
    if (input.incomeType !== 'salary' && input.incomeType !== 'self_employed') {
      return {
        applicable: false,
        reason: 'Beckham 法仅适用于工资或自雇所得',
        reasonEn: 'The Beckham regime only covers employment or self-employment income',
        confidence: 1,
      };
    }
    const beckhamResult = calculateTax({ ...input, specialStatus: 'beckham' });
    const delta = baseline.taxOwed - beckhamResult.taxOwed;
    if (delta <= 0) {
      return {
        applicable: false,
        reason: `当前收入水平下,累进税率比 Beckham 24% 更划算,差额约 €${Math.round(-delta)}`,
        reasonEn: `At your income level the progressive IRPF beats the Beckham 24% flat rate by roughly €${Math.round(-delta)}`,
        estimatedSavingsEur: 0,
        confidence: 1,
      };
    }
    return {
      applicable: true,
      reason: `相比累进 IRPF,Beckham 法可节省约 €${Math.round(delta)}/年`,
      reasonEn: `Compared with progressive IRPF, the Beckham regime saves about €${Math.round(delta)}/year`,
      estimatedSavingsEur: Math.round(delta),
      confidence: 1,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
