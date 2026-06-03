/**
 * Better Auth configuration for Cloudflare Workers + D1.
 *
 * Reference: librarian intelligence (better-auth 1.6.14) — replaces stale
 * assumptions in docs/06-architecture-decisions.md.
 *
 * Workaround status (verified 2026-05-28):
 *   #1 Custom password hash:    OBSOLETE in >= 1.6.12 (uses node:crypto via @better-auth/utils ≥ 0.4.1)
 *   #2 cookieCache disable:     WRONG — keep enabled, add `storeSessionInDatabase: true` (issue #4203)
 *   #3 KV TTL clamp ≥ 60s:      STILL REQUIRED (KV hard limit)
 *   #4 per-request auth:        REQUIRED — `createAuth(env, cf, baseURL)` per request
 *
 * Hono wiring lives in src/api/index.ts.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { D1Database, IncomingRequestCfProperties, KVNamespace } from '@cloudflare/workers-types';
import { createDb } from '../db';
import * as schema from '../db/schema';

export interface AuthEnv {
  DB: D1Database;
  KV: KVNamespace;
  BETTER_AUTH_SECRET: string;
  APP_URL?: string;
}

/**
 * Create a per-request Better Auth instance. MUST NOT be hoisted to module scope:
 * D1 / KV bindings only exist inside Workers request scope.
 *
 * @param env — Cloudflare Workers bindings, undefined for CLI schema generation only.
 * @param cf — Request cf properties (geolocation). Optional.
 * @param baseURL — Origin derived from `new URL(request.url).origin`.
 */
export function createAuth(
  env?: AuthEnv,
  _cf?: IncomingRequestCfProperties,
  baseURL?: string,
) {
  // Empty stub for CLI schema generation (`npx @better-auth/cli generate`)
  // biome-ignore lint/suspicious/noExplicitAny: stub object only
  const db = env ? createDb(env.DB) : ({} as any);

  return betterAuth({
    baseURL,
    secret: env?.BETTER_AUTH_SECRET,
    appName: 'EU Tax SaaS',

    database: drizzleAdapter(db, {
      provider: 'sqlite',
      usePlural: true,
      schema,
    }),

    emailAndPassword: {
      enabled: true,
      // No custom hash override needed on >= 1.6.12 (uses node:crypto.scrypt).
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: false, // enable in production after email service set up
    },

    // === Workaround #2: storeSessionInDatabase prevents 5-min logout (issue #4203) ===
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
      storeSessionInDatabase: true,
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh once per day
    },

    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user',
          input: false, // P0 security: must not be settable by client (privilege escalation)
        },
        locale: {
          type: 'string',
          required: false,
          defaultValue: 'en',
          input: true,
        },
        subscriptionStatus: {
          type: 'string',
          required: false,
          defaultValue: 'free',
          input: false,
        },
        paddleSubscriptionId: {
          type: 'string',
          required: false,
          input: false,
        },
        paddleCustomerId: {
          type: 'string',
          required: false,
          input: false,
        },
      },
    },

    // === Workaround #3a: KV-backed secondary storage, TTL clamped to ≥ 60s ===
    secondaryStorage: env?.KV
      ? {
          get: async (key) => {
            const v = await env.KV.get(key);
            if (!v) return null;
            try {
              return JSON.parse(v);
            } catch {
              return v;
            }
          },
          set: async (key, value, ttl) => {
            const stored = typeof value === 'string' ? value : JSON.stringify(value);
            await env.KV.put(key, stored, {
              expirationTtl: ttl ? Math.max(ttl, 60) : 60 * 60 * 24 * 7,
            });
          },
          delete: async (key) => {
            await env.KV.delete(key);
          },
        }
      : undefined,

    // === Workaround #3b: rate limit window >= 60s + override sub-60s defaults ===
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 }, // issue #5452
        '/sign-in/social': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
        '/forgot-password': { window: 60, max: 3 },
      },
    },

    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
      },
    },
  });
}

// CLI export stub (for `@better-auth/cli generate`)
export const auth = createAuth();

export type Auth = ReturnType<typeof createAuth>;
