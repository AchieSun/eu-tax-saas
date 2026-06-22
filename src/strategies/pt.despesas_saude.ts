/**
 * F4 (B-tier) — pt.despesas_saude
 *
 * Portugal health expenses tax credit: 15% of qualifying medical expenses,
 * capped at €1,000/year (art. 78.º-C CIRS).
 *
 * Source (verified 2026-06-08):
 *   - Art. 78.º-C CIRS: https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs78c.aspx
 *
 * Numeric policy (Oracle Wave A+B P2#2):
 *   - The actual saving is min(€1,000, 0.15 × medicalExpensesEur).
 *   - We DO NOT have a `medicalExpensesEur` field on CalculatorInput today,
 *     so we cannot compute the exact saving. Returning the €1,000 ceiling by
 *     default would silently overstate the typical user's benefit (median PT
 *     household medical spend ≈ €1,500/yr → saving ≈ €225, not €1,000).
 *   - Therefore: `estimatedSavingsEur = null` with `confidence = 0.5` and a
 *     reason that surfaces the input gap. The UI can render this as
 *     "no estimate — needs your medical-expense data" rather than a misleading
 *     "€1,000/yr" badge.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'pt.despesas_saude';

const PT_HEALTH_CAP_EUR = 1_000;
const PT_HEALTH_RATE = 0.15;
/** Spend at which 15% × spend reaches the €1,000 cap. */
const PT_HEALTH_CAP_SPEND_EUR = PT_HEALTH_CAP_EUR / PT_HEALTH_RATE;

const STRATEGY: Strategy = {
  id: ID,
  tier: 'B',
  category: 'deduction',
  titleZh: '葡萄牙医疗费用抵免 (Despesas de Saúde, 15% 上限 €1,000)',
  descriptionZh:
    '《CIRS》art. 78.º-C:15% 医疗费用 (含处方、医院、保险) 可抵免所得税,年度上限 €1,000 (即 ≥€6,667 医疗支出可达上限)。需通过 e-fatura 关联发票。需提供 medicalExpensesEur 才能精确估算实际节税额。',
  eligibility: {
    countries: ['PT'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: 'Art. 78.º-C CIRS',
    url: 'https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs78c.aspx',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, _baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'PT') {
      return { applicable: false, reason: '此抵免项仅适用于葡萄牙', confidence: 1 };
    }
    // Without a `medicalExpensesEur` field on the input, we cannot compute the
    // 15% × spend deduction. Surface the input gap rather than defaulting to
    // the €1,000 ceiling (which is the BEST case at ≥ €6,667 spend, NOT the
    // expected case for an average PT taxpayer with ~€1,500 annual spend).
    return {
      applicable: true,
      reason: `葡萄牙医疗费用 15% 抵免 (上限 €1,000/年)。需提供年度医疗支出 (medicalExpensesEur) 才能给出实际节税估算 — 15% × 支出, 支出 ≥ €${Math.round(PT_HEALTH_CAP_SPEND_EUR).toLocaleString()} 时达到上限。当前未估算金额。`,
      estimatedSavingsEur: null,
      confidence: 0.5,
      assumptions: [
        {
          field: 'medicalExpensesEur',
          defaultValue: 0,
          rationale:
            'True savings depend on actual medical spend (15% × spend, capped at €1,000/yr). ' +
            'We default to €0 because median PT household medical spend ≈ €1,500/yr ' +
            '(→ €225 saving), making the €1,000 statutory ceiling misleading as a default.',
        },
      ],
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
