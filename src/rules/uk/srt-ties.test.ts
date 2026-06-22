/**
 * UK SRT "Sufficient Ties" — unit tests.
 *
 * Covers all 5 tie functions, the composite computeSrtTies, and the
 * determineUkResidence threshold table.
 */

import { describe, expect, it } from 'vitest';
import {
  type SrtTiesAnswers,
  arriverTiesRequired,
  computeAccommodationTie,
  computeCountryTie,
  computeFamilyTie,
  computeNinetyDayTie,
  computeSrtTies,
  computeWorkTie,
  determineUkResidence,
  leaverTiesRequired,
} from './srt-ties';

// ── Helpers ────────────────────────────────────────────────────────────────

function baseAnswers(overrides: Partial<SrtTiesAnswers> = {}): SrtTiesAnswers {
  return {
    familyResidentInUk: false,
    hasAccommodationAvailable91Days: false,
    spentNightInAccommodation: false,
    ukWorkDays: 0,
    ukDaysPriorYear1: 0,
    ukDaysPriorYear2: 0,
    isLeaver: false,
    countryWithMostDays: null,
    ...overrides,
  };
}

// ── Individual tie tests ───────────────────────────────────────────────────

describe('computeFamilyTie', () => {
  it('returns true when family is UK-resident', () => {
    expect(computeFamilyTie(baseAnswers({ familyResidentInUk: true }))).toBe(true);
  });

  it('returns false when family is not UK-resident', () => {
    expect(computeFamilyTie(baseAnswers({ familyResidentInUk: false }))).toBe(false);
  });
});

describe('computeAccommodationTie', () => {
  it('returns true when accommodation available ≥91 days AND night spent', () => {
    expect(
      computeAccommodationTie(
        baseAnswers({ hasAccommodationAvailable91Days: true, spentNightInAccommodation: true }),
      ),
    ).toBe(true);
  });

  it('returns false when accommodation available but no night spent', () => {
    expect(
      computeAccommodationTie(
        baseAnswers({ hasAccommodationAvailable91Days: true, spentNightInAccommodation: false }),
      ),
    ).toBe(false);
  });

  it('returns false when no accommodation available even if night spent', () => {
    expect(
      computeAccommodationTie(
        baseAnswers({ hasAccommodationAvailable91Days: false, spentNightInAccommodation: true }),
      ),
    ).toBe(false);
  });
});

describe('computeWorkTie', () => {
  it('returns false at 39 days (below threshold)', () => {
    expect(computeWorkTie(baseAnswers({ ukWorkDays: 39 }))).toBe(false);
  });

  it('returns true at 40 days (threshold boundary)', () => {
    expect(computeWorkTie(baseAnswers({ ukWorkDays: 40 }))).toBe(true);
  });

  it('returns true at 100 days (well above threshold)', () => {
    expect(computeWorkTie(baseAnswers({ ukWorkDays: 100 }))).toBe(true);
  });
});

describe('computeNinetyDayTie', () => {
  it('returns true when prior year 1 has ≥91 days', () => {
    expect(computeNinetyDayTie(baseAnswers({ ukDaysPriorYear1: 91, ukDaysPriorYear2: 0 }))).toBe(
      true,
    );
  });

  it('returns true when prior year 2 has ≥91 days (even if year 1 is 0)', () => {
    expect(computeNinetyDayTie(baseAnswers({ ukDaysPriorYear1: 0, ukDaysPriorYear2: 120 }))).toBe(
      true,
    );
  });

  it('returns false when both prior years are <91', () => {
    expect(computeNinetyDayTie(baseAnswers({ ukDaysPriorYear1: 90, ukDaysPriorYear2: 90 }))).toBe(
      false,
    );
  });

  it('returns false when both prior years are 0', () => {
    expect(computeNinetyDayTie(baseAnswers({ ukDaysPriorYear1: 0, ukDaysPriorYear2: 0 }))).toBe(
      false,
    );
  });
});

describe('computeCountryTie', () => {
  it('returns true for leaver with countryWithMostDays === "UK"', () => {
    expect(computeCountryTie(baseAnswers({ isLeaver: true, countryWithMostDays: 'UK' }))).toBe(
      true,
    );
  });

  it('returns false for leaver with countryWithMostDays !== "UK"', () => {
    expect(computeCountryTie(baseAnswers({ isLeaver: true, countryWithMostDays: 'ES' }))).toBe(
      false,
    );
  });

  it('returns null for arriver (not applicable)', () => {
    expect(computeCountryTie(baseAnswers({ isLeaver: false, countryWithMostDays: 'UK' }))).toBe(
      null,
    );
  });
});

// ── Composite computeSrtTies tests ─────────────────────────────────────────

describe('computeSrtTies', () => {
  it('all false / 0 → 0 ties', () => {
    const result = computeSrtTies(baseAnswers());
    expect(result.count).toBe(0);
    expect(result.ties.family).toBe(false);
    expect(result.ties.accommodation).toBe(false);
    expect(result.ties.work).toBe(false);
    expect(result.ties.ninetyDay).toBe(false);
    expect(result.ties.country).toBe(null);
    expect(result.rationale).toHaveLength(5);
  });

  it('family only → 1 tie', () => {
    const result = computeSrtTies(baseAnswers({ familyResidentInUk: true }));
    expect(result.count).toBe(1);
    expect(result.ties.family).toBe(true);
  });

  it('family + work (40 days) → 2 ties', () => {
    const result = computeSrtTies(baseAnswers({ familyResidentInUk: true, ukWorkDays: 40 }));
    expect(result.count).toBe(2);
    expect(result.ties.family).toBe(true);
    expect(result.ties.work).toBe(true);
  });

  it('leaver with all ties → 5 ties', () => {
    const result = computeSrtTies(
      baseAnswers({
        familyResidentInUk: true,
        hasAccommodationAvailable91Days: true,
        spentNightInAccommodation: true,
        ukWorkDays: 40,
        ukDaysPriorYear1: 91,
        ukDaysPriorYear2: 0,
        isLeaver: true,
        countryWithMostDays: 'UK',
      }),
    );
    expect(result.count).toBe(5);
    expect(result.ties.family).toBe(true);
    expect(result.ties.accommodation).toBe(true);
    expect(result.ties.work).toBe(true);
    expect(result.ties.ninetyDay).toBe(true);
    expect(result.ties.country).toBe(true);
  });

  it('arriver with countryWithMostDays="UK" → country tie is null', () => {
    const result = computeSrtTies(
      baseAnswers({
        familyResidentInUk: true,
        isLeaver: false,
        countryWithMostDays: 'UK',
      }),
    );
    expect(result.ties.country).toBe(null);
    expect(result.count).toBe(1); // only family
  });
});

// ── Threshold table tests ──────────────────────────────────────────────────

describe('leaverTiesRequired', () => {
  it('returns null for <16 days', () => {
    expect(leaverTiesRequired(15)).toBe(null);
  });

  it('returns 4 for 16–45 days', () => {
    expect(leaverTiesRequired(16)).toBe(4);
    expect(leaverTiesRequired(30)).toBe(4);
    expect(leaverTiesRequired(45)).toBe(4);
  });

  it('returns 3 for 46–90 days', () => {
    expect(leaverTiesRequired(46)).toBe(3);
    expect(leaverTiesRequired(90)).toBe(3);
  });

  it('returns 2 for 91–120 days', () => {
    expect(leaverTiesRequired(91)).toBe(2);
    expect(leaverTiesRequired(120)).toBe(2);
  });

  it('returns 1 for 121–182 days', () => {
    expect(leaverTiesRequired(121)).toBe(1);
    expect(leaverTiesRequired(182)).toBe(1);
  });

  it('returns null for ≥183 days (automatic UK)', () => {
    expect(leaverTiesRequired(183)).toBe(null);
  });
});

describe('arriverTiesRequired', () => {
  it('returns null for <46 days', () => {
    expect(arriverTiesRequired(45)).toBe(null);
  });

  it('returns 4 for 46–90 days', () => {
    expect(arriverTiesRequired(46)).toBe(4);
    expect(arriverTiesRequired(90)).toBe(4);
  });

  it('returns 3 for 91–120 days', () => {
    expect(arriverTiesRequired(91)).toBe(3);
    expect(arriverTiesRequired(120)).toBe(3);
  });

  it('returns 2 for 121–182 days', () => {
    expect(arriverTiesRequired(121)).toBe(2);
    expect(arriverTiesRequired(182)).toBe(2);
  });

  it('returns null for ≥183 days (automatic UK)', () => {
    expect(arriverTiesRequired(183)).toBe(null);
  });
});

// ── determineUkResidence tests ─────────────────────────────────────────────

describe('determineUkResidence', () => {
  // Test 9: Arriver 46 days + 4 ties → resident
  it('Arriver 46 days + 4 ties → resident', () => {
    const result = determineUkResidence({ ukDays: 46, ties: 4, isLeaver: false });
    expect(result.resident).toBe(true);
    expect(result.reason).toContain('meet the required');
  });

  // Test 10: Arriver 45 days + 4 ties → non-resident (automatic overseas)
  it('Arriver 45 days + 4 ties → non-resident (automatic overseas)', () => {
    const result = determineUkResidence({ ukDays: 45, ties: 4, isLeaver: false });
    expect(result.resident).toBe(false);
    expect(result.reason).toContain('Automatic non-resident');
  });

  // Test 11: Arriver 183 days + 0 ties → resident (automatic)
  it('Arriver 183 days + 0 ties → resident (automatic)', () => {
    const result = determineUkResidence({ ukDays: 183, ties: 0, isLeaver: false });
    expect(result.resident).toBe(true);
    expect(result.reason).toContain('Automatic UK resident');
  });

  // Test 12: Leaver 16 days + 4 ties → resident
  it('Leaver 16 days + 4 ties → resident', () => {
    const result = determineUkResidence({ ukDays: 16, ties: 4, isLeaver: true });
    expect(result.resident).toBe(true);
    expect(result.reason).toContain('meet the required');
  });

  it('Leaver 15 days + 4 ties → non-resident (automatic overseas)', () => {
    const result = determineUkResidence({ ukDays: 15, ties: 4, isLeaver: true });
    expect(result.resident).toBe(false);
    expect(result.reason).toContain('Automatic non-resident');
  });

  it('Arriver 100 days + 2 ties → non-resident (needs 3)', () => {
    const result = determineUkResidence({ ukDays: 100, ties: 2, isLeaver: false });
    expect(result.resident).toBe(false);
    expect(result.reason).toContain('below the required');
  });
});
