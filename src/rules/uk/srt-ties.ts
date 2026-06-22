/**
 * UK Statutory Residence Test (SRT) — "Sufficient Ties" questionnaire logic.
 *
 * Computes the 5 UK ties (family / accommodation / work / 90-day / country)
 * from questionnaire answers, then applies the days × ties threshold table
 * (HMRC RDR3) to determine UK residence.
 *
 * Sources:
 *   HMRC RDR3 (Statutory Residence Test) — https://www.gov.uk/government/publications/rdr3-statutory-residence-test-srt
 *   Finance Act 2013 Sch.45
 *
 * This module is the REVERSE of calculator.ts's srtTest(): instead of
 * accepting a pre-counted `ties` number, it DERIVES ties from raw facts.
 */

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface SrtTiesAnswers {
  /** Spouse / civil partner (not separated) or children under 18 are UK resident this tax year. */
  familyResidentInUk: boolean;
  /** Had accommodation available for ≥91 consecutive days in the UK this tax year. */
  hasAccommodationAvailable91Days: boolean;
  /** Spent ≥1 night in that accommodation (if relative's home, ≥16 nights). */
  spentNightInAccommodation: boolean;
  /** Number of UK work days where >3 hours were worked (0+). */
  ukWorkDays: number;
  /** UK days in the prior tax year (0–366). */
  ukDaysPriorYear1: number;
  /** UK days in the tax year before the prior one (0–366). */
  ukDaysPriorYear2: number;
  /** True if the individual was UK-resident in ANY of the prior 3 tax years (= "leaver"). */
  isLeaver: boolean;
  /**
   * Country with the most days spent in this tax year (for country tie).
   * Only meaningful when isLeaver is true; arrivers ignore this field.
   */
  countryWithMostDays: string | null;
}

export interface SrtTieDetail {
  family: boolean;
  accommodation: boolean;
  work: boolean;
  ninetyDay: boolean;
  /** null when not applicable (arriver — country tie only applies to leavers). */
  country: boolean | null;
}

export interface SrtTiesResult {
  ties: SrtTieDetail;
  count: number;
  /** One-line rationale per tie (and for ties that didn't fire). */
  rationale: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// Individual tie functions
// ───────────────────────────────────────────────────────────────────────────

/**
 * Family tie (HMRC RDR3 §2.3).
 * Met if the individual's spouse / civil partner (not separated) or any
 * child under 18 is UK-resident in the tax year.
 */
export function computeFamilyTie(answers: SrtTiesAnswers): boolean {
  return answers.familyResidentInUk;
}

/**
 * Accommodation tie (HMRC RDR3 §2.5).
 * Met if the individual has accommodation available for ≥91 consecutive days
 * in the UK during the tax year AND spent at least 1 night there.
 * If the accommodation is a relative's home, ≥16 nights are required.
 *
 * SIMPLIFICATION: we accept a single boolean for "spent ≥1 night (or ≥16 if
 * relative's home)" — the questionnaire can clarify which threshold applies.
 */
export function computeAccommodationTie(answers: SrtTiesAnswers): boolean {
  return answers.hasAccommodationAvailable91Days && answers.spentNightInAccommodation;
}

/**
 * Work tie (HMRC RDR3 §2.7).
 * Met if the individual worked in the UK for ≥40 days in the tax year.
 * Each day must involve >3 hours of work to count as a UK work day.
 */
export function computeWorkTie(answers: SrtTiesAnswers): boolean {
  return answers.ukWorkDays >= 40;
}

/**
 * 90-day tie (HMRC RDR3 §2.9).
 * Met if the individual spent ≥91 days in the UK in EITHER of the prior
 * 2 tax years.
 */
export function computeNinetyDayTie(answers: SrtTiesAnswers): boolean {
  return answers.ukDaysPriorYear1 >= 91 || answers.ukDaysPriorYear2 >= 91;
}

/**
 * Country tie (HMRC RDR3 §2.11).
 * ONLY applies to leavers (individuals UK-resident in any of the prior
 * 3 tax years). Met if the UK is one of the countries where the individual
 * spent the most days in the tax year.
 *
 * Returns null for arrivers (not applicable).
 */
export function computeCountryTie(answers: SrtTiesAnswers): boolean | null {
  if (!answers.isLeaver) return null;
  return answers.countryWithMostDays === 'UK';
}

// ───────────────────────────────────────────────────────────────────────────
// Composite computation
// ───────────────────────────────────────────────────────────────────────────

export function computeSrtTies(answers: SrtTiesAnswers): SrtTiesResult {
  const family = computeFamilyTie(answers);
  const accommodation = computeAccommodationTie(answers);
  const work = computeWorkTie(answers);
  const ninetyDay = computeNinetyDayTie(answers);
  const country = computeCountryTie(answers);

  const rationale: string[] = [];

  if (family) {
    rationale.push(
      'Family tie: spouse/civil partner or child under 18 is UK-resident (RDR3 §2.3).',
    );
  } else {
    rationale.push(
      'No family tie: no UK-resident spouse/civil partner or child under 18 (RDR3 §2.3).',
    );
  }

  if (accommodation) {
    rationale.push(
      'Accommodation tie: UK accommodation available for ≥91 consecutive days with ≥1 night spent (RDR3 §2.5).',
    );
  } else {
    rationale.push(
      'No accommodation tie: no UK accommodation available for ≥91 consecutive days, or no night spent (RDR3 §2.5).',
    );
  }

  if (work) {
    rationale.push(`Work tie: ${answers.ukWorkDays} UK work days (≥40 threshold met) (RDR3 §2.7).`);
  } else {
    rationale.push(
      `No work tie: ${answers.ukWorkDays} UK work days (below 40-day threshold) (RDR3 §2.7).`,
    );
  }

  if (ninetyDay) {
    rationale.push(
      `90-day tie: ${answers.ukDaysPriorYear1} days (prior year) / ${answers.ukDaysPriorYear2} days (year before) — at least one ≥91 (RDR3 §2.9).`,
    );
  } else {
    rationale.push(
      `No 90-day tie: ${answers.ukDaysPriorYear1} days (prior year) and ${answers.ukDaysPriorYear2} days (year before) — neither ≥91 (RDR3 §2.9).`,
    );
  }

  if (country === true) {
    rationale.push(
      'Country tie: UK is the country with most days spent this tax year (RDR3 §2.11).',
    );
  } else if (country === false) {
    rationale.push(
      `No country tie: most days spent in ${answers.countryWithMostDays ?? 'another country'} (RDR3 §2.11).`,
    );
  } else {
    rationale.push('Country tie: not applicable (arriver — RDR3 §2.11 applies only to leavers).');
  }

  // Count: family + accommodation + work + ninetyDay + (country ?? 0)
  const count =
    (family ? 1 : 0) +
    (accommodation ? 1 : 0) +
    (work ? 1 : 0) +
    (ninetyDay ? 1 : 0) +
    (country === true ? 1 : 0);

  return {
    ties: { family, accommodation, work, ninetyDay, country },
    count,
    rationale,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Threshold table & residence determination
// ───────────────────────────────────────────────────────────────────────────

/**
 * Sufficient-ties threshold table — leaver (was UK-resident in any of prior 3 years).
 * Returns the minimum number of ties required for UK residence, or null if
 * the day count falls into an automatic overseas band.
 */
export function leaverTiesRequired(days: number): number | null {
  if (days >= 16 && days <= 45) return 4;
  if (days >= 46 && days <= 90) return 3;
  if (days >= 91 && days <= 120) return 2;
  if (days >= 121 && days <= 182) return 1;
  return null;
}

/**
 * Sufficient-ties threshold table — arriver (NOT UK-resident in any of prior 3 years).
 * Returns the minimum number of ties required for UK residence, or null if
 * the day count falls into an automatic overseas band.
 */
export function arriverTiesRequired(days: number): number | null {
  if (days >= 46 && days <= 90) return 4;
  if (days >= 91 && days <= 120) return 3;
  if (days >= 121 && days <= 182) return 2;
  return null;
}

export interface DetermineResidenceOpts {
  ukDays: number;
  ties: number;
  isLeaver: boolean;
}

export interface DetermineResidenceResult {
  resident: boolean;
  reason: string;
}

/**
 * Determine UK residence from the days × ties threshold table (HMRC RDR3).
 *
 * Steps:
 * 1. Automatic UK: ≥183 days → resident.
 * 2. Automatic overseas (leaver): <16 days → non-resident.
 * 3. Automatic overseas (arriver): <46 days → non-resident.
 * 4. Sufficient-ties test: compare `ties` against the threshold for the
 *    day band. If no band matches (tiesRequired === null), defaults to
 *    non-resident.
 */
export function determineUkResidence(opts: DetermineResidenceOpts): DetermineResidenceResult {
  const { ukDays, ties, isLeaver } = opts;

  // Step 1: automatic UK — 183+ days always conclusive.
  if (ukDays >= 183) {
    return {
      resident: true,
      reason: `Automatic UK resident: ${ukDays} days ≥ 183 (FA 2013 Sch.45).`,
    };
  }

  // Step 2: automatic overseas (leaver).
  if (isLeaver && ukDays < 16) {
    return {
      resident: false,
      reason: `Automatic non-resident (leaver): ${ukDays} days < 16 (FA 2013 Sch.45).`,
    };
  }

  // Step 3: automatic overseas (arriver).
  if (!isLeaver && ukDays < 46) {
    return {
      resident: false,
      reason: `Automatic non-resident (arriver): ${ukDays} days < 46 (FA 2013 Sch.45).`,
    };
  }

  // Step 4: sufficient-ties test.
  const tiesRequired = isLeaver ? leaverTiesRequired(ukDays) : arriverTiesRequired(ukDays);

  if (tiesRequired === null) {
    return {
      resident: false,
      reason: `Non-resident: ${ukDays} UK days with ${ties} tie(s) — no matching threshold band (FA 2013 Sch.45).`,
    };
  }

  const resident = ties >= tiesRequired;
  return {
    resident,
    reason: resident
      ? `UK resident: ${ties} tie(s) meet the required ${tiesRequired} for ${ukDays} UK days (FA 2013 Sch.45).`
      : `Non-resident: ${ties} tie(s) below the required ${tiesRequired} for ${ukDays} UK days (FA 2013 Sch.45).`,
  };
}
