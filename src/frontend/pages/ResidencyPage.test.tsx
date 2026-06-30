/**
 * ResidencyPage tests — mock fetch for the residency API client.
 *
 * Runs under pure Node (no jsdom); component is imported for type-check
 * coverage only, assertions focus on fetch behaviour.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResidencyPage from './ResidencyPage';
import { postAssess, postAssessMulti } from './residency/api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ResidencyPage component', () => {
  it('exports a default Solid component', () => {
    expect(typeof ResidencyPage).toBe('function');
  });
});

describe('postAssess', () => {
  const input = {
    country: 'DE' as const,
    taxYear: 2025,
    daysInCountry: 183,
    daysInOtherCountries: {},
    hasPermanentHome: true,
    spouseChildrenIn: null,
    centerOfVitalInterests: null,
    habitualAbode: null,
    nationality: null,
  };

  it('posts JSON with credentials and X-Requested-With header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        result: {
          country: 'DE',
          isResident: true,
          confidence: 'high',
          reasoning: 'Test',
          appliedRules: ['rule'],
          tiebreaker: null,
          warnings: [],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await postAssess(input);

    expect(fetchMock).toHaveBeenCalledWith('/api/residency/assess', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(input),
    });
    expect(result.isResident).toBe(true);
    expect(result.confidence).toBe('high');
  });

  it('throws on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })));
    await expect(postAssess(input)).rejects.toThrow('UNAUTHORIZED');
  });

  it('throws validation error from issues array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: 'validation',
            issues: [{ path: ['country'], message: 'unsupported' }],
          },
          { status: 400 },
        ),
      ),
    );
    await expect(postAssess(input)).rejects.toThrow('validation: country: unsupported');
  });
});

describe('postAssessMulti', () => {
  it('sends inputs array and returns multi assessment', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        result: {
          perCountry: [
            {
              country: 'DE',
              isResident: true,
              confidence: 'high',
              reasoning: 'Resident',
              appliedRules: ['183-day'],
              tiebreaker: null,
              warnings: [],
            },
          ],
          effectiveResidence: {
            country: 'DE',
            reason: 'Only resident country.',
            tiebreakerApplied: false,
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const inputs = [
      {
        country: 'DE' as const,
        taxYear: 2025,
        daysInCountry: 183,
        daysInOtherCountries: {},
        hasPermanentHome: true,
        spouseChildrenIn: null,
        centerOfVitalInterests: null,
        habitualAbode: null,
        nationality: null,
      },
    ];
    const result = await postAssessMulti(inputs);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    });
    expect(result.effectiveResidence.country).toBe('DE');
  });
});
