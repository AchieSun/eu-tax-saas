import { and, eq } from 'drizzle-orm';
import { userIncome, userOnboarding, userResidency } from '../db/schema';
import type { Db } from '../db';
import type { StepSaveInput } from './types';

export type OnboardingDraft = Record<string, unknown>;

export interface OnboardingState {
  readonly currentStep: number;
  readonly complete: boolean;
  readonly privacyAcceptedAt: string | null;
  readonly completedAt: string | null;
  readonly draft: OnboardingDraft;
}

function safeIso(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toDraft(raw: unknown): OnboardingDraft {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as OnboardingDraft;
  return {};
}

export function mergeDraft(current: OnboardingDraft, step: number, data: unknown): OnboardingDraft {
  return { ...current, [`step${step}`]: data };
}

export function advanceStep(currentStep: number, savedStep: number): number {
  return Math.max(currentStep, savedStep);
}

async function ensureRow(db: Db, userId: string): Promise<void> {
  await db
    .insert(userOnboarding)
    .values({ userId, draft: {} })
    .onConflictDoNothing({ target: userOnboarding.userId });
}

export async function getOnboardingState(db: Db, userId: string): Promise<OnboardingState> {
  await ensureRow(db, userId);
  const [row] = await db
    .select({
      currentStep: userOnboarding.currentStep,
      privacyAcceptedAt: userOnboarding.privacyAcceptedAt,
      completedAt: userOnboarding.completedAt,
      draft: userOnboarding.draft,
    })
    .from(userOnboarding)
    .where(eq(userOnboarding.userId, userId))
    .limit(1);

  const currentStep = row?.currentStep ?? 0;
  const completedAt = row?.completedAt ?? null;
  return {
    currentStep,
    complete: completedAt !== null,
    privacyAcceptedAt: safeIso(row?.privacyAcceptedAt),
    completedAt: safeIso(completedAt),
    draft: toDraft(row?.draft),
  };
}

export async function saveOnboardingStep(
  db: Db,
  userId: string,
  input: StepSaveInput,
): Promise<OnboardingState> {
  await ensureRow(db, userId);
  const state = await getOnboardingState(db, userId);
  const draft = mergeDraft(state.draft, input.step, input.data);
  const now = new Date();

  if (input.step === 2) {
    const countries = Object.fromEntries(input.data.countries.map((c) => [c, true]));
    const [existingResidency] = await db
      .select({ id: userResidency.id })
      .from(userResidency)
      .where(eq(userResidency.userId, userId))
      .limit(1);
    if (existingResidency) {
      await db
        .update(userResidency)
        .set({
          nationality: input.data.nationality,
          countries,
          primaryCountry: input.data.primaryCountry,
          updatedAt: now,
        })
        .where(eq(userResidency.id, existingResidency.id));
    } else {
      await db.insert(userResidency).values({
        id: crypto.randomUUID(),
        userId,
        nationality: input.data.nationality,
        countries,
        primaryCountry: input.data.primaryCountry,
        updatedAt: now,
      });
    }
  }

  if (input.step === 3) {
    await db
      .delete(userIncome)
      .where(and(eq(userIncome.userId, userId), eq(userIncome.taxYear, input.data.taxYear)));
    await db.insert(userIncome).values(
      input.data.incomes.map((income) => ({
        id: crypto.randomUUID(),
        userId,
        taxYear: input.data.taxYear,
        incomeType: income.incomeType,
        country: income.country,
        amountAnnual: income.amountAnnual,
        currency: income.currency,
        withholdingTax: income.withholdingTax,
        createdAt: now,
      })),
    );
  }

  if (input.step === 4) {
    const [existing] = await db
      .select({ specialStatus: userResidency.specialStatus })
      .from(userResidency)
      .where(eq(userResidency.userId, userId))
      .limit(1);
    const currentSpecialStatus = toDraft(existing?.specialStatus);
    await db
      .update(userResidency)
      .set({ specialStatus: { ...currentSpecialStatus, ...input.data.specialStatus }, updatedAt: now })
      .where(eq(userResidency.userId, userId));
  }

  const nextStep = advanceStep(state.currentStep, input.step);
  await db
    .update(userOnboarding)
    .set({
      currentStep: nextStep,
      privacyAcceptedAt: input.step === 1 ? now : undefined,
      completedAt: input.step === 5 ? now : undefined,
      draft,
      updatedAt: now,
    })
    .where(eq(userOnboarding.userId, userId));

  return getOnboardingState(db, userId);
}

export async function skipOnboardingStep(db: Db, userId: string, step: number): Promise<OnboardingState> {
  await ensureRow(db, userId);
  const state = await getOnboardingState(db, userId);
  await db
    .update(userOnboarding)
    .set({ currentStep: advanceStep(state.currentStep, step), updatedAt: new Date() })
    .where(eq(userOnboarding.userId, userId));
  return getOnboardingState(db, userId);
}

export async function completeOnboarding(db: Db, userId: string): Promise<OnboardingState> {
  await ensureRow(db, userId);
  const now = new Date();
  await db
    .update(userOnboarding)
    .set({ currentStep: 5, completedAt: now, updatedAt: now })
    .where(eq(userOnboarding.userId, userId));
  return getOnboardingState(db, userId);
}
