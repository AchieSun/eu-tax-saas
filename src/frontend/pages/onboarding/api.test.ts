import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeOnboarding, fetchOnboarding, saveOnboardingStep, skipOnboardingStep } from './api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function state(overrides: Partial<{ currentStep: number; complete: boolean }> = {}) {
  return {
    currentStep: 0,
    complete: false,
    privacyAcceptedAt: null,
    completedAt: null,
    draft: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchOnboarding', () => {
  it('GETs current onboarding state with credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true, state: state() }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchOnboarding();

    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding', {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(result.currentStep).toBe(0);
  });

  it('throws UNAUTHORIZED on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })));

    await expect(fetchOnboarding()).rejects.toThrow('UNAUTHORIZED');
  });
});

describe('saveOnboardingStep', () => {
  it('POSTs step payload and returns updated state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, state: state({ currentStep: 2 }) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await saveOnboardingStep(2, {
      nationality: 'CN',
      primaryCountry: 'PT',
      countries: ['PT'],
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/step', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        step: 2,
        data: { nationality: 'CN', primaryCountry: 'PT', countries: ['PT'] },
      }),
    });
    expect(result.currentStep).toBe(2);
  });

  it('flattens validation issues from 400 responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: 'validation',
            issues: [
              { path: ['data', 'countries'], message: 'Array must contain at least 1 element' },
            ],
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      saveOnboardingStep(2, { nationality: 'CN', primaryCountry: 'PT', countries: ['PT'] }),
    ).rejects.toThrow('validation: data.countries: Array must contain at least 1 element');
  });
});

describe('skipOnboardingStep', () => {
  it('POSTs skip step and returns updated state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, state: state({ currentStep: 3 }) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await skipOnboardingStep(3);

    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/skip', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ step: 3 }),
    });
    expect(result.currentStep).toBe(3);
  });
});

describe('completeOnboarding', () => {
  it('POSTs complete request and returns completed state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, state: state({ currentStep: 5, complete: true }) }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await completeOnboarding();

    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/complete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(result.complete).toBe(true);
  });
});
