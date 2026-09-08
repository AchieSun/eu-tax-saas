/**
 * compare-usage.ts — fire-and-forget telemetry for the public calculator.
 *
 * GET /api/public/compare previously computed results with zero persistence,
 * leaving the acquisition funnel's mid-stage unmeasurable (the only countable
 * events were waitlist signups - of which there were none, so we could not
 * tell "no traffic" from "traffic that does not convert").
 *
 * Every SUCCESSFUL computation records one row into the compare_usage D1
 * table. Constraints:
 *  - no PII: no IP, no user agent, no user id - only the parsed input params;
 *  - must never break the calculation: all failures are swallowed after a
 *    console.error;
 *  - in production the insert runs under waitUntil (non-blocking for the
 *    response); runtimes without an ExecutionContext (unit tests) fall back
 *    to an awaited call in the route handler.
 */

import { createDb } from '../db';
import { compareUsage } from '../db/schema';

export interface CompareUsageInput {
  grossIncome: number;
  taxYear: number;
  incomeType: string;
  filingStatus: string;
}

export async function recordCompareUsage(
  dbBinding: unknown,
  input: CompareUsageInput,
): Promise<void> {
  try {
    const db = createDb(dbBinding as Parameters<typeof createDb>[0]);
    await db.insert(compareUsage).values({
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      grossIncome: input.grossIncome,
      taxYear: input.taxYear,
      incomeType: input.incomeType,
      filingStatus: input.filingStatus,
    });
  } catch (err) {
    // Telemetry must never break the calculator - log and drop.
    console.error('compare_usage insert failed', err);
  }
}
