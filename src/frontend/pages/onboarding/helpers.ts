import type { OnboardingCountry, OnboardingState, Step3Payload } from './api';
import { SUPPORTED_ONBOARDING_COUNTRIES } from './api';

const STEP_COUNT = 5;

export interface Step3DraftRow {
  readonly id?: string;
  readonly incomeType: string;
  readonly country: string;
  readonly amountAnnual: string;
  readonly currency: string;
  readonly withholdingTax: string;
}

export function computeInitialStep(state: OnboardingState): number {
  if (state.complete) return 5;
  return Math.min(STEP_COUNT, Math.max(1, state.currentStep + 1));
}

export function parseCountry(value: string): OnboardingCountry | null {
  switch (value) {
    case 'DE':
    case 'NL':
    case 'PT':
    case 'ES':
    case 'UK':
      return value;
    default:
      return null;
  }
}

function parseIncomeType(value: string): Step3Payload['incomes'][number]['incomeType'] | null {
  switch (value) {
    case 'salary':
    case 'self_employed':
    case 'dividends':
    case 'interest':
    case 'rental':
    case 'capital_gains':
    case 'crypto':
    case 'other':
      return value;
    default:
      return null;
  }
}

export function numericField(value: string, field: string): number {
  const trimmed = value.trim();
  const parsed = trimmed === '' ? 0 : Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be numeric`);
  return parsed;
}

export function buildStep3Payload(
  rows: readonly Step3DraftRow[],
  taxYear: number | string,
): Step3Payload {
  const incomes = rows
    .filter((row) => row.amountAnnual.trim() !== '')
    .map((row) => {
      const incomeType = parseIncomeType(row.incomeType);
      const country = parseCountry(row.country);
      if (incomeType === null) throw new Error('incomeType must be supported');
      if (country === null) throw new Error('country must be supported');
      return {
        incomeType,
        country,
        amountAnnual: numericField(row.amountAnnual, 'amountAnnual'),
        currency: row.currency.trim().toUpperCase() || 'EUR',
        withholdingTax: numericField(row.withholdingTax, 'withholdingTax'),
      };
    });
  return { taxYear: numericField(String(taxYear), 'taxYear'), incomes };
}

export function deriveVisibleCountries(state: OnboardingState): readonly OnboardingCountry[] {
  const step2 = state.draft.step2;
  if (
    typeof step2 === 'object' &&
    step2 !== null &&
    !Array.isArray(step2) &&
    'countries' in step2
  ) {
    const rawCountries = step2.countries;
    if (Array.isArray(rawCountries)) {
      const countries = rawCountries.flatMap((value) => {
        if (typeof value !== 'string') return [];
        const country = parseCountry(value);
        return country === null ? [] : [country];
      });
      if (countries.length > 0) return countries;
    }
  }
  return SUPPORTED_ONBOARDING_COUNTRIES;
}
