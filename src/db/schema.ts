/**
 * D1 Database Schema (Drizzle ORM, SQLite dialect)
 *
 * Covers all P0 tables for European Tax SaaS standard MVP:
 *   F1 tax calculator       → user_income, tax_calculations
 *   F2 residency assessment → user_residency, residency_assessments
 *   F3 filing assistant     → tax_filings, form_field_mappings
 *   F4 strategy recommender → strategy_recommendations
 *   F6 days tracker         → user_days
 *   Better Auth             → users, sessions, accounts, verifications
 *
 * Source: docs/10-data-model.md (adapted for Better Auth 1.6+ usePlural convention)
 */

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ────────────────────────────────────────────────────────────────────────────
// Better Auth tables (usePlural: true)
// ────────────────────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  // App-specific extensions (default Better Auth schema is extended via `additionalFields`)
  role: text('role').notNull().default('user'), // 'user' | 'admin' — manually promoted via SQL
  locale: text('locale').notNull().default('en'),
  subscriptionStatus: text('subscription_status').notNull().default('free'), // 'free' | 'active' | 'cancelled' | 'past_due'
  paymentProvider: text('payment_provider'), // 'oceanpayment' | null — provider-agnostic so we can swap PSP without another migration
  paymentSubscriptionId: text('payment_subscription_id'),
  paymentCustomerId: text('payment_customer_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ────────────────────────────────────────────────────────────────────────────
// F2 — Residency
// ────────────────────────────────────────────────────────────────────────────

export const userResidency = sqliteTable('user_residency', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  nationality: text('nationality').notNull(), // ISO 3166-1 alpha-2
  countries: text('countries', { mode: 'json' }).notNull(), // {"ES": true, ...}
  primaryCountry: text('primary_country'),
  specialStatus: text('special_status', { mode: 'json' }), // {"ES": "beckham", ...}
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const residencyAssessments = sqliteTable(
  'residency_assessments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    country: text('country').notNull(), // ES/PT/DE/NL/UK
    taxYear: integer('tax_year').notNull(),
    isResident: integer('is_resident', { mode: 'boolean' }).notNull(),
    confidence: text('confidence').notNull(), // 'high'|'medium'|'low'
    reasoning: text('reasoning', { mode: 'json' }).notNull(),
    hasConflict: integer('has_conflict', { mode: 'boolean' }).notNull().default(false),
    conflictWith: text('conflict_with'), // ISO country if conflict
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    userYearIdx: index('idx_residency_user_year').on(t.userId, t.taxYear),
  }),
);

// ────────────────────────────────────────────────────────────────────────────
// F6 — Days tracker
// ────────────────────────────────────────────────────────────────────────────

export const userDays = sqliteTable(
  'user_days',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    country: text('country').notNull(), // ES/PT/DE/NL/UK
    date: text('date').notNull(), // YYYY-MM-DD
    source: text('source').notNull().default('manual'), // manual|google_calendar|gps
    note: text('note'), // W3 — free-text annotation
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    // W3: changed from (userId, country, date) to (userId, date).
    // Real-world: a user is physically in ONE country per calendar day.
    // Bulk POST uses UPSERT on (userId, date) so late writes win.
    uniqueDay: uniqueIndex('idx_user_days_unique').on(t.userId, t.date),
    userDateIdx: index('idx_user_days_user_date').on(t.userId, t.date),
  }),
);

// ────────────────────────────────────────────────────────────────────────────
// W3 P1#9 (Oracle): hash-only audit log for /api/calculate and /api/residency.
// GDPR Art. 4(1): SHA-256 hashes of request/response bodies are NOT personal data
// when collision-resistant + per-deployment salting is used.
// Retention: indefinite (no PII stored).
// ────────────────────────────────────────────────────────────────────────────

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    timestamp: integer('timestamp').notNull(), // Unix ms
    userIdOrNull: text('user_id_or_null'), // null for anonymous
    route: text('route').notNull(), // e.g. '/api/calculate'
    method: text('method').notNull(), // 'POST' | 'GET' etc
    inputHash: text('input_hash'), // hex SHA-256 of request body (first 64KB), null if no body
    resultHash: text('result_hash'), // hex SHA-256 of response body
    statusCode: integer('status_code').notNull(),
    source: text('source').notNull().default('api'), // 'api' | 'webhook' | 'cli' for future
  },
  (t) => ({
    // Partial index for the most common query pattern: "show me a user's recent audit trail"
    byUserTime: index('idx_audit_user_time').on(t.userIdOrNull, t.timestamp),
    // Allows route-specific aggregations
    byRouteTime: index('idx_audit_route_time').on(t.route, t.timestamp),
  }),
);

// ────────────────────────────────────────────────────────────────────────────
// F1 — Income & Tax calculations
// ────────────────────────────────────────────────────────────────────────────

export const userIncome = sqliteTable(
  'user_income',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taxYear: integer('tax_year').notNull(),
    incomeType: text('income_type').notNull(), // salary|self_employed|dividends|interest|rental|capital_gains|crypto|other
    country: text('country').notNull(),
    amountAnnual: real('amount_annual').notNull(),
    currency: text('currency').notNull().default('EUR'),
    withholdingTax: real('withholding_tax').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    userYearIdx: index('idx_income_user_year').on(t.userId, t.taxYear),
  }),
);

export const taxCalculations = sqliteTable(
  'tax_calculations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    country: text('country').notNull(),
    taxYear: integer('tax_year').notNull(),
    incomeType: text('income_type').notNull(),
    specialStatus: text('special_status'),
    grossIncome: real('gross_income').notNull(),
    taxOwed: real('tax_owed').notNull(),
    effectiveRate: real('effective_rate').notNull(),
    breakdown: text('breakdown', { mode: 'json' }).notNull(),
    calculatedAt: integer('calculated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userIdx: index('idx_tax_calc_user').on(t.userId, t.taxYear),
  }),
);

// ────────────────────────────────────────────────────────────────────────────
// F3 — Tax filings
// ────────────────────────────────────────────────────────────────────────────

export const taxFilings = sqliteTable(
  'tax_filings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    country: text('country').notNull(),
    taxYear: integer('tax_year').notNull(),
    formType: text('form_type').notNull(), // modelo_100|sa100|mantelbogen|...
    status: text('status').notNull().default('draft'), // draft|generated|submitted|confirmed
    pdfR2Key: text('pdf_r2_key'),
    formData: text('form_data', { mode: 'json' }).notNull(),
    generatedAt: integer('generated_at', { mode: 'timestamp' }),
    submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  },
  (t) => ({
    userIdx: index('idx_filings_user').on(t.userId, t.taxYear),
  }),
);

// W4 T0.5 — mapping version ledger.
// Every ingest run that produces a *new* content hash gets a new row here, so
// `(country, form_type, tax_year, version)` is a monotonic sequence per form.
// The latest row's `content_hash` seeds the cache-key for ETag headers and
// Workers Cache lookups, giving us automatic invalidation when a mapping
// changes.
export const formMappingVersions = sqliteTable(
  'form_mapping_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    country: text('country').notNull(),
    formType: text('form_type').notNull(),
    taxYear: integer('tax_year').notNull(),
    // Monotonic per (country, form_type, tax_year). Starts at 1.
    version: integer('version').notNull(),
    // Hex sha256 of canonical (key-sorted) JSON of the parsed FormMapping.
    contentHash: text('content_hash').notNull(),
    // Unix ms — set by ingest, not by DB default, so tests can pin it.
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    uniqueVersion: uniqueIndex('idx_fmv_unique').on(t.country, t.formType, t.taxYear, t.version),
    // Lookup pattern: latest version for a given (country, year, form_type).
    lookup: index('idx_fmv_lookup').on(t.country, t.taxYear, t.formType, t.version),
  }),
);

export const formFieldMappings = sqliteTable(
  'form_field_mappings',
  {
    id: text('id').primaryKey(),
    country: text('country').notNull(),
    formType: text('form_type').notNull(),
    taxYear: integer('tax_year').notNull(),
    fieldName: text('field_name').notNull(),
    fieldLabel: text('field_label'),
    dataPath: text('data_path').notNull(), // e.g. income.salary.annual
    fieldType: text('field_type').notNull().default('text'), // text|number|checkbox|date
    pageNumber: integer('page_number'),
    boxNumber: text('box_number'), // e.g. "520" for ES Modelo 100
    notes: text('notes'),
    pdfR2Key: text('pdf_r2_key'), // e.g. 'tax-forms/DE/2024/mantelbogen.pdf' — null until ingested
    pdfSha256: text('pdf_sha256'), // hex hash of the source PDF for audit
    pageCount: integer('page_count'),
    deletedAt: integer('deleted_at'), // Unix ms — soft-delete; null = active
    // W4 overlay rendering: coordinate-based field positioning
    xCoord: real('x_coord'), // PDF page x coordinate, null for AcroForm-only fields
    yCoord: real('y_coord'), // PDF page y coordinate
    fontSize: real('font_size'), // null = use mapping default (e.g. 10pt)
    fieldKind: text('field_kind').notNull().default('acroform'), // 'acroform' | 'coordinate'
    // W4 T0.5: which mapping version produced this row.
    // NULL for rows ingested before T0.5 (backward-compat).
    versionId: integer('version_id').references(() => formMappingVersions.id),
    // Oracle P2-A (W4 review): per-field value transform applied at render
    // time. Stored alongside the field row so the /render handler doesn't
    // hard-code 'none' (which silently made `format-date-de` etc. a no-op
    // — German tax forms got ISO timestamps instead of '03.06.2026').
    // Valid values mirror TransformSchema in src/forms/types.ts; ingest
    // backfills from YAML and the DB column is the source of truth for
    // the route. NOT NULL DEFAULT 'none' so pre-migration rows stay
    // backward-compatible (render behavior unchanged for them).
    transform: text('transform').notNull().default('none'),
  },
  (t) => ({
    uniqueField: uniqueIndex('idx_form_field_unique').on(
      t.country,
      t.formType,
      t.taxYear,
      t.fieldName,
    ),
  }),
);

// ────────────────────────────────────────────────────────────────────────────
// F4 — Strategy recommendations
// ────────────────────────────────────────────────────────────────────────────

export const strategyRecommendations = sqliteTable(
  'strategy_recommendations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taxYear: integer('tax_year').notNull(),
    strategyId: text('strategy_id').notNull(), // beckham_law|30pct_ruling|...
    tier: text('tier').notNull(), // A|B|C
    eligible: integer('eligible', { mode: 'boolean' }).notNull(),
    estimatedSavings: real('estimated_savings'),
    confidence: real('confidence'), // 0-1
    actionSteps: text('action_steps', { mode: 'json' }),
    citations: text('citations', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    userYearIdx: index('idx_strategy_user_year').on(t.userId, t.taxYear),
  }),
);

// ────────────────────────────────────────────────────────────────────────────
// Oracle P1-7 (W4 review): D1-atomic rate-limit counter.
// Replaces KV-based read-then-write (eventually consistent — concurrent reqs
// could both read N and both write N+1, bypassing the cap). The composite
// PK (key, window_start) is what enables the atomic upsert pattern
// `INSERT … ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
// RETURNING count`, which D1/SQLite guarantees is serialised per row.
// expires_at is for a future sweeper job; rows are otherwise harmless.
// ────────────────────────────────────────────────────────────────────────────

export const rateLimitCounters = sqliteTable(
  'rate_limit_counters',
  {
    key: text('key').notNull(), // e.g. 'rl:render:user-abc'
    windowStart: integer('window_start').notNull(), // unix seconds
    count: integer('count').notNull().default(0),
    expiresAt: integer('expires_at').notNull(), // unix seconds — for sweep
  },
  (t) => ({
    pk: primaryKey({ columns: [t.key, t.windowStart] }),
    expiresIdx: index('rate_limit_counters_expires_idx').on(t.expiresAt),
  }),
);

// ────────────────────────────────────────────────────────────────────────────
// F9 — Deadline calendar
// ────────────────────────────────────────────────────────────────────────────

export const deadlines = sqliteTable(
  'deadlines',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taxYear: integer('tax_year').notNull(),
    jurisdiction: text('jurisdiction').notNull(), // ISO 3166-1 alpha-2
    title: text('title').notNull(),
    description: text('description'),
    dueDate: text('due_date').notNull(), // YYYY-MM-DD
    status: text('status').notNull().default('pending'), // pending|completed|snoozed|dismissed
    category: text('category').notNull(), // tax_filing|payment|document|milestone|other
    source: text('source').notNull().default('user'), // system|user|advisor
    reminderDays: integer('reminder_days').notNull().default(7),
    snoozedUntil: text('snoozed_until'), // YYYY-MM-DD, only meaningful when status=snoozed
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    userStatusIdx: index('idx_deadlines_user_status').on(t.userId, t.status),
    userDueDateIdx: index('idx_deadlines_user_due_date').on(t.userId, t.dueDate),
    userYearIdx: index('idx_deadlines_user_year').on(t.userId, t.taxYear),
  }),
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type UserDays = typeof userDays.$inferSelect;
export type TaxCalculation = typeof taxCalculations.$inferSelect;
export type ResidencyAssessment = typeof residencyAssessments.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
export type FormFieldMapping = typeof formFieldMappings.$inferSelect;
export type FormMappingVersion = typeof formMappingVersions.$inferSelect;
export type NewFormMappingVersion = typeof formMappingVersions.$inferInsert;
export type Deadline = typeof deadlines.$inferSelect;
export type NewDeadline = typeof deadlines.$inferInsert;
