/**
 * F4 (B-tier) — es.pension_fund
 *
 * Spain Plan de Pensiones individual contribution: €1,500 individual cap +
 * €8,500 if employer also contributes ≥ employee amount (art. 51 LIRPF +
 * Ley 12/2022 reform).
 *
 * Source (verified 2026-06-08):
 *   - Art. 51 LIRPF (límite anual):
 *     https://www.boe.es/eli/es/l/2006/11/28/35
 *   - Ley 12/2022 (planes de pensiones empleo):
 *     https://www.boe.es/eli/es/l/2022/06/30/12
 *
 * Default: assume user contributes the €1,500 cap → saving = contribution ×
 * marginal rate. confidence 0.7.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'es.pension_fund';

const ES_PENSION_INDIVIDUAL_CAP = 1_500;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'deduction',
  titleZh: '西班牙个人养老金计划扣除 (Plan de Pensiones)',
  descriptionZh:
    '《LIRPF》art. 51 允许年度个人养老金贡献 €1,500 扣除应税基数,若雇主同样匹配可叠加至 €8,500/年 (Ley 12/2022)。节税额约为贡献额 × 边际税率。本策略默认按 €1,500 估算上限节税。',
  titleEn: 'Spain personal pension plan deduction (Plan de Pensiones)',
  descriptionEn:
    'Art. 51 LIRPF allows deducting annual personal pension contributions of €1,500 from the taxable base; with a matching employer contribution the joint cap rises to €8,500/year (Ley 12/2022). The saving is roughly contribution × marginal rate. This strategy estimates the cap saving at the default €1,500.',
  eligibility: {
    countries: ['ES'],
    incomeTypes: ['salary', 'self_employed'],
    minAgeYears: 18,
    taxYears: [2025],
  },
  citation: {
    source: 'Art. 51 LIRPF + Ley 12/2022',
    url: 'https://www.boe.es/eli/es/l/2006/11/28/35',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'ES') {
      return {
        applicable: false,
        reason: '此扣除项仅适用于西班牙',
        reasonEn: 'This deduction only applies in Spain',
        confidence: 1,
      };
    }
    if (input.incomeType !== 'salary' && input.incomeType !== 'self_employed') {
      return {
        applicable: false,
        reason: '养老金扣除项要求 Cat A (工资) 或 Cat B (自雇) 收入',
        reasonEn:
          'The pension deduction requires Category A (employment) or B (self-employment) income',
        confidence: 1,
      };
    }
    const saving = Math.round(ES_PENSION_INDIVIDUAL_CAP * baseline.marginalRate);
    return {
      applicable: true,
      reason: `贡献 €${ES_PENSION_INDIVIDUAL_CAP} 个人养老金可按边际税率 ${(baseline.marginalRate * 100).toFixed(1)}% 节税约 €${saving}/年。若雇主同样匹配,联合上限可达 €8,500`,
      reasonEn: `Contributing €${ES_PENSION_INDIVIDUAL_CAP} to a personal pension plan saves about €${saving}/year at your ${(baseline.marginalRate * 100).toFixed(1)}% marginal rate. With a matching employer contribution the joint cap reaches €8,500`,
      estimatedSavingsEur: saving,
      confidence: 0.7,
      assumptions: [
        {
          field: 'pensionContributionEur',
          defaultValue: ES_PENSION_INDIVIDUAL_CAP,
          rationale: `Assumes user contributes the €${ES_PENSION_INDIVIDUAL_CAP} individual cap (LIRPF art. 51). Employer-matched contributions raise the joint cap to €8,500/yr (Ley 12/2022)`,
        },
      ],
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
