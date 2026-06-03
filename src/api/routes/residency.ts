/**
 * F2 — tax residency assessment routes.
 * POST /assess        — single-country ResidencyInput → ResidencyResult
 * POST /assess-multi  — array of ResidencyInput → MultiCountryAssessment
 * GET  /status        — feature status
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings, Variables } from '../index';
import { assessResidency, assessAllCountries } from '../../rules/residency';
import { computeSrtTies, determineUkResidence } from '../../rules/uk/srt-ties';

export const residencyRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Zod schema mirroring ResidencyInput from rules/residency/index.ts ──────

const residencyInputSchema = z.object({
  country: z.enum(['DE', 'NL', 'PT', 'ES', 'UK']),
  taxYear: z.number().int().min(2024).max(2030),
  daysInCountry: z.number().int().min(0).max(366),
  daysInOtherCountries: z.record(z.string(), z.number().int().min(0).max(366)),
  hasPermanentHome: z.boolean().nullable(),
  spouseChildrenIn: z.string().nullable(),
  centerOfVitalInterests: z.string().nullable(),
  habitualAbode: z.string().nullable(),
  nationality: z.string().nullable().optional(),
  srt: z
    .object({
      wasResidentInAnyOfPrior3Years: z.boolean().optional(),
      ties: z.number().int().min(0).max(5).optional(),
      fullTimeWorkOverseas: z.boolean().optional(),
      daysWorkingInUk: z.number().int().min(0).optional(),
      hasUkHome91Days: z.boolean().optional(),
      presentInUkHome30Days: z.boolean().optional(),
      noOverseasHomeOrLittlePresent: z.boolean().optional(),
      fullTimeUkWork365: z.boolean().optional(),
    })
    .optional(),
  srtTiesCount: z.number().int().min(0).max(5).optional(),
});

const srtTiesAnswersSchema = z.object({
  familyResidentInUk: z.boolean(),
  hasAccommodationAvailable91Days: z.boolean(),
  spentNightInAccommodation: z.boolean(),
  ukWorkDays: z.number().int().min(0),
  ukDaysPriorYear1: z.number().int().min(0).max(366),
  ukDaysPriorYear2: z.number().int().min(0).max(366),
  isLeaver: z.boolean(),
  countryWithMostDays: z.string().nullable(),
  ukDays: z.number().int().min(0).max(366),
});

const assessMultiSchema = z.object({
  inputs: z.array(residencyInputSchema).min(1).max(5),
});

// ── Routes ────────────────────────────────────────────────────────────────

residencyRoutes.get('/status', (c) =>
  c.json({
    feature: 'F2 — tax residency assessment',
    status: 'implemented',
    countries: ['DE', 'NL', 'PT', 'ES', 'UK'],
    tiebreaker: 'OECD Model Tax Convention art. 4',
  }),
);

residencyRoutes.post('/assess', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const parsed = residencyInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'validation', issues: parsed.error.issues }, 400);
  }
  const result = assessResidency(parsed.data);
  return c.json({ ok: true, result });
});

residencyRoutes.post('/uk-srt-ties', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const parsed = srtTiesAnswersSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'validation', issues: parsed.error.issues }, 400);
  }

  const { ukDays, ...answers } = parsed.data;
  const tiesResult = computeSrtTies(answers);
  const residenceResult = determineUkResidence({
    ukDays,
    ties: tiesResult.count,
    isLeaver: answers.isLeaver,
  });

  return c.json({
    ties: tiesResult,
    ukDays,
    resident: residenceResult.resident,
    reason: residenceResult.reason,
    disclaimer:
      'This is informational, not legal advice. UK SRT is complex; consult a UK tax advisor for edge cases (Split Year Treatment, FIG regime, exceptional circumstances).',
  });
});

residencyRoutes.post('/assess-multi', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const parsed = assessMultiSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'validation', issues: parsed.error.issues }, 400);
  }
  const result = assessAllCountries(parsed.data.inputs);
  return c.json({ ok: true, result });
});
