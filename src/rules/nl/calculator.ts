/**
 * Netherlands — Inkomstenbelasting (Box 1, Box 2, Box 3) rule engine
 *
 * Sources:
 *   Belastingdienst Box 1: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/inkomstenbelasting/heffingskortingen_boxen_tarieven/boxen_en_tarieven/box_1/
 *   Belastingdienst voorlopige aanslag 2026: https://belastingdienst.nl/wps/wcm/connect/nl/voorlopige-aanslag/content/voorlopige-aanslag-tarieven-en-heffingskortingen
 *   Box 3 transitional regime ("Overbruggingswetgeving"): https://www.belastingdienst.nl/wps/wcm/connect/en/income-in-box-3/content/box-3-provisional-assessment-2026
 *   PwC Tax Summaries NL: https://taxsummaries.pwc.com/netherlands/individual/taxes-on-personal-income
 *   Deloitte Belastingplan 2026: https://www.deloitte.com/nl/en/services/tax/blogs/pakket-belastingplan-2026-tarieven-heffingskortingen.html
 *
 * IMPORTANT — Bracket-1 rate INCLUDES 27.65% premie volksverzekeringen (AOW/Anw/Wlz).
 * For taxpayers above AOW age (born ≥ 1946) bracket 1 is pure IB.
 *
 * 30% ruling: applies a reduction to taxable employment income (handled at frontend layer).
 *             This calculator accepts the post-ruling taxable income directly.
 */

import type { CalculatorInput, CalculatorResult, TaxBreakdownItem } from '../common/types';
import { floorEur, round } from '../common/types';

interface Bracket {
  upTo: number;
  rate: number;
}

interface Box1Params {
  underAow: Bracket[];
  overAow: Bracket[];
}

interface Box2Params {
  bracket1Limit: number;
  bracket1Rate: number;
  bracket2Rate: number;
}

interface Box3Params {
  rate: number;
  heffingsvrijPerPerson: number;
  rateBankBalances: number;
  rateOtherAssets: number;
  rateDebts: number;
  /** True when bank/debt rates are provisional (final figures published next year). */
  provisional: boolean;
}

interface HeffingskortingParams {
  max: number;
  startPhaseout: number;
  endPhaseout: number;
  phaseoutRate: number;
}

const NL_BOX1: Record<number, Box1Params> = {
  2025: {
    underAow: [
      { upTo: 38441, rate: 0.3582 },
      { upTo: 76817, rate: 0.3748 },
      { upTo: Number.POSITIVE_INFINITY, rate: 0.495 },
    ],
    overAow: [
      { upTo: 38441, rate: 0.1792 },
      { upTo: 76817, rate: 0.3748 },
      { upTo: Number.POSITIVE_INFINITY, rate: 0.495 },
    ],
  },
  2026: {
    underAow: [
      { upTo: 38883, rate: 0.3575 },
      { upTo: 78426, rate: 0.3756 },
      { upTo: Number.POSITIVE_INFINITY, rate: 0.495 },
    ],
    overAow: [
      { upTo: 38883, rate: 0.1785 },
      { upTo: 78426, rate: 0.3756 },
      { upTo: Number.POSITIVE_INFINITY, rate: 0.495 },
    ],
  },
};

const NL_BOX2: Record<number, Box2Params> = {
  2025: { bracket1Limit: 67804, bracket1Rate: 0.245, bracket2Rate: 0.31 },
  2026: { bracket1Limit: 68843, bracket1Rate: 0.245, bracket2Rate: 0.31 },
};

const NL_BOX3: Record<number, Box3Params> = {
  2025: {
    rate: 0.36,
    heffingsvrijPerPerson: 57684,
    rateBankBalances: 0.0144,
    rateOtherAssets: 0.0588,
    rateDebts: 0.0264,
    provisional: true,
  },
  2026: {
    rate: 0.36,
    heffingsvrijPerPerson: 59357,
    rateBankBalances: 0.0128,
    rateOtherAssets: 0.06,
    rateDebts: 0.027,
    provisional: true,
  },
};

const ALGEMENE_HEFFINGSKORTING: Record<number, HeffingskortingParams> = {
  2025: { max: 3068, startPhaseout: 28406, endPhaseout: 76817, phaseoutRate: 0.06337 },
  2026: { max: 3115, startPhaseout: 29736, endPhaseout: 78426, phaseoutRate: 0.06398 },
};

function applyBrackets(income: number, brackets: Bracket[]): { tax: number; marginalRate: number } {
  let tax = 0;
  let remaining = income;
  let lastRate = 0;
  let lastUpper = 0;
  for (const b of brackets) {
    const slice = Math.max(0, Math.min(remaining, b.upTo - lastUpper));
    tax += slice * b.rate;
    remaining -= slice;
    lastRate = income > lastUpper ? b.rate : lastRate;
    lastUpper = b.upTo;
    if (remaining <= 0) break;
  }
  return { tax, marginalRate: lastRate };
}

function algemeneHeffingskorting(income: number, year: number): number {
  const p = ALGEMENE_HEFFINGSKORTING[year];
  if (!p) return 0;
  if (income < p.startPhaseout) return p.max;
  if (income >= p.endPhaseout) return 0;
  return Math.max(0, p.max - p.phaseoutRate * (income - p.startPhaseout));
}

export function calculateBox1(input: CalculatorInput): CalculatorResult {
  const { grossIncome, taxYear, age } = input;
  const params = NL_BOX1[taxYear];
  if (!params) throw new Error(`NL Box 1 not coded for year ${taxYear}`);

  const isOverAow = (age ?? 0) >= 67;
  const brackets = isOverAow ? params.overAow : params.underAow;

  const { tax: grossTax, marginalRate } = applyBrackets(grossIncome, brackets);
  const korting = algemeneHeffingskorting(grossIncome, taxYear);
  const taxOwed = Math.max(0, grossTax - korting);

  const breakdown: TaxBreakdownItem[] = [
    {
      label: `Box 1 inkomstenbelasting + premie (${isOverAow ? 'AOW-leeftijd' : 'jonger dan AOW'})`,
      amount: grossTax,
      citation: 'Wet IB 2001 art. 2.10',
    },
    {
      label: 'Algemene heffingskorting',
      amount: -korting,
      citation: 'Wet IB 2001 art. 8.10',
    },
  ];

  return {
    country: 'NL',
    taxYear,
    grossIncome,
    taxOwed: floorEur(taxOwed),
    netIncome: grossIncome - taxOwed,
    effectiveRate: round(taxOwed / grossIncome, 4),
    marginalRate: round(marginalRate, 4),
    breakdown,
    source: 'Belastingdienst — Box 1 tarieven + Wet IB 2001',
  };
}

export interface Box2Input {
  taxYear: number;
  income: number;
}
export function calculateBox2({ taxYear, income }: Box2Input): CalculatorResult {
  const p = NL_BOX2[taxYear];
  if (!p) throw new Error(`NL Box 2 not coded for year ${taxYear}`);
  const bracket1 = Math.min(income, p.bracket1Limit);
  const bracket2 = Math.max(0, income - p.bracket1Limit);
  const tax = bracket1 * p.bracket1Rate + bracket2 * p.bracket2Rate;
  return {
    country: 'NL',
    taxYear,
    grossIncome: income,
    taxOwed: floorEur(tax),
    netIncome: income - tax,
    effectiveRate: round(tax / income, 4),
    marginalRate: income > p.bracket1Limit ? p.bracket2Rate : p.bracket1Rate,
    breakdown: [
      { label: 'Box 2 bracket 1', amount: bracket1 * p.bracket1Rate, rate: p.bracket1Rate },
      { label: 'Box 2 bracket 2', amount: bracket2 * p.bracket2Rate, rate: p.bracket2Rate },
    ],
    source: 'Belastingdienst — Box 2 aanmerkelijk belang',
  };
}

export interface Box3Input {
  taxYear: number;
  bankBalances: number;
  otherAssets: number;
  debts: number;
  /** Number of fiscal partners (1 or 2). Heffingsvrij vermogen scales linearly. */
  partners?: number;
}
export function calculateBox3({
  taxYear,
  bankBalances,
  otherAssets,
  debts,
  partners = 1,
}: Box3Input): CalculatorResult {
  const p = NL_BOX3[taxYear];
  if (!p) throw new Error(`NL Box 3 not coded for year ${taxYear}`);
  const totalAssets = bankBalances + otherAssets;
  const heffingsvrij = p.heffingsvrijPerPerson * partners;

  if (totalAssets - debts <= heffingsvrij) {
    return {
      country: 'NL',
      taxYear,
      grossIncome: totalAssets,
      taxOwed: 0,
      netIncome: totalAssets,
      effectiveRate: 0,
      marginalRate: 0,
      breakdown: [
        { label: `Heffingsvrij vermogen (${partners} partner)`, amount: 0, citation: 'Wet IB 2001 art. 5.5' },
      ],
      source: 'Belastingdienst — Box 3 overbruggingswet',
      provisional: p.provisional,
    };
  }

  const totalReturn =
    bankBalances * p.rateBankBalances + otherAssets * p.rateOtherAssets - debts * p.rateDebts;
  const effectiveReturnRate = totalAssets > 0 ? totalReturn / totalAssets : 0;
  const taxableBase = Math.max(0, totalAssets - heffingsvrij - debts);
  const box3Income = taxableBase * effectiveReturnRate;
  const tax = Math.max(0, box3Income * p.rate);

  return {
    country: 'NL',
    taxYear,
    grossIncome: totalAssets,
    taxOwed: floorEur(tax),
    netIncome: totalAssets - tax,
    effectiveRate: totalAssets > 0 ? round(tax / totalAssets, 4) : 0,
    marginalRate: p.rate,
    breakdown: [
      { label: 'Bankbalansen forfaitair', amount: bankBalances * p.rateBankBalances, rate: p.rateBankBalances },
      { label: 'Overige bezittingen forfaitair', amount: otherAssets * p.rateOtherAssets, rate: p.rateOtherAssets },
      { label: 'Schulden forfaitair (aftrek)', amount: -(debts * p.rateDebts), rate: p.rateDebts },
    ],
    source: 'Belastingdienst — Box 3 overbruggingswet',
    provisional: p.provisional,
  };
}

/** Default Box 1 entry point for the unified F1 calculator. */
export function calculateNl(input: CalculatorInput): CalculatorResult {
  return calculateBox1(input);
}
