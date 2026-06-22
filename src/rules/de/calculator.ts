/**
 * Germany — Lohnsteuer / Einkommensteuer rule engine
 *
 * Source: § 32a EStG 2025 (Steuerfortentwicklungsgesetz, BGBl. I 2024 Nr. 449)
 *   https://lsth.bundesfinanzministerium.de/lsth/2025/A-Einkommensteuergesetz/IV-Tarif-31-34b/Paragraf-32a/paragraf-32a.html
 * Source: § 32a EStG 2026
 *   https://esth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/IV-Tarif-31-34b/Paragraf-32a/paragraf-32a.html
 * Cross-validation: https://www.bmf-steuerrechner.de/ekst/eingabeformekst.xhtml
 *
 * Tariff zones:
 *   Zone 1: x ≤ Grundfreibetrag                       →  0
 *   Zone 2: Grundfreibetrag < x ≤ zone2_upper         →  (a·y + b)·y                where y = (x − Grundfreibetrag)/10000
 *   Zone 3: zone2_upper      < x ≤ zone3_upper        →  (a·z + b)·z + constant     where z = (x − zone2_upper)/10000
 *   Zone 4: zone3_upper      < x ≤ zone4_upper        →  0.42·x − zone4_subtract
 *   Zone 5: x > zone4_upper                           →  0.45·x − zone5_subtract    (Reichensteuer)
 *
 * Splittingverfahren (§ 32a Abs. 5): T(x_joint) = 2 · T(x_joint / 2)
 */

import type { CalculatorInput, CalculatorResult, TaxBreakdownItem } from '../common/types';
import { floorEur, round } from '../common/types';

interface TariffParams {
  grundfreibetrag: number;
  zone2_upper: number;
  zone3_upper: number;
  zone4_upper: number;
  zone2_a: number;
  zone2_b: number;
  zone3_a: number;
  zone3_b: number;
  zone3_constant: number;
  zone4_subtract: number;
  zone5_subtract: number;
}

const DE_2025: TariffParams = {
  grundfreibetrag: 12096,
  zone2_upper: 17443,
  zone3_upper: 68480,
  zone4_upper: 277825,
  zone2_a: 932.3,
  zone2_b: 1400,
  zone3_a: 176.64,
  zone3_b: 2397,
  zone3_constant: 1015.13,
  zone4_subtract: 10911.92,
  zone5_subtract: 19246.67,
};

const DE_2026: TariffParams = {
  grundfreibetrag: 12348,
  zone2_upper: 17799,
  zone3_upper: 69878,
  zone4_upper: 277825,
  zone2_a: 914.51,
  zone2_b: 1400,
  zone3_a: 173.1,
  zone3_b: 2397,
  zone3_constant: 1034.87,
  zone4_subtract: 11135.63,
  zone5_subtract: 19470.38,
};

// Solidaritätszuschlag (SolZG). 5.5% of income tax, phase-in via 11.9% Milderungszone.
// 2025 exemption: §3 SolZG (Steuerfortentwicklungsgesetz). 2026: provisional — verify when BMF publishes.
const SOLZ_RATE = 0.055;
const SOLZ_PHASE_IN_RATE = 0.119;
const SOLZ_EXEMPTION_SINGLE: Record<number, number> = {
  2025: 19950,
  2026: 19950, // provisional — BMF circular Q1 2026
};
const SOLZ_EXEMPTION_JOINT: Record<number, number> = {
  2025: 39900,
  2026: 39900, // provisional
};

function getParams(year: number): TariffParams {
  switch (year) {
    case 2025:
      return DE_2025;
    case 2026:
      return DE_2026;
    default:
      throw new Error(`DE tariff not coded for year ${year}`);
  }
}

/**
 * Pure tariff function T(x) per § 32a EStG. Returns whole-EUR floor-rounded tax.
 * Input must already be the taxable income (zvE), rounded DOWN to whole EUR.
 */
export function tariff(zvE: number, year: number): number {
  const x = floorEur(zvE);
  const p = getParams(year);

  if (x <= p.grundfreibetrag) {
    return 0;
  }
  let tax: number;
  if (x <= p.zone2_upper) {
    const y = (x - p.grundfreibetrag) / 10000;
    tax = (p.zone2_a * y + p.zone2_b) * y;
  } else if (x <= p.zone3_upper) {
    const z = (x - p.zone2_upper) / 10000;
    tax = (p.zone3_a * z + p.zone3_b) * z + p.zone3_constant;
  } else if (x <= p.zone4_upper) {
    tax = 0.42 * x - p.zone4_subtract;
  } else {
    tax = 0.45 * x - p.zone5_subtract;
  }
  return floorEur(tax);
}

/**
 * Marginal rate at zvE (for breakdown display).
 */
function marginalRate(zvE: number, year: number): number {
  const p = getParams(year);
  if (zvE <= p.grundfreibetrag) return 0;
  if (zvE <= p.zone2_upper)
    return 0.14 + (zvE - p.grundfreibetrag) * ((0.24 - 0.14) / (p.zone2_upper - p.grundfreibetrag));
  if (zvE <= p.zone3_upper)
    return 0.24 + (zvE - p.zone2_upper) * ((0.42 - 0.24) / (p.zone3_upper - p.zone2_upper));
  if (zvE <= p.zone4_upper) return 0.42;
  return 0.45;
}

function solidaritaetszuschlag(incomeTax: number, year: number, isJoint: boolean): number {
  const exemption = isJoint ? SOLZ_EXEMPTION_JOINT[year] : SOLZ_EXEMPTION_SINGLE[year];
  if (!exemption || incomeTax <= exemption) return 0;
  const phaseIn = SOLZ_PHASE_IN_RATE * (incomeTax - exemption);
  const fullRate = SOLZ_RATE * incomeTax;
  return Math.min(phaseIn, fullRate);
}

/**
 * Top-level DE calculator.
 * Note: gross-to-zvE conversion (Werbungskostenpauschale, Sonderausgaben, etc.) is NOT modelled here.
 * Caller supplies taxable income directly. F1 frontend will collect deductible amounts separately.
 */
export function calculateDe(input: CalculatorInput): CalculatorResult {
  const { grossIncome, taxYear, filingStatus } = input;
  const isJoint = filingStatus === 'married_joint';
  const year = taxYear;

  let incomeTax: number;
  if (isJoint) {
    // Splittingverfahren: T(joint) = 2 · T(joint / 2)
    incomeTax = 2 * tariff(grossIncome / 2, year);
  } else {
    incomeTax = tariff(grossIncome, year);
  }

  const solz = solidaritaetszuschlag(incomeTax, year, isJoint);
  const totalTax = incomeTax + solz;
  const netIncome = grossIncome - totalTax;

  const breakdown: TaxBreakdownItem[] = [
    {
      label: 'Einkommensteuer (§ 32a EStG)',
      amount: incomeTax,
      citation: '§ 32a EStG',
    },
  ];
  if (solz > 0) {
    breakdown.push({
      label: 'Solidaritätszuschlag',
      amount: solz,
      rate: SOLZ_RATE,
      citation: 'SolZG § 3, § 4',
    });
  }

  return {
    country: 'DE',
    taxYear: year,
    grossIncome,
    taxOwed: totalTax,
    netIncome,
    effectiveRate: round(totalTax / grossIncome, 4),
    marginalRate: round(marginalRate(isJoint ? grossIncome / 2 : grossIncome, year), 4),
    breakdown,
    source: 'BMF — Bundesministerium der Finanzen, § 32a EStG',
    provisional: year === 2026, // SolZ thresholds provisional until late 2025 circular
  };
}
