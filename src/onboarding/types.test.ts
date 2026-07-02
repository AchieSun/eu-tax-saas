import { describe, expect, it } from 'vitest';
import { stepSaveSchema } from './types';

describe('stepSaveSchema', () => {
  it('accepts privacy consent for step 1', () => {
    const parsed = stepSaveSchema.safeParse({ step: 1, data: { acceptPrivacy: true } });
    expect(parsed.success).toBe(true);
  });

  it('rejects missing privacy consent for step 1', () => {
    const parsed = stepSaveSchema.safeParse({ step: 1, data: { acceptPrivacy: false } });
    expect(parsed.success).toBe(false);
  });

  it('accepts country profile for step 2', () => {
    const parsed = stepSaveSchema.safeParse({
      step: 2,
      data: { nationality: 'CN', primaryCountry: 'PT', countries: ['PT', 'ES'] },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unsupported primary country for step 2', () => {
    const parsed = stepSaveSchema.safeParse({
      step: 2,
      data: { nationality: 'CN', primaryCountry: 'FR', countries: ['PT'] },
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts income profile for step 3', () => {
    const parsed = stepSaveSchema.safeParse({
      step: 3,
      data: {
        taxYear: 2025,
        incomes: [
          {
            incomeType: 'salary',
            country: 'PT',
            amountAnnual: 120_000,
            currency: 'EUR',
            withholdingTax: 1_000,
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('defaults income currency and withholding tax for step 3', () => {
    const parsed = stepSaveSchema.parse({
      step: 3,
      data: {
        taxYear: 2025,
        incomes: [{ incomeType: 'salary', country: 'PT', amountAnnual: 120_000 }],
      },
    });
    expect(parsed.step).toBe(3);
    if (parsed.step === 3) {
      expect(parsed.data.incomes[0]).toMatchObject({ currency: 'EUR', withholdingTax: 0 });
    }
  });

  it('accepts special status map for step 4', () => {
    const parsed = stepSaveSchema.safeParse({
      step: 4,
      data: { specialStatus: { ES: 'beckham', PT: 'ifici' } },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts days estimates for step 5', () => {
    const parsed = stepSaveSchema.safeParse({
      step: 5,
      data: { daysEstimate: { PT: 160, ES: 80, UK: 20 } },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects impossible days estimates for step 5', () => {
    const parsed = stepSaveSchema.safeParse({
      step: 5,
      data: { daysEstimate: { PT: 400 } },
    });
    expect(parsed.success).toBe(false);
  });
});
