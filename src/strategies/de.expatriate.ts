/**
 * F4 — DE Auslandstätigkeitserlass (Foreign Service Tax Exemption)
 *
 * Source (verified 2026-06-08):
 *   - BMF-Schreiben 10.06.2022 zum Auslandstätigkeitserlass:
 *     https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Lohnsteuer/2022-06-10-auslandstaetigkeitserlass.html
 *   - § 34c Abs. 5 EStG: https://www.gesetze-im-internet.de/estg/__34c.html
 *
 * The DE calculator cannot model ATE without per-day foreign work data.
 * This strategy returns applicable:true with null saving (confidence 0.7)
 * to surface the regime for manual review.
 */

import type { CalculatorInput } from '../rules/common/types';
import { registerStrategy } from './registry';
import type { BaselineTax, Strategy, StrategyEvaluation } from './types';

const ID = 'de.expatriate';

const STRATEGY: Strategy = {
  id: ID,
  tier: 'A',
  category: 'special_status',
  titleZh: '德国 ATE — 海外派遣免税 (Auslandstätigkeitserlass)',
  descriptionZh:
    '德国《所得税法》§ 34c Abs. 5 + BMF 2022-06-10 通函规定:在非协定国从事合格海外活动 (工程、建筑、研发、特定咨询) 连续≥3个月的德国税务居民,可申请对海外赚取部分免征 Einkommensteuer (受 § 32b 进步保留条款约束)。注意:若派遣国与德国签有避免双重征税协定 (DBA),则适用 DBA 优先,ATE 不适用。',
  titleEn: 'Germany ATE — foreign-assignment income exemption (Auslandstätigkeitserlass)',
  descriptionEn:
    'Under § 34c(5) EStG plus the BMF circular of 2022-06-10: German tax residents who carry out qualifying foreign activities (engineering, construction, R&D, specific consulting) for ≥3 consecutive months in a non-treaty country can apply for exemption of the foreign-earned portion from Einkommensteuer (subject to the § 32b progression-clause reservation). Note: if the host country has a double-taxation treaty (DBA) with Germany, the DBA prevails and the ATE does not apply.',
  eligibility: {
    countries: ['DE'],
    incomeTypes: ['salary'],
    minAgeYears: 18,
    taxYears: [2025, 2026],
  },
  citation: {
    source: 'BMF-Schreiben 10.06.2022 (Auslandstätigkeitserlass) + § 34c Abs. 5 EStG',
    url: 'https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Lohnsteuer/2022-06-10-auslandstaetigkeitserlass.html',
    lastVerified: '2026-06-08',
  },
  evaluate(input: CalculatorInput, _baseline: BaselineTax): StrategyEvaluation {
    if (input.country !== 'DE') {
      return {
        applicable: false,
        reason: '此策略仅适用于德国税务居民',
        reasonEn: 'This strategy only applies to German tax residents',
        confidence: 1,
      };
    }
    if (input.incomeType !== 'salary') {
      return {
        applicable: false,
        reason: 'ATE 仅适用于工资所得',
        reasonEn: 'The ATE only covers employment income',
        confidence: 1,
      };
    }
    return {
      applicable: true,
      reason:
        'ATE 可能适用,但需要 F2 居民分析 + 海外工作天数明细才能精确估算节税额。如果您在非 DBA 国家从事工程/建筑/研发/咨询合格活动 ≥3 个月,请咨询税务师并通过 ELStAM 申请。',
      reasonEn:
        'The ATE may apply, but a precise saving estimate needs the F2 residency analysis plus a day-count breakdown of foreign workdays. If you performed qualifying engineering/construction/R&D/consulting activities for ≥3 months in a non-DBA country, consult a tax adviser and apply via ELStAM.',
      estimatedSavingsEur: null,
      confidence: 0.7,
    };
  },
};

registerStrategy(STRATEGY);

export default STRATEGY;
