/**
 * F2 Residency API — integration tests.
 * Uses Hono's built-in app.request() for in-process HTTP testing.
 */

import { describe, it, expect } from 'vitest';
import { residencyRoutes } from './residency';

describe('GET /status', () => {
  it('reports F2 implemented with 5 countries', async () => {
    const res = await residencyRoutes.request('/status');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('implemented');
    expect(body.countries).toEqual(['DE', 'NL', 'PT', 'ES', 'UK']);
    expect(body.tiebreaker).toBe('OECD Model Tax Convention art. 4');
  });
});

describe('POST /assess', () => {
  const validBase = {
    daysInCountry: 200,
    daysInOtherCountries: {},
    hasPermanentHome: null,
    spouseChildrenIn: null,
    centerOfVitalInterests: null,
    habitualAbode: null,
  };

  it('returns ResidencyResult for valid ES input (183+ days → resident)', async () => {
    const res = await residencyRoutes.request('/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: 'ES', taxYear: 2025, ...validBase }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.result.isResident).toBe(true);
    expect(body.result.country).toBe('ES');
    expect(body.result.appliedRules).toContain('ES.183day');
  });

  it('returns 400 for malformed input (invalid country)', async () => {
    const res = await residencyRoutes.request('/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: 'XX', taxYear: 2025, ...validBase }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.ok).toBe(false);
    expect(body.error).toBe('validation');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await residencyRoutes.request('/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: 'ES' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.ok).toBe(false);
  });

  it('UK assess with SRT facts works (200 days → auto-183 resident)', async () => {
    const res = await residencyRoutes.request('/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: 'UK', taxYear: 2025, ...validBase, srt: {} }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.result.isResident).toBe(true);
    expect(body.result.appliedRules[0]).toMatch(/^UK\.SRT\./);
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await residencyRoutes.request('/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /assess-multi', () => {
  it('runs OECD tiebreaker when 2 countries claim residency', async () => {
    const res = await residencyRoutes.request('/assess-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: [
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
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.result.effectiveResidence.tiebreakerApplied).toBe(true);
    // DE has permanent home → wins tiebreaker step 1
    expect(body.result.effectiveResidence.country).toBe('DE');
  });

  it('returns 400 when inputs array is empty', async () => {
    const res = await residencyRoutes.request('/assess-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.ok).toBe(false);
  });

  it('returns 400 when inputs exceed max of 5', async () => {
    const input = {
      country: 'ES',
      taxYear: 2025,
      daysInCountry: 0,
      daysInOtherCountries: {},
      hasPermanentHome: null,
      spouseChildrenIn: null,
      centerOfVitalInterests: null,
      habitualAbode: null,
    };
    const res = await residencyRoutes.request('/assess-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: Array.from({ length: 6 }, () => input) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.ok).toBe(false);
  });
});

describe('POST /uk-srt-ties', () => {
  const validBody = {
    familyResidentInUk: false,
    hasAccommodationAvailable91Days: false,
    spentNightInAccommodation: false,
    ukWorkDays: 0,
    ukDaysPriorYear1: 0,
    ukDaysPriorYear2: 0,
    isLeaver: false,
    countryWithMostDays: null,
    ukDays: 50,
  };

  it('returns correct ties count and residence decision', async () => {
    const res = await residencyRoutes.request('/uk-srt-ties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // All false → 0 ties
    expect(body.ties.count).toBe(0);
    expect(body.ties.ties.family).toBe(false);
    expect(body.ties.ties.country).toBe(null); // arriver
    expect(body.ukDays).toBe(50);
    // 50 days + 0 ties as arriver → non-resident (needs 4 ties)
    expect(body.resident).toBe(false);
    expect(body.reason).toContain('below the required');
    expect(body.disclaimer).toBeTruthy();
  });

  it('returns 400 when ukDays is out of range (367)', async () => {
    const res = await residencyRoutes.request('/uk-srt-ties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, ukDays: 367 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.ok).toBe(false);
    expect(body.error).toBe('validation');
  });

  it('arriver providing countryWithMostDays gets country=null in response', async () => {
    const res = await residencyRoutes.request('/uk-srt-ties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, countryWithMostDays: 'UK' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ties.ties.country).toBe(null);
    expect(body.ties.rationale.some((r: string) => r.includes('not applicable (arriver'))).toBe(true);
  });

  it('leaver with all ties + 16 UK days → resident', async () => {
    const res = await residencyRoutes.request('/uk-srt-ties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        familyResidentInUk: true,
        hasAccommodationAvailable91Days: true,
        spentNightInAccommodation: true,
        ukWorkDays: 40,
        ukDaysPriorYear1: 91,
        ukDaysPriorYear2: 0,
        isLeaver: true,
        countryWithMostDays: 'UK',
        ukDays: 16,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ties.count).toBe(5);
    expect(body.resident).toBe(true);
    expect(body.reason).toContain('meet the required');
  });
});
