/**
 * United Kingdom — Income Tax rule engine (England/Wales/NI + Scotland) + Statutory Residence Test
 *
 * Sources (verified 2026-06-03):
 *   HMRC rates & allowances: https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past
 *   Scottish Income Tax 2025-26: https://www.gov.uk/scottish-income-tax/2025-to-2026-tax-year
 *   Welsh rates of income tax: https://www.gov.uk/welsh-income-tax (WRIT = 10p all bands → identical to England/NI)
 *   Statutory Residence Test (RDR3): https://www.gov.uk/government/publications/rdr3-statutory-residence-test-srt
 *
 * Statute:
 *   Income Tax Act 2007 ss.6–10 (basic/higher/additional rates)
 *   Finance Act 2025 (rates confirmed, PA frozen at £12,570)
 *   Finance Act 2025 Sch.9 (4-year FIG regime for new arrivers; remittance basis abolished 5 April 2025)
 *   Scotland Act 2016 s.13 (Scottish rate-setting powers); Scottish Rate Resolution 2025
 *   Finance Act 2013 Sch.45 (Statutory Residence Test)
 *
 * Scope (MVP):
 *   - Income Tax on non-savings, non-dividend income (employment / self-employment / pensions)
 *   - Personal Allowance + £100k taper
 *   - England/Wales/NI (EWN) and Scotland (SCOT) bands
 *   - FIG flag (4-year Foreign Income & Gains relief) — applies relief; does NOT verify eligibility
 *   - SRT full-year decision tree (no split-year)
 *
 * Out of scope (deferred):
 *   - NIC (Class 1/2/4), dividends (8.75/33.75/39.35%), savings (PSA), CGT
 *   - Split-year treatment (Cases 1–8)
 *   - Overseas Workday Relief (OWR), Temporary Repatriation Facility (TRF)
 *   - Marriage Allowance, Blind Person's Allowance, Pension contribution reliefs
 *   - Remittance basis (ABOLISHED 5 April 2025 — FA 2025)
 */

import type { CalculatorInput } from '../common/types';
import { floorEur } from '../common/types';

// ───────────────────────────────────────────────────────────────────────────
// Band tables
// ───────────────────────────────────────────────────────────────────────────

interface Band {
  upTo: number;
  rate: number;
}

// England / Wales / Northern Ireland — bands of TAXABLE income (after Personal Allowance)
// ITA 2007 ss.6–10; Finance Act 2025
const UK_EWN_BANDS_2025_26: Band[] = [
  { upTo: 37700, rate: 0.2 }, // basic
  { upTo: 125140, rate: 0.4 }, // higher
  { upTo: Number.POSITIVE_INFINITY, rate: 0.45 }, // additional
];

// Scotland — bands of TAXABLE income (after the UK-wide Personal Allowance).
// Cumulative tops + PA £12,570 should give total-income thresholds:
// 15,397 / 27,491 / 43,662 / 75,000 / 125,140.
// Scotland Act 2016 s.13; Scottish Rate Resolution 2025.
const UK_SCOTLAND_BANDS_2025_26: Band[] = [
  { upTo: 2827, rate: 0.19 }, // starter
  { upTo: 14921, rate: 0.2 }, // basic
  { upTo: 31092, rate: 0.21 }, // intermediate
  { upTo: 62430, rate: 0.42 }, // higher
  { upTo: 112570, rate: 0.45 }, // advanced
  { upTo: Number.POSITIVE_INFINITY, rate: 0.48 }, // top
];

// Personal Allowance — UK-wide (applies to Scottish taxpayers too)
const UK_PERSONAL_ALLOWANCE_2025_26 = {
  amount: 12570,
  taperThreshold: 100000,
  fullyWithdrawnAt: 125140,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Apply progressive bands cumulatively to a base amount.
 * Bands are expressed as cumulative `upTo` ceilings (not slice widths).
 * Returns total tax + marginal rate (highest band reached).
 */
function applyBracketsCumulative(
  bands: Band[],
  amount: number,
): { tax: number; marginalRate: number } {
  if (amount <= 0) return { tax: 0, marginalRate: 0 };
  let tax = 0;
  let remaining = amount;
  let lastTop = 0;
  let marginalRate = 0;
  for (const b of bands) {
    const sliceWidth = Math.max(0, b.upTo - lastTop);
    const slice = Math.min(remaining, sliceWidth);
    if (slice > 0) {
      tax += slice * b.rate;
      marginalRate = b.rate;
      remaining -= slice;
    }
    lastTop = b.upTo;
    if (remaining <= 0) break;
  }
  return { tax, marginalRate };
}

/**
 * Personal Allowance with £100k taper: lose £1 of PA for every £2 over £100k.
 * Rounded to whole £ (HMRC computes PA in whole pounds).
 */
function personalAllowance(grossIncome: number): number {
  const pa = UK_PERSONAL_ALLOWANCE_2025_26;
  const excess = Math.max(0, grossIncome - pa.taperThreshold);
  const reduced = pa.amount - excess / 2;
  return Math.max(0, Math.round(reduced));
}

function getBands(region: 'EWN' | 'SCOT'): Band[] {
  return region === 'SCOT' ? UK_SCOTLAND_BANDS_2025_26 : UK_EWN_BANDS_2025_26;
}

// ───────────────────────────────────────────────────────────────────────────
// Public result type
// ───────────────────────────────────────────────────────────────────────────

export interface UkCalculatorResult {
  country: 'UK';
  taxYear: 2025;
  grossIncome: number;
  /** Whole-£ tax. Mirrors `taxOwed` for backwards-compat with CalculatorResult. */
  totalTax: number;
  taxOwed: number;
  netIncome: number;
  effectiveRate: number;
  marginalRate: number;
  breakdown: {
    region: 'EWN' | 'SCOT';
    personalAllowance: number;
    taxable: number;
    specialStatus: string | null;
    note?: string;
  };
  warnings?: string[];
  source: string;
  provisional: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// calculateUk
// ───────────────────────────────────────────────────────────────────────────

const SOURCE =
  'HMRC gov.uk rates 2025-26; ITA 2007; Finance Act 2025; Scotland Act 2016 (Scottish bands)';

export function calculateUk(input: CalculatorInput): UkCalculatorResult {
  const { grossIncome, taxYear, specialStatus } = input;

  if (taxYear !== 2025) {
    throw new Error(`UK calculator: only tax year 2025 (2025-26) supported; got ${taxYear}`);
  }

  const regionRaw = input.region ?? 'EWN';
  if (regionRaw !== 'EWN' && regionRaw !== 'SCOT') {
    throw new Error(`UK calculator: region must be 'EWN' or 'SCOT'; got ${regionRaw}`);
  }
  const region: 'EWN' | 'SCOT' = regionRaw;

  // FIG regime — 4-year Foreign Income & Gains relief (FA 2025 Sch.9).
  // SIMPLIFICATION: we apply the relief flag only. Real eligibility requires:
  //   • 10 consecutive years of non-UK residence immediately prior, AND
  //   • within the first 4 tax years of becoming UK resident, AND
  //   • SA109 Box 28/29 claim.
  // F2 residency assessor must validate; this calculator just zeros the UK tax.
  if (specialStatus === 'fig') {
    return {
      country: 'UK',
      taxYear: 2025,
      grossIncome,
      totalTax: 0,
      taxOwed: 0,
      netIncome: grossIncome,
      effectiveRate: 0,
      marginalRate: 0,
      breakdown: {
        region,
        personalAllowance: 0,
        taxable: 0,
        specialStatus: 'fig',
        note: '4-year FIG relief — foreign income/gains exempt from UK tax for qualifying new residents (FA 2025 Sch.9). Requires SA109 Box 28/29 claim.',
      },
      warnings: [
        'FIG eligibility (10-year prior non-UK residence + 4-year window) not verified — confirm via residency assessment',
      ],
      source: SOURCE,
      provisional: false,
    };
  }

  const pa = personalAllowance(grossIncome);
  const taxable = Math.max(0, grossIncome - pa);
  const bands = getBands(region);
  const { tax, marginalRate } = applyBracketsCumulative(bands, taxable);
  const totalTax = floorEur(tax);

  return {
    country: 'UK',
    taxYear: 2025,
    grossIncome,
    totalTax,
    taxOwed: totalTax,
    netIncome: grossIncome - totalTax,
    effectiveRate: grossIncome > 0 ? totalTax / grossIncome : 0,
    marginalRate,
    breakdown: {
      region,
      personalAllowance: pa,
      taxable,
      specialStatus: specialStatus && specialStatus !== 'none' ? specialStatus : null,
    },
    source: SOURCE,
    provisional: false,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Statutory Residence Test (SRT)
// FA 2013 Sch.45; HMRC RDR3 guidance
// ───────────────────────────────────────────────────────────────────────────

export interface SrtInput {
  /** Days of UK presence in the tax year (0–366). */
  daysInUk: number;
  /** True if individual was UK-resident in ANY of the prior 3 tax years (= "leaver"). */
  wasResidentInAnyOfPrior3Years: boolean;
  /** Number of UK ties (0–5). Caller pre-counts (family/accommodation/work/90-day/country). */
  ties: number;
  /** Working full-time overseas (35 hrs/week avg) — for AOT3. */
  fullTimeWorkOverseas: boolean;
  /** UK workdays count (>3 hrs) — for AOT3 (must be < 31). */
  daysWorkingInUk: number;
  /** Has a UK home for ≥ 91 consecutive days in the tax year — for AUT2. */
  hasUkHome91Days: boolean;
  /** Present in that UK home ≥ 30 days in the tax year — for AUT2. */
  presentInUkHome30Days: boolean;
  /** No overseas home, OR overseas home but present < 30 days there — for AUT2. */
  noOverseasHomeOrLittlePresent: boolean;
  /** Worked full-time in UK for any 365-day period that falls (in part) in the tax year — for AUT3. */
  fullTimeUkWork365: boolean;
}

export type SrtReason =
  | 'auto-overseas-1'
  | 'auto-overseas-2'
  | 'auto-overseas-3'
  | 'auto-uk-1'
  | 'auto-uk-2'
  | 'auto-uk-3'
  | 'sufficient-ties-met'
  | 'sufficient-ties-not-met';

export interface SrtResult {
  resident: boolean;
  reason: SrtReason;
  arriverOrLeaver: 'arriver' | 'leaver';
  daysInUk: number;
  ties: number;
  /** From the days × ties table; null when an automatic test fired. */
  tiesRequired: number | null;
}

/** Sufficient-ties table — leaver (was UK-resident in any of prior 3 years). */
function leaverTiesRequired(days: number): number | null {
  if (days >= 16 && days <= 45) return 4;
  if (days >= 46 && days <= 90) return 3;
  if (days >= 91 && days <= 120) return 2;
  if (days >= 121 && days <= 182) return 1;
  return null;
}

/** Sufficient-ties table — arriver (NOT UK-resident in any of prior 3 years). */
function arriverTiesRequired(days: number): number | null {
  if (days >= 46 && days <= 90) return 4;
  if (days >= 91 && days <= 120) return 3;
  if (days >= 121 && days <= 182) return 2;
  return null;
}

export function srtTest(input: SrtInput): SrtResult {
  const {
    daysInUk,
    wasResidentInAnyOfPrior3Years,
    ties,
    fullTimeWorkOverseas,
    daysWorkingInUk,
    hasUkHome91Days,
    presentInUkHome30Days,
    noOverseasHomeOrLittlePresent,
    fullTimeUkWork365,
  } = input;

  const arriverOrLeaver: 'arriver' | 'leaver' = wasResidentInAnyOfPrior3Years
    ? 'leaver'
    : 'arriver';

  // Step 1: automatic UK shortcut — 183+ days always conclusive.
  if (daysInUk >= 183) {
    return {
      resident: true,
      reason: 'auto-uk-1',
      arriverOrLeaver,
      daysInUk,
      ties,
      tiesRequired: null,
    };
  }

  // Step 2: automatic overseas tests.
  if (wasResidentInAnyOfPrior3Years && daysInUk < 16) {
    return {
      resident: false,
      reason: 'auto-overseas-1',
      arriverOrLeaver,
      daysInUk,
      ties,
      tiesRequired: null,
    };
  }
  if (!wasResidentInAnyOfPrior3Years && daysInUk < 46) {
    return {
      resident: false,
      reason: 'auto-overseas-2',
      arriverOrLeaver,
      daysInUk,
      ties,
      tiesRequired: null,
    };
  }
  if (fullTimeWorkOverseas && daysInUk < 91 && daysWorkingInUk < 31) {
    return {
      resident: false,
      reason: 'auto-overseas-3',
      arriverOrLeaver,
      daysInUk,
      ties,
      tiesRequired: null,
    };
  }

  // Step 3: other automatic UK tests (AUT2 = only-home; AUT3 = full-time UK work).
  if (hasUkHome91Days && presentInUkHome30Days && noOverseasHomeOrLittlePresent) {
    return {
      resident: true,
      reason: 'auto-uk-2',
      arriverOrLeaver,
      daysInUk,
      ties,
      tiesRequired: null,
    };
  }
  if (fullTimeUkWork365) {
    return {
      resident: true,
      reason: 'auto-uk-3',
      arriverOrLeaver,
      daysInUk,
      ties,
      tiesRequired: null,
    };
  }

  // Step 4: sufficient-ties test.
  const tiesRequired = wasResidentInAnyOfPrior3Years
    ? leaverTiesRequired(daysInUk)
    : arriverTiesRequired(daysInUk);

  if (tiesRequired === null) {
    // Outside any ties-table band (e.g. arriver with daysInUk < 46 already handled;
    // any other gap defaults to NOT resident).
    return {
      resident: false,
      reason: 'sufficient-ties-not-met',
      arriverOrLeaver,
      daysInUk,
      ties,
      tiesRequired: null,
    };
  }

  const resident = ties >= tiesRequired;
  return {
    resident,
    reason: resident ? 'sufficient-ties-met' : 'sufficient-ties-not-met',
    arriverOrLeaver,
    daysInUk,
    ties,
    tiesRequired,
  };
}
