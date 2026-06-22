/**
 * Spain — IRPF (Impuesto sobre la Renta de las Personas Físicas) rule engine — 2025
 *
 * Sources (verified 2026-06-03):
 *   AEAT Manual Práctico Renta 2025 — https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos.html
 *   Art. 63 LIRPF (escala general estatal) — Ley 35/2006 IRPF
 *   Madrid:    BOCM — Ley 13/2023 / D.Leg 1/2010 (unchanged 2025)
 *   Cataluña:  DOGC — ⚠️ CHANGED 2025 via Decret-llei 5/2025 retroactive 1 Jan 2025
 *              (bracket 1 rate cut 10.5% → 9.5%; consolidated 9 → 8 tramos)
 *   Valencia:  DOGV — Ley 13/1997 Hisenda GVA (unchanged 2025)
 *   Andalucía: BOJA — Decreto-ley 7/2022 + 2024 reform (unchanged 2025)
 *   Beckham regime: art. 93 LIRPF + Ley 28/2022 "Startups" (UNCHANGED 2024-2026)
 *
 * Methodology:
 *   1. Base imponible estatal  = max(0, gross − mínimo personal estatal)
 *   2. Base imponible autonómica = max(0, gross − mínimo personal CCAA)
 *   3. Cuota estatal     = applyBracketsCumulative(brackets_estatal,   baseEstatal)
 *   4. Cuota autonómica  = applyBracketsCumulative(brackets_ccaa,      baseAuto)
 *   5. Total = floor(cuota_estatal + cuota_autonómica)
 *
 * Beckham (art. 93 LIRPF) bypasses the entire scale: 24% to €600k, 47% over.
 * No mínimo personal applies; CCAA is irrelevant (federal-only regime).
 *
 * MVP scope (F1):
 *   - General income only (no savings/capital-gains scale)
 *   - Single filer, no dependents (mínimo personal individual only)
 *   - 4 CCAAs: MAD, CAT, VAL, AND
 *   - Regional deductions (e.g. Madrid rental) live in F4 strategy library, NOT here
 */

import type { CalculatorInput, CalculatorResult } from '../common/types';
import { floorEur, round } from '../common/types';

interface Bracket {
  upTo: number;
  rate: number;
}

type Ccaa = 'MAD' | 'CAT' | 'VAL' | 'AND';

const ES_ESTATAL_2025: Bracket[] = [
  { upTo: 12450, rate: 0.095 },
  { upTo: 20200, rate: 0.12 },
  { upTo: 35200, rate: 0.15 },
  { upTo: 60000, rate: 0.185 },
  { upTo: 300000, rate: 0.225 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.245 },
];

const ES_CCAA_2025: Record<Ccaa, Bracket[]> = {
  MAD: [
    { upTo: 13362.22, rate: 0.085 },
    { upTo: 19004.63, rate: 0.107 },
    { upTo: 35425.68, rate: 0.128 },
    { upTo: 57320.4, rate: 0.174 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.205 },
  ],
  // ⚠️ CHANGED 2025 via Decret-llei 5/2025 retroactive 1 Jan 2025
  CAT: [
    { upTo: 12450, rate: 0.095 }, // CUT from 10.5% → 9.5%
    { upTo: 17707, rate: 0.12 },
    { upTo: 33007, rate: 0.14 },
    { upTo: 53407, rate: 0.185 },
    { upTo: 90000, rate: 0.215 },
    { upTo: 120000, rate: 0.235 },
    { upTo: 175000, rate: 0.245 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.255 }, // 8 tramos (was 9)
  ],
  VAL: [
    { upTo: 12000, rate: 0.09 },
    { upTo: 22000, rate: 0.12 },
    { upTo: 32000, rate: 0.15 },
    { upTo: 42000, rate: 0.175 },
    { upTo: 62000, rate: 0.2 },
    { upTo: 82000, rate: 0.225 },
    { upTo: 122000, rate: 0.25 },
    { upTo: 175000, rate: 0.275 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.295 },
  ],
  AND: [
    { upTo: 13000, rate: 0.095 },
    { upTo: 21000, rate: 0.12 },
    { upTo: 35200, rate: 0.15 },
    { upTo: 50000, rate: 0.185 },
    { upTo: 60000, rate: 0.195 },
    { upTo: 120000, rate: 0.235 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.255 },
  ],
};

// Mínimo personal individual (single, age < 65, no dependents). Source: art. 57 LIRPF + per-CCAA leyes.
const ES_MINIMO_PERSONAL_2025: { ESTATAL: number } & Record<Ccaa, number> = {
  ESTATAL: 5550,
  MAD: 5956.65,
  CAT: 5550,
  VAL: 6105,
  AND: 5790,
};

const ES_BECKHAM_2025 = {
  threshold: 600000,
  rateBase: 0.24,
  rateOver: 0.47,
};

const SOURCE =
  'AEAT Manual Práctico Renta 2025; art. 63 LIRPF; per-CCAA fiscal laws (BOCM/DOGC/DOGV/BOJA)';

/**
 * Apply progressive brackets cumulatively: each slice taxed at its bracket's rate.
 * Returns { tax, marginalRate } — marginalRate is the highest bracket actually entered.
 */
function applyBracketsCumulative(
  brackets: Bracket[],
  baseImponible: number,
): { tax: number; marginalRate: number } {
  if (baseImponible <= 0) return { tax: 0, marginalRate: 0 };
  let tax = 0;
  let lastUpper = 0;
  let marginalRate = 0;
  for (const b of brackets) {
    if (baseImponible <= lastUpper) break;
    const slice = Math.min(baseImponible, b.upTo) - lastUpper;
    if (slice > 0) {
      tax += slice * b.rate;
      marginalRate = b.rate;
    }
    lastUpper = b.upTo;
    if (baseImponible <= b.upTo) break;
  }
  return { tax, marginalRate };
}

/**
 * Spain IRPF 2025 result. Extends the shared CalculatorResult shape with
 * Spain-specific structured breakdown (estatal / autonómico split, mínimo personal, CCAA).
 */
export interface EsCalculatorResult
  extends Omit<CalculatorResult, 'breakdown' | 'taxOwed' | 'netIncome'> {
  /** Floor-rounded total IRPF (estatal + autonómico, or Beckham flat). Alias of taxOwed for ES. */
  totalTax: number;
  /** Kept for compatibility with shared CalculatorResult consumers. */
  taxOwed: number;
  /** Kept for compatibility with shared CalculatorResult consumers. */
  netIncome: number;
  breakdown: {
    estatal: number;
    autonomico: number;
    minimoPersonalApplied: number;
    baseImponibleEstatal: number;
    baseImponibleAuto: number;
    specialStatus: string | null;
    ccaa: Ccaa | null;
  };
}

function isCcaa(x: string | undefined): x is Ccaa {
  return x === 'MAD' || x === 'CAT' || x === 'VAL' || x === 'AND';
}

export function calculateEs(input: CalculatorInput): EsCalculatorResult {
  const { grossIncome, taxYear, specialStatus, region } = input;

  if (taxYear !== 2025) {
    throw new Error(`ES calculator: only 2025 implemented; got ${taxYear}`);
  }

  // Beckham regime — federal flat tax, bypasses estatal/autonómico split entirely.
  if (specialStatus === 'beckham') {
    const base = Math.min(grossIncome, ES_BECKHAM_2025.threshold);
    const over = Math.max(0, grossIncome - ES_BECKHAM_2025.threshold);
    const tax = base * ES_BECKHAM_2025.rateBase + over * ES_BECKHAM_2025.rateOver;
    const totalTax = floorEur(tax);
    const marginalRate = over > 0 ? ES_BECKHAM_2025.rateOver : ES_BECKHAM_2025.rateBase;
    return {
      country: 'ES',
      taxYear: 2025,
      grossIncome,
      totalTax,
      taxOwed: totalTax,
      netIncome: grossIncome - totalTax,
      effectiveRate: grossIncome > 0 ? round(totalTax / grossIncome, 4) : 0,
      marginalRate,
      breakdown: {
        estatal: totalTax,
        autonomico: 0,
        minimoPersonalApplied: 0,
        baseImponibleEstatal: grossIncome,
        baseImponibleAuto: 0,
        specialStatus: 'beckham',
        ccaa: null,
      },
      source: SOURCE,
      provisional: false,
    };
  }

  if (!isCcaa(region)) {
    throw new Error(
      `Spain MVP supports CCAA: MAD, CAT, VAL, AND. Received: ${region ?? 'undefined'}`,
    );
  }

  const minEstatal = ES_MINIMO_PERSONAL_2025.ESTATAL;
  const minAuto = ES_MINIMO_PERSONAL_2025[region];

  const baseImponibleEstatal = Math.max(0, grossIncome - minEstatal);
  const baseImponibleAuto = Math.max(0, grossIncome - minAuto);

  const { tax: estatalTax, marginalRate: marginalEstatal } = applyBracketsCumulative(
    ES_ESTATAL_2025,
    baseImponibleEstatal,
  );
  const { tax: autoTax, marginalRate: marginalAuto } = applyBracketsCumulative(
    ES_CCAA_2025[region],
    baseImponibleAuto,
  );

  const totalTax = floorEur(estatalTax + autoTax);
  const marginalRate = Math.max(marginalEstatal, marginalAuto);

  return {
    country: 'ES',
    taxYear: 2025,
    grossIncome,
    totalTax,
    taxOwed: totalTax,
    netIncome: grossIncome - totalTax,
    effectiveRate: grossIncome > 0 ? round(totalTax / grossIncome, 4) : 0,
    marginalRate,
    breakdown: {
      estatal: round(estatalTax, 2),
      autonomico: round(autoTax, 2),
      minimoPersonalApplied: minEstatal + minAuto,
      baseImponibleEstatal,
      baseImponibleAuto,
      specialStatus: specialStatus === 'none' ? null : specialStatus,
      ccaa: region,
    },
    source: SOURCE,
    provisional: false,
  };
}
