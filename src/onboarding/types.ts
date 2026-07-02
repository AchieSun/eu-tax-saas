import { z } from 'zod';

export const SUPPORTED_ONBOARDING_COUNTRIES = ['DE', 'NL', 'PT', 'ES', 'UK'] as const;
export const ONBOARDING_INCOME_TYPES = [
  'salary',
  'self_employed',
  'dividends',
  'interest',
  'rental',
  'capital_gains',
  'crypto',
  'other',
] as const;

const countrySchema = z.enum(SUPPORTED_ONBOARDING_COUNTRIES);
const incomeTypeSchema = z.enum(ONBOARDING_INCOME_TYPES);

export const step1Schema = z.object({
  step: z.literal(1),
  data: z.object({ acceptPrivacy: z.literal(true) }),
});

export const step2Schema = z.object({
  step: z.literal(2),
  data: z.object({
    nationality: z.string().length(2).transform((v) => v.toUpperCase()),
    primaryCountry: countrySchema,
    countries: z.array(countrySchema).min(1).max(5),
  }),
});

export const step3Schema = z.object({
  step: z.literal(3),
  data: z.object({
    taxYear: z.number().int().min(2024).max(2030),
    incomes: z
      .array(
        z.object({
          incomeType: incomeTypeSchema,
          country: countrySchema,
          amountAnnual: z.number().nonnegative(),
          currency: z.string().length(3).default('EUR'),
          withholdingTax: z.number().nonnegative().default(0),
        }),
      )
      .min(1)
      .max(10),
  }),
});

export const step4Schema = z.object({
  step: z.literal(4),
  data: z.object({
    specialStatus: z.record(countrySchema, z.string()).default({}),
  }),
});

export const step5Schema = z.object({
  step: z.literal(5),
  data: z.object({
    daysEstimate: z.record(countrySchema, z.number().int().min(0).max(366)),
  }),
});

export const stepSaveSchema = z.discriminatedUnion('step', [
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
]);

export const skipStepSchema = z.object({
  step: z.number().int().min(1).max(5),
});

export type OnboardingCountry = (typeof SUPPORTED_ONBOARDING_COUNTRIES)[number];
export type OnboardingIncomeType = (typeof ONBOARDING_INCOME_TYPES)[number];
export type StepSaveInput = z.infer<typeof stepSaveSchema>;
export type SkipStepInput = z.infer<typeof skipStepSchema>;
