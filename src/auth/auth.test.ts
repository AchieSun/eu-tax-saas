/**
 * Better Auth additionalFields contract — regression tests for Oracle P1#9.
 *
 * P1#9: `users.role` column exists in schema but was missing from
 * `additionalFields` in `betterAuth()` config. Any `@better-auth/cli generate`
 * run would DROP the column, breaking RBAC entirely.
 *
 * These tests lock the contract: every schema-extension column on the `users`
 * table MUST be declared in `additionalFields`, and security-critical fields
 * (e.g. `role`) MUST have `input: false` to prevent client privilege escalation.
 */

import { describe, expect, it } from 'vitest';
import { createAuth } from './auth';

describe('Better Auth additionalFields contract (Oracle P1#9)', () => {
  it('declares all schema-extension columns in additionalFields', () => {
    const auth = createAuth();
    const fields = auth.options?.user?.additionalFields ?? {};
    const declared = Object.keys(fields);

    // Schema extension columns (non-standard Better Auth):
    // role, locale, subscriptionStatus, paddleSubscriptionId, paddleCustomerId
    expect(declared).toEqual(
      expect.arrayContaining([
        'role',
        'locale',
        'subscriptionStatus',
        'paddleSubscriptionId',
        'paddleCustomerId',
      ]),
    );
  });

  it('role field is non-input to prevent client privilege escalation', () => {
    const auth = createAuth();
    const role = auth.options?.user?.additionalFields?.role;
    expect(role?.input).toBe(false);
  });

  it('schema columns match additionalFields declarations', () => {
    // Schema extension columns derived from src/db/schema.ts users table
    // (all columns beyond Better Auth's 7 standard ones: id, name, email,
    //  emailVerified, image, createdAt, updatedAt)
    const extensionCols = [
      'role',
      'locale',
      'subscriptionStatus',
      'paddleSubscriptionId',
      'paddleCustomerId',
    ];

    const auth = createAuth();
    const fields = auth.options?.user?.additionalFields ?? {};
    const declaredKeys = Object.keys(fields);

    for (const col of extensionCols) {
      expect(
        declaredKeys,
        `Column "${col}" exists in schema but is missing from additionalFields`,
      ).toContain(col);
    }
  });
});
