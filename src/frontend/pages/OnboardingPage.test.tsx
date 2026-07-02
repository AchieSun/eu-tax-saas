import { describe, expect, it, vi } from 'vitest';
import type { OnboardingState } from './onboarding/api';

function state(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    currentStep: 0,
    complete: false,
    privacyAcceptedAt: null,
    completedAt: null,
    draft: {},
    ...overrides,
  };
}

describe('OnboardingPage module', () => {
  it('exports a default Solid component', async () => {
    const module = await import('./OnboardingPage');

    expect(typeof module.default).toBe('function');
  });

  it('does not call global fetch when imported', async () => {
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await import('./OnboardingPage');

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('computeInitialStep', () => {
  it('returns the next unfinished step when onboarding is incomplete', async () => {
    const { computeInitialStep } = await import('./OnboardingPage');

    expect(computeInitialStep(state({ currentStep: 0, complete: false }))).toBe(1);
    expect(computeInitialStep(state({ currentStep: 3, complete: false }))).toBe(4);
  });

  it('returns step five when onboarding is complete', async () => {
    const { computeInitialStep } = await import('./OnboardingPage');

    expect(computeInitialStep(state({ currentStep: 2, complete: true }))).toBe(5);
  });
});

describe('buildStep3Payload', () => {
  it('filters empty rows and coerces numeric strings', async () => {
    const { buildStep3Payload } = await import('./OnboardingPage');

    const payload = buildStep3Payload(
      [
        {
          incomeType: 'salary',
          country: 'DE',
          amountAnnual: '90000',
          currency: 'EUR',
          withholdingTax: '12000',
        },
        {
          incomeType: 'dividends',
          country: 'PT',
          amountAnnual: '',
          currency: 'EUR',
          withholdingTax: '',
        },
      ],
      '2025',
    );

    expect(payload).toEqual({
      taxYear: 2025,
      incomes: [
        {
          incomeType: 'salary',
          country: 'DE',
          amountAnnual: 90000,
          currency: 'EUR',
          withholdingTax: 12000,
        },
      ],
    });
  });

  it('throws for non-numeric annual amounts', async () => {
    const { buildStep3Payload } = await import('./OnboardingPage');

    expect(() =>
      buildStep3Payload(
        [
          {
            incomeType: 'salary',
            country: 'DE',
            amountAnnual: 'abc',
            currency: 'EUR',
            withholdingTax: '0',
          },
        ],
        2025,
      ),
    ).toThrow('amountAnnual must be numeric');
  });
});

describe('deriveVisibleCountries', () => {
  it('returns step two countries from the draft', async () => {
    const { deriveVisibleCountries } = await import('./OnboardingPage');

    expect(
      deriveVisibleCountries(
        state({
          draft: {
            step2: { nationality: 'CN', primaryCountry: 'DE', countries: ['DE', 'PT'] },
          },
        }),
      ),
    ).toEqual(['DE', 'PT']);
  });

  it('falls back to all supported onboarding countries', async () => {
    const { deriveVisibleCountries } = await import('./OnboardingPage');

    expect(deriveVisibleCountries(state())).toEqual(['DE', 'NL', 'PT', 'ES', 'UK']);
  });
});
