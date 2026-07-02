import { describe, expect, it } from 'vitest';
import { advanceStep, mergeDraft } from './service';

describe('mergeDraft', () => {
  it('preserves previous step data when saving a later step', () => {
    const result = mergeDraft({ step2: { primaryCountry: 'PT' } }, 3, {
      taxYear: 2025,
      incomes: [{ incomeType: 'salary', country: 'PT', amountAnnual: 100_000 }],
    });

    expect(result).toMatchObject({
      step2: { primaryCountry: 'PT' },
      step3: { taxYear: 2025 },
    });
  });
});

describe('advanceStep', () => {
  it('does not move backwards when saving an earlier step', () => {
    expect(advanceStep(4, 2)).toBe(4);
  });

  it('advances to the saved step when it is ahead', () => {
    expect(advanceStep(1, 3)).toBe(3);
  });
});
