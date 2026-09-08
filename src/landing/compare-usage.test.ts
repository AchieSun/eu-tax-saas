/**
 * compare-usage.test.ts — funnel telemetry for the public calculator.
 *
 * The GET /api/public/compare handler records every successful computation
 * into the compare_usage D1 table (fire-and-forget). These unit tests pin:
 *  - the insert targets the compareUsage drizzle table;
 *  - the row payload carries id/createdAt + the parsed input params and
 *    nothing else (no IP, no user id, no user agent);
 *  - swallow-on-failure: a broken insert must never reject the caller.
 */

import { describe, expect, it, vi } from 'vitest';

const { insertSpy, valuesSpy } = vi.hoisted(() => ({
  insertSpy: vi.fn(),
  valuesSpy: vi.fn(),
}));

vi.mock('../db', () => ({
  createDb: () => ({ insert: insertSpy.mockReturnValue({ values: valuesSpy }) }),
}));

// Import AFTER vi.mock so the mocked createDb is what compare-usage sees.
import { compareUsage } from '../db/schema';
import { recordCompareUsage } from './compare-usage';

const input = {
  grossIncome: 80000,
  taxYear: 2026,
  incomeType: 'salary',
  filingStatus: 'single',
};

describe('recordCompareUsage', () => {
  it('inserts one row into the compareUsage table with the parsed input', async () => {
    insertSpy.mockClear();
    valuesSpy.mockClear();
    await expect(recordCompareUsage({}, input)).resolves.toBeUndefined();
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith(compareUsage);
    expect(valuesSpy).toHaveBeenCalledTimes(1);
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        grossIncome: 80000,
        taxYear: 2026,
        incomeType: 'salary',
        filingStatus: 'single',
        id: expect.any(String),
        createdAt: expect.any(Number),
      }),
    );
  });

  it('row payload carries exactly the telemetry columns — no PII fields', async () => {
    insertSpy.mockClear();
    valuesSpy.mockClear();
    await recordCompareUsage({}, input);
    const row = valuesSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual([
      'createdAt',
      'filingStatus',
      'grossIncome',
      'id',
      'incomeType',
      'taxYear',
    ]);
    // No ip / userId / userAgent keys may sneak in later.
    expect(row).not.toHaveProperty('ip');
    expect(row).not.toHaveProperty('userId');
    expect(row).not.toHaveProperty('userAgent');
  });

  it('swallows insert failures instead of rejecting', async () => {
    insertSpy.mockClear();
    valuesSpy.mockClear();
    valuesSpy.mockImplementationOnce(() => {
      throw new Error('d1 exploded');
    });
    await expect(recordCompareUsage({}, input)).resolves.toBeUndefined();
    expect(valuesSpy).toHaveBeenCalled();
  });
});
