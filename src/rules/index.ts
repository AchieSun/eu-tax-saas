/**
 * Unified F1 tax calculator entry point.
 * Dispatches to per-country rule engines based on input.country.
 *
 * Status: all 5 standard MVP countries (DE / NL / PT / ES / UK) implemented (W1+W2).
 */

import type { CalculatorInput, CalculatorResult } from './common/types';
import { calculatorInputSchema } from './common/types';
import { calculateDe } from './de/calculator';
import { calculateEs } from './es/calculator';
import { calculateNl } from './nl/calculator';
import { calculatePt } from './pt/calculator';
import { calculateUk } from './uk/calculator';

export type AnyCalculatorResult =
  | ReturnType<typeof calculateDe>
  | ReturnType<typeof calculateNl>
  | ReturnType<typeof calculatePt>
  | ReturnType<typeof calculateEs>
  | ReturnType<typeof calculateUk>;

/**
 * Per-country comparison entry that may surface a calc error
 * instead of silently disappearing from the response.
 */
export type CompareEntry =
  | { country: CalculatorInput['country']; ok: true; result: AnyCalculatorResult }
  | { country: CalculatorInput['country']; ok: false; error: string };

export function calculateTax(rawInput: unknown): AnyCalculatorResult {
  const input = calculatorInputSchema.parse(rawInput) as CalculatorInput;

  switch (input.country) {
    case 'DE':
      return calculateDe(input);
    case 'NL':
      return calculateNl(input);
    case 'PT':
      return calculatePt(input);
    case 'ES':
      return calculateEs(input);
    case 'UK':
      return calculateUk(input);
    default: {
      const _exhaustive: never = input.country;
      throw new Error(`Unhandled country: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Compare a given input across all 5 implemented countries.
 *
 * Returns ONLY the comparison results — preserves legacy AnyCalculatorResult[] shape
 * for existing callers. Silently skips countries that error (use compareCountriesDetailed
 * for the error-surfacing variant).
 *
 * IMPORTANT (apples-to-apples guarantee per Oracle W2 P1#1):
 * specialStatus is FORCED to 'none' inside this function so that one country
 * receiving a regime relief (e.g. UK FIG → £0) does not appear "free" against
 * non-relief peers. Regime-specific comparison is a separate feature (planned W6).
 */
export function compareCountries(input: Omit<CalculatorInput, 'country'>): AnyCalculatorResult[] {
  return compareCountriesDetailed(input)
    .filter((e): e is Extract<CompareEntry, { ok: true }> => e.ok)
    .map((e) => e.result);
}

/**
 * Same as compareCountries but returns one entry per country including errors,
 * so the UI can render an explicit "Could not compute for FR: …" card instead
 * of silently dropping it.
 */
export function compareCountriesDetailed(input: Omit<CalculatorInput, 'country'>): CompareEntry[] {
  const implemented: CalculatorInput['country'][] = ['DE', 'NL', 'PT', 'ES', 'UK'];

  return implemented.map((country) => {
    try {
      // P1#1: force 'none' so cross-country comparison is apples-to-apples.
      const withRegion: Record<string, unknown> = {
        ...input,
        country,
        specialStatus: 'none',
      };
      if (country === 'ES' && !withRegion.region) withRegion.region = 'MAD';
      if (country === 'UK' && !withRegion.region) withRegion.region = 'EWN';

      return { country, ok: true as const, result: calculateTax(withRegion) };
    } catch (err) {
      return {
        country,
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export type { CalculatorInput, CalculatorResult };
export { calculatorInputSchema };
