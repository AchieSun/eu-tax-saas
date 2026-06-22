/**
 * F2 Residency assessor — unit tests.
 * Covers ES / PT / DE / NL / UK + OECD Model Tax Convention art. 4 tiebreaker.
 */

import { describe, expect, it } from 'vitest';
import { type ResidencyInput, assessAllCountries, assessResidency } from './index';

describe('F2 Residency — ES', () => {
  const esBase = (o: Partial<ResidencyInput> = {}): ResidencyInput => ({
    country: 'ES',
    taxYear: 2025,
    daysInCountry: 0,
    daysInOtherCountries: {},
    hasPermanentHome: null,
    spouseChildrenIn: null,
    centerOfVitalInterests: null,
    habitualAbode: null,
    ...o,
  });

  it('183+ days → resident', () => {
    expect(assessResidency(esBase({ daysInCountry: 200 })).isResident).toBe(true);
  });

  it('exactly 183 → NOT resident (rule is >183)', () => {
    expect(assessResidency(esBase({ daysInCountry: 183 })).isResident).toBe(false);
  });

  it('center of interests in ES → resident', () => {
    expect(
      assessResidency(esBase({ daysInCountry: 50, centerOfVitalInterests: 'ES' })).isResident,
    ).toBe(true);
  });

  it('spouse+children in ES → resident', () => {
    expect(assessResidency(esBase({ daysInCountry: 50, spouseChildrenIn: 'ES' })).isResident).toBe(
      true,
    );
  });

  it('nothing → not resident high confidence', () => {
    const r = assessResidency(esBase({ daysInCountry: 30 }));
    expect(r.isResident).toBe(false);
    expect(r.confidence).toBe('high');
  });

  it('183-day rule cited in appliedRules', () => {
    expect(assessResidency(esBase({ daysInCountry: 200 })).appliedRules).toContain('ES.183day');
  });
});

describe('F2 Residency — PT', () => {
  const ptBase = (o: Partial<ResidencyInput> = {}): ResidencyInput => ({
    country: 'PT',
    taxYear: 2025,
    daysInCountry: 0,
    daysInOtherCountries: {},
    hasPermanentHome: null,
    spouseChildrenIn: null,
    centerOfVitalInterests: null,
    habitualAbode: null,
    ...o,
  });

  it('200 days → resident', () => {
    expect(assessResidency(ptBase({ daysInCountry: 200 })).isResident).toBe(true);
  });

  it('100 days + permanent home → resident', () => {
    expect(assessResidency(ptBase({ daysInCountry: 100, hasPermanentHome: true })).isResident).toBe(
      true,
    );
  });

  it('30 days, no home → not resident', () => {
    expect(assessResidency(ptBase({ daysInCountry: 30 })).isResident).toBe(false);
  });

  it('0 days, permanent home → not resident (needs some presence)', () => {
    expect(assessResidency(ptBase({ daysInCountry: 0, hasPermanentHome: true })).isResident).toBe(
      false,
    );
  });

  it('applied rule cited', () => {
    expect(assessResidency(ptBase({ daysInCountry: 200 })).appliedRules).toContain('PT.183day');
  });
});

describe('F2 Residency — DE', () => {
  const deBase = (o: Partial<ResidencyInput> = {}): ResidencyInput => ({
    country: 'DE',
    taxYear: 2025,
    daysInCountry: 0,
    daysInOtherCountries: {},
    hasPermanentHome: null,
    spouseChildrenIn: null,
    centerOfVitalInterests: null,
    habitualAbode: null,
    ...o,
  });

  it('Wohnsitz (permanent home + any presence) → resident', () => {
    expect(assessResidency(deBase({ daysInCountry: 10, hasPermanentHome: true })).isResident).toBe(
      true,
    );
  });

  it('200 days no home → resident via gewöhnlicher aufenthalt', () => {
    expect(assessResidency(deBase({ daysInCountry: 200 })).isResident).toBe(true);
  });

  it('0 days + permanent home → not resident', () => {
    expect(assessResidency(deBase({ daysInCountry: 0, hasPermanentHome: true })).isResident).toBe(
      false,
    );
  });

  it('30 days no home → not resident', () => {
    expect(assessResidency(deBase({ daysInCountry: 30 })).isResident).toBe(false);
  });

  it('Wohnsitz confidence high', () => {
    expect(assessResidency(deBase({ daysInCountry: 10, hasPermanentHome: true })).confidence).toBe(
      'high',
    );
  });
});

describe('F2 Residency — NL (facts-and-circumstances)', () => {
  const nlBase = (o: Partial<ResidencyInput> = {}): ResidencyInput => ({
    country: 'NL',
    taxYear: 2025,
    daysInCountry: 0,
    daysInOtherCountries: {},
    hasPermanentHome: null,
    spouseChildrenIn: null,
    centerOfVitalInterests: null,
    habitualAbode: null,
    ...o,
  });

  it('3+ factors → resident high confidence', () => {
    expect(
      assessResidency(
        nlBase({
          daysInCountry: 100,
          hasPermanentHome: true,
          spouseChildrenIn: 'NL',
          centerOfVitalInterests: 'NL',
        }),
      ).isResident,
    ).toBe(true);
  });

  it('1 factor → resident LOW confidence', () => {
    const r = assessResidency(nlBase({ hasPermanentHome: true }));
    expect(r.isResident).toBe(true);
    expect(r.confidence).toBe('low');
  });

  it('0 factors → not resident', () => {
    expect(assessResidency(nlBase({})).isResident).toBe(false);
  });

  it('always includes facts-based warning', () => {
    expect(assessResidency(nlBase({})).warnings.length).toBeGreaterThan(0);
  });

  it('low-confidence resident preserved (does NOT collapse to false)', () => {
    const r = assessResidency(nlBase({ hasPermanentHome: true }));
    expect(r.isResident).toBe(true);
  });
});

describe('F2 Residency — UK (SRT)', () => {
  const ukBase = (o: Partial<ResidencyInput> = {}): ResidencyInput => ({
    country: 'UK',
    taxYear: 2025,
    daysInCountry: 0,
    daysInOtherCountries: {},
    hasPermanentHome: null,
    spouseChildrenIn: null,
    centerOfVitalInterests: null,
    habitualAbode: null,
    srt: {},
    ...o,
  });

  it('183+ days → resident', () => {
    expect(assessResidency(ukBase({ daysInCountry: 200 })).isResident).toBe(true);
  });

  it('appliedRules includes SRT prefix', () => {
    expect(assessResidency(ukBase({ daysInCountry: 200 })).appliedRules[0]).toMatch(/^UK\.SRT\./);
  });

  it('10 days arriver → not resident', () => {
    expect(assessResidency(ukBase({ daysInCountry: 10 })).isResident).toBe(false);
  });

  it('60 days arriver + 4 ties → resident', () => {
    expect(assessResidency(ukBase({ daysInCountry: 60, srt: { ties: 4 } })).isResident).toBe(true);
  });

  it('60 days leaver + 1 tie → not resident', () => {
    expect(
      assessResidency(
        ukBase({ daysInCountry: 60, srt: { ties: 1, wasResidentInAnyOfPrior3Years: true } }),
      ).isResident,
    ).toBe(false);
  });
});

describe('F2 Residency — OECD tiebreaker', () => {
  it('1 country resident → no tiebreaker', () => {
    const r = assessAllCountries([
      {
        country: 'ES',
        taxYear: 2025,
        daysInCountry: 200,
        daysInOtherCountries: { DE: 50 },
        hasPermanentHome: null,
        spouseChildrenIn: null,
        centerOfVitalInterests: null,
        habitualAbode: null,
      },
      {
        country: 'DE',
        taxYear: 2025,
        daysInCountry: 50,
        daysInOtherCountries: { ES: 200 },
        hasPermanentHome: null,
        spouseChildrenIn: null,
        centerOfVitalInterests: null,
        habitualAbode: null,
      },
    ]);
    expect(r.effectiveResidence.tiebreakerApplied).toBe(false);
    expect(r.effectiveResidence.country).toBe('ES');
  });

  it('2 countries resident → tiebreaker via vital interests', () => {
    const r = assessAllCountries([
      {
        country: 'ES',
        taxYear: 2025,
        daysInCountry: 200,
        daysInOtherCountries: { DE: 100 },
        hasPermanentHome: null,
        spouseChildrenIn: null,
        centerOfVitalInterests: 'DE',
        habitualAbode: null,
      },
      {
        country: 'DE',
        taxYear: 2025,
        daysInCountry: 100,
        daysInOtherCountries: { ES: 200 },
        hasPermanentHome: true,
        spouseChildrenIn: null,
        centerOfVitalInterests: 'DE',
        habitualAbode: null,
      },
    ]);
    expect(r.effectiveResidence.tiebreakerApplied).toBe(true);
    expect(r.effectiveResidence.country).toBe('DE');
    expect(r.effectiveResidence.reason).toBe('vital-interests');
  });

  it('no resolution → null winner with mutual-agreement reason', () => {
    const r = assessAllCountries([
      {
        country: 'ES',
        taxYear: 2025,
        daysInCountry: 200,
        daysInOtherCountries: { PT: 200 },
        hasPermanentHome: null,
        spouseChildrenIn: null,
        centerOfVitalInterests: null,
        habitualAbode: null,
      },
      {
        country: 'PT',
        taxYear: 2025,
        daysInCountry: 200,
        daysInOtherCountries: { ES: 200 },
        hasPermanentHome: null,
        spouseChildrenIn: null,
        centerOfVitalInterests: null,
        habitualAbode: null,
      },
    ]);
    expect(r.effectiveResidence.tiebreakerApplied).toBe(true);
    expect(r.effectiveResidence.country).toBeNull();
    expect(r.effectiveResidence.reason).toBe('mutual-agreement-required');
  });

  it('no resident anywhere → null winner, no tiebreaker', () => {
    const r = assessAllCountries([
      {
        country: 'ES',
        taxYear: 2025,
        daysInCountry: 10,
        daysInOtherCountries: {},
        hasPermanentHome: null,
        spouseChildrenIn: null,
        centerOfVitalInterests: null,
        habitualAbode: null,
      },
      {
        country: 'PT',
        taxYear: 2025,
        daysInCountry: 10,
        daysInOtherCountries: {},
        hasPermanentHome: null,
        spouseChildrenIn: null,
        centerOfVitalInterests: null,
        habitualAbode: null,
      },
    ]);
    expect(r.effectiveResidence.tiebreakerApplied).toBe(false);
    expect(r.effectiveResidence.country).toBeNull();
    expect(r.effectiveResidence.reason).toBe('no-country-claims-residency');
  });

  it('tiebreaker resolved by nationality when no other facts decide', () => {
    const r = assessAllCountries([
      {
        country: 'ES',
        taxYear: 2025,
        daysInCountry: 200,
        daysInOtherCountries: { PT: 200 },
        hasPermanentHome: null,
        spouseChildrenIn: null,
        centerOfVitalInterests: null,
        habitualAbode: null,
        nationality: 'PT',
      },
      {
        country: 'PT',
        taxYear: 2025,
        daysInCountry: 200,
        daysInOtherCountries: { ES: 200 },
        hasPermanentHome: null,
        spouseChildrenIn: null,
        centerOfVitalInterests: null,
        habitualAbode: null,
        nationality: 'PT',
      },
    ]);
    expect(r.effectiveResidence.tiebreakerApplied).toBe(true);
    expect(r.effectiveResidence.country).toBe('PT');
    expect(r.effectiveResidence.reason).toBe('nationality');
  });
});
