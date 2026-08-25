/**
 * F4 i18n (双语波) - bilingual-copy completeness for the bundled registry.
 *
 * The Strategy interface keeps titleEn/descriptionEn optional so legacy test
 * fixtures and Tier C LLM evaluations may omit them, but EVERY bundled
 * A/B-tier strategy MUST ship real bilingual copy:
 *   - titleEn / descriptionEn present, non-empty, visibly English, and not
 *     a copy of the Chinese string;
 *   - evaluate() returns a non-empty `reasonEn` on every branch reachable
 *     with the generic input matrix below (deeper branches are covered by
 *     the per-strategy unit tests, which construct targeted inputs).
 *
 * Referenced from the `reasonEn` / `titleEn` doc comments in ./types.ts.
 */

import { describe, expect, it } from 'vitest';
import { calculateTax } from '../rules';
import type { CalculatorInput, Country, FilingStatus, SpecialStatus } from '../rules/common/types';
import { STRATEGIES } from './index';
import type { BaselineTax } from './types';

// Importing './index' side-effect-registers all bundled strategies.

/** Defensive region defaults mirroring /evaluate's baseline defaulting. */
const REGION_DEFAULTS: Partial<Record<Country, string>> = { ES: 'MAD', UK: 'EWN' };

const TAX_YEAR = 2025;

function baselineFor(country: Country): BaselineTax | null {
  try {
    const result = calculateTax({
      country,
      taxYear: TAX_YEAR,
      incomeType: 'salary',
      grossIncome: 80_000,
      specialStatus: 'none',
      filingStatus: 'single',
      region: REGION_DEFAULTS[country],
    });
    return {
      country: result.country,
      taxYear: result.taxYear,
      grossIncome: result.grossIncome,
      taxOwed: result.taxOwed,
      netIncome: result.netIncome,
      effectiveRate: result.effectiveRate,
      marginalRate: result.marginalRate,
    };
  } catch {
    return null;
  }
}

/**
 * Generic input matrix: every special status × every filing status × a few
 * income types, per strategy-eligible country. Not every combination is
 * meaningful for every strategy - that is fine, we only assert that whatever
 * branch each reachable combination returns carries a non-empty reasonEn.
 */
function* inputVariants(country: Country): Generator<CalculatorInput> {
  const statuses: SpecialStatus[] = [
    'none',
    'beckham',
    'ifici',
    'fig',
    '30pct_ruling',
    'forschungspauschale',
  ];
  const filings: FilingStatus[] = ['single', 'married_joint'];
  for (const specialStatus of statuses) {
    for (const filingStatus of filings) {
      yield {
        country,
        taxYear: TAX_YEAR,
        incomeType: 'salary',
        grossIncome: 80_000,
        specialStatus,
        filingStatus,
        region: REGION_DEFAULTS[country],
        age: 35,
      };
    }
  }
}

describe('bundled strategy registry - bilingual copy completeness (i18n)', () => {
  it('registers all 22 bundled strategies', () => {
    expect(STRATEGIES.length).toBe(22);
  });

  it('every bundled strategy ships non-empty, English titleEn + descriptionEn', () => {
    expect(STRATEGIES.length).toBeGreaterThan(0);
    for (const s of STRATEGIES) {
      expect(s.titleEn, `${s.id}: titleEn must be present`).toBeTruthy();
      expect((s.titleEn ?? '').trim().length, `${s.id}: titleEn must be non-empty`).toBeGreaterThan(
        0,
      );
      expect(
        /[A-Za-z]{3,}/.test(s.titleEn ?? ''),
        `${s.id}: titleEn should contain English words`,
      ).toBe(true);
      expect(s.titleEn).not.toBe(s.titleZh);

      expect(s.descriptionEn, `${s.id}: descriptionEn must be present`).toBeTruthy();
      expect(
        (s.descriptionEn ?? '').trim().length,
        `${s.id}: descriptionEn must be non-empty`,
      ).toBeGreaterThan(0);
      expect(
        /[A-Za-z]{3,}/.test(s.descriptionEn ?? ''),
        `${s.id}: descriptionEn should contain English words`,
      ).toBe(true);
      expect(s.descriptionEn).not.toBe(s.descriptionZh);
    }
  });

  it('every reachable evaluate() branch returns a non-empty reasonEn', () => {
    for (const s of STRATEGIES) {
      const countries = s.eligibility.countries.filter((c) => c !== undefined);
      expect(countries.length, `${s.id}: must declare eligible countries`).toBeGreaterThan(0);
      let evaluated = 0;
      for (const country of countries) {
        const baseline = baselineFor(country);
        if (baseline === null) continue;
        for (const input of inputVariants(country)) {
          let result: ReturnType<typeof s.evaluate> | null = null;
          try {
            result = s.evaluate(input, baseline);
          } catch {
            // Strategy rejected this synthetic input (missing niche fields,
            // unsupported combination, …) - throwing is acceptable here;
            // targeted branches are covered by per-strategy tests.
            continue;
          }
          evaluated += 1;
          expect(
            result.reasonEn,
            `${s.id}: evaluate(${country}, ${input.specialStatus}, ${input.filingStatus}) returned reason without reasonEn`,
          ).toBeTruthy();
          expect(
            (result.reasonEn ?? '').trim().length,
            `${s.id}: reasonEn must be non-empty`,
          ).toBeGreaterThan(0);
        }
      }
      // Sanity: the matrix must actually reach at least one branch per
      // strategy, otherwise the assertion above is vacuous.
      expect(evaluated, `${s.id}: input matrix reached zero evaluate() branches`).toBeGreaterThan(
        0,
      );
    }
  });
});
