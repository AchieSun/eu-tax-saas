import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/// <reference types="@cloudflare/vitest-pool-workers" />
import { env } from 'cloudflare:test';
import type { D1Database, KVNamespace, Queue, R2Bucket } from '@cloudflare/workers-types';

/**
 * Test-only shared environment helpers for the @cloudflare/vitest-pool-workers
 * harness. Provides:
 *   - setupTestEnv():    idempotent Drizzle-migration runner against ephemeral D1
 *   - seedUser():        insert a Better Auth user row
 *   - seedFormMapping(): insert an F3/W4 form_field_mappings row
 *
 * The Miniflare D1 binding is fresh per `vitest run` invocation (no
 * d1Persist), so migrations must be (re-)applied at the start of any suite
 * that touches the database.
 */

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    R2: R2Bucket;
    KV: KVNamespace;
    QUEUE: Queue;
    ENVIRONMENT: string;
    APP_URL: string;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle', 'migrations');

let migrationsApplied = false;

/**
 * Apply every `*.sql` migration in `drizzle/migrations/` (sorted, so 0000 →
 * 0001 → 0002 …) to the ephemeral D1 binding. Idempotent across calls within
 * a single vitest run via the `migrationsApplied` flag.
 *
 * Drizzle delimits statements with `--> statement-breakpoint`; we split on
 * that marker rather than `;` to avoid breaking on `;` inside SQL strings.
 */
export async function setupTestEnv() {
  if (migrationsApplied) return env;

  const all = await readdir(MIGRATIONS_DIR);
  const files = all.filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    // Drizzle's `-->` statement-breakpoint is the canonical statement
    // separator. Falls back to `;` split if no breakpoints found.
    const statements = sql.includes('--> statement-breakpoint')
      ? sql
          .split('--> statement-breakpoint')
          .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
          .filter((s) => s.length > 0)
      : sql
          .split(/;\s*\n/)
          .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
          .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        await env.DB.exec(stmt.replace(/\n/g, ' '));
      } catch (e) {
        // Swallow benign re-apply errors (CREATE TABLE / INDEX already exists,
        // ALTER TABLE adding a duplicate column). Re-throw anything else.
        const msg = (e as Error).message ?? '';
        if (
          !/already exists/i.test(msg) &&
          !/duplicate column/i.test(msg) &&
          !/no such index/i.test(msg)
        ) {
          throw new Error(`Migration ${file} failed: ${msg}\n--- SQL ---\n${stmt}`);
        }
      }
    }
  }

  migrationsApplied = true;
  return env;
}

/** Reset the idempotency flag — useful if a suite truly needs a wiped DB. */
export function resetMigrationsFlag() {
  migrationsApplied = false;
}

// ────────────────────────────────────────────────────────────────────────────
// Seed helpers
// ────────────────────────────────────────────────────────────────────────────

export interface SeedUserOpts {
  id?: string;
  email?: string;
  name?: string;
  role?: 'user' | 'admin';
  locale?: string;
  subscriptionStatus?: 'free' | 'pro' | 'enterprise';
}

export interface SeededUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
}

/**
 * Insert a row into the `users` table that satisfies every NOT-NULL column
 * (Better Auth standard + app extensions: role, locale, subscriptionStatus).
 * Defaults a UUID id, deterministic test email, and `role='user'`.
 */
export async function seedUser(opts: SeedUserOpts = {}): Promise<SeededUser> {
  const id = opts.id ?? crypto.randomUUID();
  const email = opts.email ?? `${id}@test.local`;
  const name = opts.name ?? 'Test User';
  const role = opts.role ?? 'user';
  const locale = opts.locale ?? 'en';
  const subscriptionStatus = opts.subscriptionStatus ?? 'free';
  const now = Math.floor(Date.now() / 1000); // unixepoch() seconds

  await env.DB.prepare(
    `INSERT INTO users
       (id, name, email, email_verified, role, locale, subscription_status, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
  )
    .bind(id, name, email, role, locale, subscriptionStatus, now, now)
    .run();

  return { id, email, name, role };
}

export interface SeedFormMappingOpts {
  country: string;
  year: number;
  form: string;
  fieldName: string;
  dataPath?: string;
  fieldLabel?: string;
  fieldType?: 'text' | 'number' | 'checkbox' | 'date';
  pageNumber?: number;
  boxNumber?: string;
  pdfR2Key?: string;
  pdfSha256?: string;
  pageCount?: number;
  xCoord?: number;
  yCoord?: number;
  fontSize?: number;
  fieldKind?: 'acroform' | 'coordinate';
}

/**
 * Insert a `form_field_mappings` row. Mirrors the W4-augmented schema
 * (x_coord / y_coord / field_kind columns added by migration 0002).
 */
export async function seedFormMapping(opts: SeedFormMappingOpts): Promise<string> {
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO form_field_mappings
       (id, country, form_type, tax_year, field_name, field_label, data_path,
        field_type, page_number, box_number, pdf_r2_key, pdf_sha256, page_count,
        x_coord, y_coord, font_size, field_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      opts.country,
      opts.form,
      opts.year,
      opts.fieldName,
      opts.fieldLabel ?? null,
      opts.dataPath ?? `path.${opts.fieldName}`,
      opts.fieldType ?? 'text',
      opts.pageNumber ?? null,
      opts.boxNumber ?? null,
      opts.pdfR2Key ?? null,
      opts.pdfSha256 ?? null,
      opts.pageCount ?? null,
      opts.xCoord ?? null,
      opts.yCoord ?? null,
      opts.fontSize ?? null,
      opts.fieldKind ?? 'acroform',
    )
    .run();

  return id;
}
