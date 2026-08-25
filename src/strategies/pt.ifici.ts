/**
 * F4 — PT IFICI (Incentivo Fiscal à Investigação Científica e Inovação)
 *
 * Replaces the former NHR regime (closed to new entrants 2024-01-01).
 * 20% flat rate on qualifying Portuguese-source professional income for up
 * to 10 consecutive years.
 *
 * Source (verified 2026-06-08):
 *   - Art. 58.º-A EBF: https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/bf_rep/Pages/ebf058a.aspx
 *   - Created by Lei 82/2023 (OE 2024) + Portaria 352/2024.
 *
 * ⚠️ NHR is CLOSED to new entrants since 2024-01-01. NEVER recommend NHR.
 */

import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'pt.ifici';

const STRATEGY: Strategy = {
  id: ID,
  tier: 'A',
  category: 'special_status',
  titleZh: '葡萄牙 IFICI 20% 统一税率 (取代已关闭的 NHR)',
  descriptionZh:
    '葡萄牙 IFICI (科研与创新税收激励, art. 58.º-A EBF) 对合格的职业活动 (博士研究、R&D、合格初创等) 提供长达10年的20%统一税率,境外收入广义豁免。⚠️ 旧的NHR制度自2024-01-01对新申请人关闭,请勿使用NHR;IFICI是其替代品,资格条件不同(必须从事Portaria 352/2024列举的合格活动)。',
  titleEn: 'Portugal IFICI — 20% flat rate (replaces the closed NHR regime)',
  descriptionEn:
    "Portugal's IFICI (tax incentive for scientific research and innovation, art. 58.º-A EBF) offers a 20% flat rate for up to 10 years on qualifying professional activities (doctoral research, R&D, qualifying startups), with broad exemption of foreign income. ⚠️ The old NHR regime closed to new applicants on 2024-01-01 — do NOT rely on NHR; IFICI is its replacement with different eligibility (you must practise a qualifying activity listed in Portaria 352/2024).",
  eligibility: {
    countries: ['PT'],
    incomeTypes: ['salary', 'self_employed'],
    specialStatuses: ['ifici'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: 'Art. 58.º-A EBF (Lei 82/2023 + Portaria 352/2024)',
    url: 'https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/bf_rep/Pages/ebf058a.aspx',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'PT') {
      return {
        applicable: false,
        reason: '此策略仅适用于葡萄牙税务居民',
        reasonEn: 'This strategy only applies to Portuguese tax residents',
        confidence: 1,
      };
    }
    if (input.specialStatus !== 'ifici') {
      return {
        applicable: false,
        reason: '需要先通过 AT 葡萄牙税务局申请并被批准 IFICI 身份 (Portaria 352/2024 合格活动)',
        reasonEn:
          'You must first apply to and be approved by the Portuguese tax authority (AT) for IFICI status (a qualifying activity under Portaria 352/2024)',
        confidence: 1,
      };
    }
    if (input.incomeType !== 'salary' && input.incomeType !== 'self_employed') {
      return {
        applicable: false,
        reason: 'IFICI 仅适用于工资或自雇所得 (Cat A/B)',
        reasonEn: 'IFICI only covers employment or self-employment income (Category A/B)',
        confidence: 1,
      };
    }
    const ificiResult = calculateTax({ ...input, specialStatus: 'ifici' });
    const delta = baseline.taxOwed - ificiResult.taxOwed;
    if (delta <= 0) {
      return {
        applicable: false,
        reason: `当前收入水平下,累进 IRS 比 IFICI 20% 更划算,差额约 €${Math.round(-delta)}`,
        reasonEn: `At your income level the progressive IRS beats the IFICI 20% flat rate by roughly €${Math.round(-delta)}`,
        estimatedSavingsEur: 0,
        confidence: 1,
      };
    }
    return {
      applicable: true,
      reason: `相比累进 IRS,IFICI 20% 统一税率可节省约 €${Math.round(delta)}/年`,
      reasonEn: `Compared with progressive IRS, the IFICI 20% flat rate saves about €${Math.round(delta)}/year`,
      estimatedSavingsEur: Math.round(delta),
      confidence: 1,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
