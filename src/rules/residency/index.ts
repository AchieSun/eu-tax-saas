/**
 * F2 Tax-Residency Decision Tree
 *
 * Per-country domestic residency tests + OECD Model Tax Convention art. 4
 * tiebreaker for dual-residency conflicts.
 *
 * Sources (verified 2026-06-03):
 *   ES — art. 9 LIRPF (Ley 35/2006 del Impuesto sobre la Renta de las Personas Físicas)
 *   PT — art. 16 CIRS (Código do Imposto sobre o Rendimento das Pessoas Singulares)
 *   DE — § 8 + § 9 AO (Abgabenordnung) — Wohnsitz / gewöhnlicher Aufenthalt
 *   NL — art. 4 AWR (Algemene wet inzake rijksbelastingen) — facts-and-circumstances
 *   UK — Finance Act 2013 Sch.45 (Statutory Residence Test); delegates to ../uk/calculator.ts
 *   Tiebreaker — OECD Model Tax Convention art. 4(2)
 *
 * Scope (MVP):
 *   - Full-year residency only (no split-year / Cases 1–8)
 *   - Skips ship/aircraft crew edge cases (PT art. 16(1)(d))
 *   - Permanent-home declaration is a single boolean (real OECD test needs per-country
 *     declaration — flagged as a warning in the tiebreaker path).
 *
 * Out of scope:
 *   - Split-year treatment
 *   - Beckham / IFICI / FIG / 30% / Forschungspauschale special status (those are F3)
 *   - Treaty residency overrides outside the OECD Model (UN Model, bilateral protocols)
 */

import { srtTest, type SrtInput } from '../uk/calculator';
import type { Country } from '../common/types';

// ───────────────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────────────

export type ResidencyInput = {
  country: Country;
  taxYear: number;
  daysInCountry: number;
  daysInOtherCountries: Record<string, number>;
  hasPermanentHome: boolean | null;
  spouseChildrenIn: string | null;
  centerOfVitalInterests: string | null;
  habitualAbode: string | null;
  nationality?: string | null;
  /** UK-only: extra SRT inputs. Merged with defaults when country='UK'. */
  srt?: Partial<SrtInput>;
  /**
   * UK-only: pre-computed SRT sufficient ties count (0–5).
   * When provided, this value is used directly instead of the default `ties: 0`.
   * If omitted, a warning is emitted suggesting the caller use
   * POST /api/residency/uk-srt-ties for accurate tie computation.
   */
  srtTiesCount?: number;
};

export type ResidencyResult = {
  country: Country;
  isResident: boolean;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  appliedRules: string[];
  tiebreaker: 'OECD_model_art4' | null;
  warnings: string[];
};

export type MultiCountryAssessment = {
  perCountry: ResidencyResult[];
  effectiveResidence: {
    country: Country | null;
    reason: string;
    tiebreakerApplied: boolean;
  };
};

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function formatReasoning(
  country: Country,
  isResident: boolean,
  confidence: 'high' | 'medium' | 'low',
  appliedRules: { rule: string; explanation: string }[],
  warnings: string[],
): string {
  const verdict = isResident ? 'YES' : 'NO';
  const rulesBlock = appliedRules.length
    ? appliedRules.map((r) => `- ${r.rule}: ${r.explanation}`).join('\n')
    : '- (none — no applicable rule fired)';
  const warningsBlock = warnings.length ? warnings.map((w) => `- ${w}`).join('\n') : '(none)';
  return [
    `**Country: ${country}** — Resident: ${verdict} (${confidence} confidence)`,
    '',
    'Applied rules:',
    rulesBlock,
    '',
    `Warnings: ${warnings.length ? '' : '(none)'}`,
    warnings.length ? warningsBlock : '',
  ]
    .filter((l) => l !== '' || true)
    .join('\n')
    .trimEnd();
}

function confidenceForNonResident(days: number): 'high' | 'medium' {
  return days < 90 ? 'high' : 'medium';
}

// ───────────────────────────────────────────────────────────────────────────
// Per-country assessments
// ───────────────────────────────────────────────────────────────────────────

function assessEs(input: ResidencyInput): ResidencyResult {
  const warnings: string[] = [];
  const applied: { rule: string; explanation: string }[] = [];

  // Rule 1: 183-day test (art. 9.1.a LIRPF)
  if (input.daysInCountry > 183) {
    applied.push({
      rule: 'ES.183day',
      explanation: `${input.daysInCountry} days in ES exceeds 183-day threshold (art. 9 LIRPF)`,
    });
    return {
      country: 'ES',
      isResident: true,
      confidence: 'high',
      appliedRules: applied.map((a) => a.rule),
      tiebreaker: null,
      warnings,
      reasoning: formatReasoning('ES', true, 'high', applied, warnings),
    };
  }

  // Rule 2: centre of economic/personal interests (art. 9.1.b LIRPF)
  if (input.centerOfVitalInterests === 'ES') {
    applied.push({
      rule: 'ES.center_of_interests',
      explanation: 'Centre of economic / personal interests is in ES (art. 9.1.b LIRPF)',
    });
    return {
      country: 'ES',
      isResident: true,
      confidence: 'medium',
      appliedRules: applied.map((a) => a.rule),
      tiebreaker: null,
      warnings,
      reasoning: formatReasoning('ES', true, 'medium', applied, warnings),
    };
  }

  // Rule 3: spouse/children presumption (art. 9.1.b §2 LIRPF)
  if (input.spouseChildrenIn === 'ES') {
    applied.push({
      rule: 'ES.spouse_children',
      explanation:
        'Spouse and dependent children habitually resident in ES — rebuttable presumption (art. 9.1.b §2 LIRPF)',
    });
    return {
      country: 'ES',
      isResident: true,
      confidence: 'medium',
      appliedRules: applied.map((a) => a.rule),
      tiebreaker: null,
      warnings,
      reasoning: formatReasoning('ES', true, 'medium', applied, warnings),
    };
  }

  // Default: not resident
  const conf = confidenceForNonResident(input.daysInCountry);
  return {
    country: 'ES',
    isResident: false,
    confidence: conf,
    appliedRules: [],
    tiebreaker: null,
    warnings,
    reasoning: formatReasoning('ES', false, conf, [], warnings),
  };
}

function assessPt(input: ResidencyInput): ResidencyResult {
  const warnings: string[] = [];
  const applied: { rule: string; explanation: string }[] = [];

  // Rule 1: 183-day test (art. 16(1)(a) CIRS)
  if (input.daysInCountry > 183) {
    applied.push({
      rule: 'PT.183day',
      explanation: `${input.daysInCountry} days in PT exceeds 183-day threshold (art. 16(1)(a) CIRS)`,
    });
    return {
      country: 'PT',
      isResident: true,
      confidence: 'high',
      appliedRules: applied.map((a) => a.rule),
      tiebreaker: null,
      warnings,
      reasoning: formatReasoning('PT', true, 'high', applied, warnings),
    };
  }

  // Rule 2: habitual residence — some presence + permanent home with intent (art. 16(1)(b) CIRS)
  if (input.daysInCountry > 0 && input.hasPermanentHome === true) {
    applied.push({
      rule: 'PT.habitual_residence',
      explanation:
        'Habitual residence: permanent home maintained in PT with presence in the tax year (art. 16(1)(b) CIRS)',
    });
    return {
      country: 'PT',
      isResident: true,
      confidence: 'medium',
      appliedRules: applied.map((a) => a.rule),
      tiebreaker: null,
      warnings,
      reasoning: formatReasoning('PT', true, 'medium', applied, warnings),
    };
  }

  const conf = confidenceForNonResident(input.daysInCountry);
  return {
    country: 'PT',
    isResident: false,
    confidence: conf,
    appliedRules: [],
    tiebreaker: null,
    warnings,
    reasoning: formatReasoning('PT', false, conf, [], warnings),
  };
}

function assessDe(input: ResidencyInput): ResidencyResult {
  const warnings: string[] = [];
  const applied: { rule: string; explanation: string }[] = [];

  // Rule 1: Wohnsitz — dwelling kept and used (§ 8 AO)
  if (input.hasPermanentHome === true && input.daysInCountry > 0) {
    applied.push({
      rule: 'DE.wohnsitz',
      explanation:
        'Wohnsitz: dwelling maintained in DE under circumstances indicating retention and use (§ 8 AO)',
    });
    return {
      country: 'DE',
      isResident: true,
      confidence: 'high',
      appliedRules: applied.map((a) => a.rule),
      tiebreaker: null,
      warnings,
      reasoning: formatReasoning('DE', true, 'high', applied, warnings),
    };
  }

  // Rule 2: gewöhnlicher Aufenthalt — habitual abode >6 months (§ 9 AO)
  if (input.daysInCountry > 183) {
    warnings.push(
      'Gewöhnlicher Aufenthalt (§ 9 AO) requires CONTINUOUS 6+ months; this implementation approximates by yearly day count — review for split stays',
    );
    applied.push({
      rule: 'DE.gewohnlicher_aufenthalt',
      explanation: `${input.daysInCountry} days in DE — approximates the 6-month continuous-presence threshold (§ 9 AO)`,
    });
    return {
      country: 'DE',
      isResident: true,
      confidence: 'medium',
      appliedRules: applied.map((a) => a.rule),
      tiebreaker: null,
      warnings,
      reasoning: formatReasoning('DE', true, 'medium', applied, warnings),
    };
  }

  const conf = confidenceForNonResident(input.daysInCountry);
  return {
    country: 'DE',
    isResident: false,
    confidence: conf,
    appliedRules: [],
    tiebreaker: null,
    warnings,
    reasoning: formatReasoning('DE', false, conf, [], warnings),
  };
}

function assessNl(input: ResidencyInput): ResidencyResult {
  const warnings: string[] = ['NL test is facts-based; consult tax advisor'];
  const applied: { rule: string; explanation: string }[] = [];

  let positiveFactors = 0;
  const factorNotes: string[] = [];
  if (input.hasPermanentHome === true) {
    positiveFactors += 1;
    factorNotes.push('permanent home declared');
  }
  if (input.spouseChildrenIn === 'NL') {
    positiveFactors += 1;
    factorNotes.push('spouse/children in NL');
  }
  if (input.centerOfVitalInterests === 'NL') {
    positiveFactors += 1;
    factorNotes.push('centre of vital interests in NL');
  }
  if (input.habitualAbode === 'NL') {
    positiveFactors += 1;
    factorNotes.push('habitual abode in NL');
  }
  if (input.daysInCountry > 90) {
    positiveFactors += 1;
    factorNotes.push(`${input.daysInCountry} days in NL (>90)`);
  }

  const factorSummary = factorNotes.length ? factorNotes.join(', ') : 'no positive factors';

  if (positiveFactors >= 3) {
    applied.push({
      rule: 'NL.facts_strong',
      explanation: `${positiveFactors} positive factors (${factorSummary}) — strong facts-and-circumstances case (art. 4 AWR)`,
    });
    return {
      country: 'NL',
      isResident: true,
      confidence: 'high',
      appliedRules: applied.map((a) => a.rule),
      tiebreaker: null,
      warnings,
      reasoning: formatReasoning('NL', true, 'high', applied, warnings),
    };
  }

  if (positiveFactors >= 1) {
    applied.push({
      rule: 'NL.facts_weak',
      explanation: `${positiveFactors} positive factor(s) (${factorSummary}) — weak facts-and-circumstances case (art. 4 AWR)`,
    });
    return {
      country: 'NL',
      isResident: true,
      confidence: 'low',
      appliedRules: applied.map((a) => a.rule),
      tiebreaker: null,
      warnings,
      reasoning: formatReasoning('NL', true, 'low', applied, warnings),
    };
  }

  return {
    country: 'NL',
    isResident: false,
    confidence: 'medium',
    appliedRules: [],
    tiebreaker: null,
    warnings,
    reasoning: formatReasoning('NL', false, 'medium', [], warnings),
  };
}

function assessUk(input: ResidencyInput): ResidencyResult {
  const warnings: string[] = [];
  const ties = input.srtTiesCount ?? input.srt?.ties ?? 0;

  if (input.srtTiesCount === undefined && input.srt?.ties === undefined) {
    warnings.push(
      'UK判定基于假设ties=0 — 请调用 POST /api/residency/uk-srt-ties 获取准确ties。',
    );
  }

  const srtInput: SrtInput = {
    daysInUk: input.daysInCountry,
    wasResidentInAnyOfPrior3Years: input.srt?.wasResidentInAnyOfPrior3Years ?? false,
    ties,
    fullTimeWorkOverseas: input.srt?.fullTimeWorkOverseas ?? false,
    daysWorkingInUk: input.srt?.daysWorkingInUk ?? 0,
    hasUkHome91Days: input.srt?.hasUkHome91Days ?? (input.hasPermanentHome === true),
    presentInUkHome30Days: input.srt?.presentInUkHome30Days ?? false,
    noOverseasHomeOrLittlePresent: input.srt?.noOverseasHomeOrLittlePresent ?? false,
    fullTimeUkWork365: input.srt?.fullTimeUkWork365 ?? false,
  };

  const srt = srtTest(srtInput);
  const ruleId = `UK.SRT.${srt.reason}`;
  // Auto tests are conclusive (high); sufficient-ties tests carry more judgement (medium).
  const confidence: 'high' | 'medium' = srt.reason.startsWith('auto-') ? 'high' : 'medium';

  const applied = [
    {
      rule: ruleId,
      explanation: `SRT reason '${srt.reason}' (${srt.arriverOrLeaver}, ${srt.daysInUk} UK days, ${srt.ties} ties${
        srt.tiesRequired !== null ? `, required ${srt.tiesRequired}` : ''
      }) per FA 2013 Sch.45`,
    },
  ];

  return {
    country: 'UK',
    isResident: srt.resident,
    confidence,
    appliedRules: [ruleId],
    tiebreaker: null,
    warnings,
    reasoning: formatReasoning('UK', srt.resident, confidence, applied, warnings),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

export function assessResidency(input: ResidencyInput): ResidencyResult {
  switch (input.country) {
    case 'ES':
      return assessEs(input);
    case 'PT':
      return assessPt(input);
    case 'DE':
      return assessDe(input);
    case 'NL':
      return assessNl(input);
    case 'UK':
      return assessUk(input);
    default: {
      // Exhaustiveness check — TS will error if Country gains a new variant.
      const _exhaustive: never = input.country;
      throw new Error(`Unsupported country: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Does the user have a permanent home in the given country, for the purposes
 * of OECD art. 4(2)(a) step 1?
 *
 * MVP simplification: hasPermanentHome is a single boolean covering "any
 * country" — we attribute it to a country if the user has days there
 * (their declared country or a `daysInOtherCountries` entry).
 */
function hasPermanentHomeIn(facts: ResidencyInput, country: Country): boolean {
  if (facts.hasPermanentHome !== true) return false;
  if (facts.country === country) return true;
  const otherDays = facts.daysInOtherCountries[country] ?? 0;
  return otherDays > 0;
}

export function assessAllCountries(inputs: ResidencyInput[]): MultiCountryAssessment {
  const perCountryRaw = inputs.map(assessResidency);
  const residents = perCountryRaw.filter((r) => r.isResident);

  if (residents.length === 0) {
    return {
      perCountry: perCountryRaw,
      effectiveResidence: {
        country: null,
        reason: 'no-country-claims-residency',
        tiebreakerApplied: false,
      },
    };
  }

  if (residents.length === 1) {
    return {
      perCountry: perCountryRaw,
      effectiveResidence: {
        country: residents[0].country,
        reason: 'single-country',
        tiebreakerApplied: false,
      },
    };
  }

  // 2+ residents → OECD Model Tax Convention art. 4(2) tiebreaker.
  // Tiebreaker facts are user-level, not country-level, so we read from the first
  // input (assumed uniform per-user data).
  const facts = inputs[0];
  let winner: Country | null = null;
  let reasonStep = 'mutual-agreement-required';

  // Step 1: permanent home
  const homeCandidates = residents.filter((r) => hasPermanentHomeIn(facts, r.country));
  if (homeCandidates.length === 1) {
    winner = homeCandidates[0].country;
    reasonStep = 'permanent-home';
  }

  // Step 2: centre of vital interests
  if (!winner && facts.centerOfVitalInterests) {
    const match = residents.find((r) => r.country === facts.centerOfVitalInterests);
    if (match) {
      winner = match.country;
      reasonStep = 'vital-interests';
    }
  }

  // Step 3: habitual abode
  if (!winner && facts.habitualAbode) {
    const match = residents.find((r) => r.country === facts.habitualAbode);
    if (match) {
      winner = match.country;
      reasonStep = 'habitual-abode';
    }
  }

  // Step 4: nationality
  if (!winner && facts.nationality) {
    const match = residents.find((r) => r.country === facts.nationality);
    if (match) {
      winner = match.country;
      reasonStep = 'nationality';
    }
  }
  // Step 5: mutual agreement — no algorithmic answer, winner stays null.

  const residentCountries = new Set(residents.map((r) => r.country));
  const perCountry: ResidencyResult[] = perCountryRaw.map((r) =>
    residentCountries.has(r.country) ? { ...r, tiebreaker: 'OECD_model_art4' as const } : r,
  );

  return {
    perCountry,
    effectiveResidence: {
      country: winner,
      reason: reasonStep,
      tiebreakerApplied: true,
    },
  };
}
