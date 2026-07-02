/**
 * F7 — User dashboard aggregation route.
 *
 * GET /api/dashboard?taxYear=2025
 *
 * Returns a single JSON payload that stitches together the user's
 * residency, days tracker, persisted strategies, upcoming deadlines and
 * filing-draft status. Designed to power the dashboard homepage with one
 * D1 round-trip per section (executed in parallel).
 */

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../../db';
import {
  deadlines,
  residencyAssessments,
  strategyRecommendations,
  userDays,
  users,
} from '../../db/schema';
import { getStrategyById } from '../../strategies';
import type { Bindings, Variables } from '../index';

export const dashboardRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const taxYearSchema = z.coerce.number().int().min(2024).max(2030).default(2025);

// Countries supported by the days tracker / residency modules.
const DASHBOARD_COUNTRIES = ['ES', 'PT', 'DE', 'NL', 'UK'] as const;

function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function safeIso(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function countryFlag(country: string): string {
  const map: Record<string, string> = {
    ES: '🇪🇸',
    PT: '🇵🇹',
    DE: '🇩🇪',
    NL: '🇳🇱',
    UK: '🇬🇧',
  };
  return map[country] ?? '🏳️';
}

dashboardRoutes.get('/', async (c) => {
  const session = c.get('session');
  if (!session?.user?.id) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const taxYear = taxYearSchema.parse(c.req.query('taxYear'));
  const userId = session.user.id;
  const db = createDb(c.env.DB);

  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;

  // Parallel D1 reads — one per card.
  const [userRows, latestResidency, persistedStrategies, dayRows, deadlineRows] = await Promise.all(
    [
      // User profile (first name + subscription status for the header).
      db
        .select({ name: users.name, subscriptionStatus: users.subscriptionStatus })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),

      // Most recent residency assessment for the tax year.
      db
        .select({
          country: residencyAssessments.country,
          isResident: residencyAssessments.isResident,
          confidence: residencyAssessments.confidence,
          hasConflict: residencyAssessments.hasConflict,
          conflictWith: residencyAssessments.conflictWith,
          createdAt: residencyAssessments.createdAt,
        })
        .from(residencyAssessments)
        .where(
          and(eq(residencyAssessments.userId, userId), eq(residencyAssessments.taxYear, taxYear)),
        )
        .orderBy(desc(residencyAssessments.createdAt))
        .limit(1),

      // Top eligible persisted strategies, sorted by estimated savings.
      db
        .select({
          id: strategyRecommendations.strategyId,
          tier: strategyRecommendations.tier,
          eligible: strategyRecommendations.eligible,
          estimatedSavings: strategyRecommendations.estimatedSavings,
          createdAt: strategyRecommendations.createdAt,
        })
        .from(strategyRecommendations)
        .where(
          and(
            eq(strategyRecommendations.userId, userId),
            eq(strategyRecommendations.taxYear, taxYear),
            eq(strategyRecommendations.eligible, true),
          ),
        )
        .orderBy(desc(strategyRecommendations.estimatedSavings))
        .limit(3),

      // Days per country in the selected tax year.
      db
        .select({
          country: userDays.country,
          days: sql<number>`count(*)`.as('days'),
        })
        .from(userDays)
        .where(
          and(
            eq(userDays.userId, userId),
            gte(userDays.date, yearStart),
            lte(userDays.date, yearEnd),
          ),
        )
        .groupBy(userDays.country),

      // Upcoming pending deadlines (next 90 days).
      db
        .select({
          id: deadlines.id,
          title: deadlines.title,
          dueDate: deadlines.dueDate,
          status: deadlines.status,
          category: deadlines.category,
          jurisdiction: deadlines.jurisdiction,
        })
        .from(deadlines)
        .where(
          and(
            eq(deadlines.userId, userId),
            eq(deadlines.taxYear, taxYear),
            eq(deadlines.status, 'pending'),
            gte(deadlines.dueDate, yearStart),
          ),
        )
        .orderBy(deadlines.dueDate)
        .limit(5),
    ],
  );

  const user = userRows[0] ?? { name: null, subscriptionStatus: 'free' };
  const firstName = (user.name ?? '').split(' ')[0] || 'there';

  // Residency card: prefer a confident assessment, otherwise show the latest.
  const residency = latestResidency[0]
    ? {
        country: latestResidency[0].country,
        flag: countryFlag(latestResidency[0].country),
        isResident: latestResidency[0].isResident,
        confidence: latestResidency[0].confidence,
        hasConflict: latestResidency[0].hasConflict,
        conflictWith: latestResidency[0].conflictWith,
        assessedAt: safeIso(latestResidency[0].createdAt),
      }
    : null;

  // Strategies card: attach human-readable titles from the registry.
  const strategies = persistedStrategies
    .map((s) => {
      const strategy = getStrategyById(s.id);
      return {
        id: s.id,
        title: strategy?.titleZh ?? s.id,
        tier: s.tier,
        estimatedSavings: s.estimatedSavings,
      };
    })
    .filter((s) => s.estimatedSavings != null)
    .slice(0, 3);

  // Days card: fill in zero for countries the user has not logged yet.
  const daysMap = new Map(dayRows.map((r) => [r.country, r.days]));
  const days = DASHBOARD_COUNTRIES.map((country) => ({
    country,
    flag: countryFlag(country),
    days: daysMap.get(country) ?? 0,
  }));

  // Deadlines card: surface days remaining for each pending item.
  const today = new Date().toISOString().slice(0, 10);
  const upcomingDeadlines = deadlineRows.map((d) => ({
    id: d.id,
    title: d.title,
    dueDate: d.dueDate,
    status: d.status,
    category: d.category,
    jurisdiction: d.jurisdiction,
    daysRemaining: daysBetween(today, d.dueDate),
  }));

  return c.json({
    ok: true,
    taxYear,
    user: {
      firstName,
      subscriptionStatus: user.subscriptionStatus,
    },
    residency,
    // Tax estimate and filing draft are CTAs until we have stored profile /
    // draft progress. The cards render real data when available.
    taxEstimate: null,
    strategies,
    days,
    deadlines: upcomingDeadlines,
    filing: {
      completeness: 0,
      nextStep: '选择国家并填写收入以生成税务草稿',
    },
  });
});
