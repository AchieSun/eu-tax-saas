import type { OnboardingCountry, OnboardingIncomeType } from '../../../onboarding/types';
export { ONBOARDING_INCOME_TYPES, SUPPORTED_ONBOARDING_COUNTRIES } from '../../../onboarding/types';

const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' } as const;

export interface OnboardingState {
  readonly currentStep: number;
  readonly complete: boolean;
  readonly privacyAcceptedAt: string | null;
  readonly completedAt: string | null;
  readonly draft: Record<string, unknown>;
}

export interface Step1Payload {
  readonly acceptPrivacy: true;
}

export interface Step2Payload {
  readonly nationality: string;
  readonly primaryCountry: OnboardingCountry;
  readonly countries: readonly OnboardingCountry[];
}

export interface Step3IncomePayload {
  readonly incomeType: OnboardingIncomeType;
  readonly country: OnboardingCountry;
  readonly amountAnnual: number;
  readonly currency: string;
  readonly withholdingTax: number;
}

export interface Step3Payload {
  readonly taxYear: number;
  readonly incomes: readonly Step3IncomePayload[];
}

export interface Step4Payload {
  readonly specialStatus: Partial<Record<OnboardingCountry, string>>;
}

export interface Step5Payload {
  readonly daysEstimate: Partial<Record<OnboardingCountry, number>>;
}

type StepPayloadMap = {
  readonly 1: Step1Payload;
  readonly 2: Step2Payload;
  readonly 3: Step3Payload;
  readonly 4: Step4Payload;
  readonly 5: Step5Payload;
};

export type OnboardingStep = keyof StepPayloadMap;
export type PayloadFor<N extends OnboardingStep> = StepPayloadMap[N];

interface StateOk {
  readonly ok: true;
  readonly state: OnboardingState;
}

interface StateErr {
  readonly ok: false;
  readonly error: string;
  readonly issues?: readonly { readonly path?: unknown; readonly message?: unknown }[];
}

type StateResponse = StateOk | StateErr;

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.clone().json()) as StateErr;
    const code = typeof body?.error === 'string' ? body.error : '';
    const issues = Array.isArray(body?.issues) ? body.issues : [];
    if (issues.length > 0) {
      const flattened = issues
        .map((issue) => {
          const path = Array.isArray(issue?.path) ? issue.path.join('.') : '';
          const message = typeof issue?.message === 'string' ? issue.message : '';
          if (path && message) return `${path}: ${message}`;
          return message || path || 'invalid';
        })
        .join('; ');
      return code ? `${code}: ${flattened}` : flattened;
    }
    return code || fallback;
  } catch {
    return fallback;
  }
}

async function readStateResponse(res: Response, fallback: string): Promise<OnboardingState> {
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status >= 400 && res.status < 500) {
    throw new Error(await extractErrorMessage(res, fallback));
  }
  if (!res.ok) throw new Error(fallback);
  const json = (await res.json()) as StateResponse;
  if (!json.ok) throw new Error(json.error || fallback);
  return json.state;
}

export async function fetchOnboarding(): Promise<OnboardingState> {
  const res = await fetch('/api/onboarding', {
    credentials: 'include',
    headers: { ...XHR_HEADERS },
  });
  return readStateResponse(res, `fetchOnboarding failed: ${res.status}`);
}

export async function saveOnboardingStep<N extends OnboardingStep>(
  step: N,
  data: PayloadFor<N>,
): Promise<OnboardingState> {
  const res = await fetch('/api/onboarding/step', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify({ step, data }),
  });
  return readStateResponse(res, `saveOnboardingStep failed: ${res.status}`);
}

export async function skipOnboardingStep(step: number): Promise<OnboardingState> {
  const res = await fetch('/api/onboarding/skip', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...XHR_HEADERS },
    body: JSON.stringify({ step }),
  });
  return readStateResponse(res, `skipOnboardingStep failed: ${res.status}`);
}

export async function completeOnboarding(): Promise<OnboardingState> {
  const res = await fetch('/api/onboarding/complete', {
    method: 'POST',
    credentials: 'include',
    headers: { ...XHR_HEADERS },
  });
  return readStateResponse(res, `completeOnboarding failed: ${res.status}`);
}

export type { OnboardingCountry, OnboardingIncomeType };
