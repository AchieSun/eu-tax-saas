import { z } from 'zod';

export const DEADLINE_STATUSES = ['pending', 'completed', 'snoozed', 'dismissed'] as const;
export const DEADLINE_CATEGORIES = [
  'tax_filing',
  'payment',
  'document',
  'milestone',
  'other',
] as const;
export const DEADLINE_SOURCES = ['system', 'user', 'advisor'] as const;

export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];
export type DeadlineCategory = (typeof DEADLINE_CATEGORIES)[number];
export type DeadlineSource = (typeof DEADLINE_SOURCES)[number];

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ISO_COUNTRY_REGEX = /^[A-Z]{2}$/;

export const deadlineStatusSchema = z.enum(DEADLINE_STATUSES);
export const deadlineCategorySchema = z.enum(DEADLINE_CATEGORIES);
export const deadlineSourceSchema = z.enum(DEADLINE_SOURCES);

export const deadlineInputSchema = z.object({
  taxYear: z.number().int().min(2024).max(2030),
  jurisdiction: z
    .string()
    .regex(ISO_COUNTRY_REGEX, 'jurisdiction must be an ISO-3166-1 alpha-2 code'),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().regex(ISO_DATE_REGEX, 'dueDate must be YYYY-MM-DD'),
  status: deadlineStatusSchema.optional(),
  category: deadlineCategorySchema,
  reminderDays: z.number().int().min(0).max(365).optional(),
});

export const deadlineUpdateSchema = z.object({
  taxYear: z.number().int().min(2024).max(2030).optional(),
  jurisdiction: z
    .string()
    .regex(ISO_COUNTRY_REGEX, 'jurisdiction must be an ISO-3166-1 alpha-2 code')
    .optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  dueDate: z.string().regex(ISO_DATE_REGEX, 'dueDate must be YYYY-MM-DD').optional(),
  status: deadlineStatusSchema.optional(),
  category: deadlineCategorySchema.optional(),
  reminderDays: z.number().int().min(0).max(365).optional(),
  snoozedUntil: z
    .string()
    .regex(ISO_DATE_REGEX, 'snoozedUntil must be YYYY-MM-DD')
    .optional()
    .nullable(),
});

export const deadlineSnoozeSchema = z.object({
  until: z.string().regex(ISO_DATE_REGEX, 'until must be YYYY-MM-DD'),
});

export const deadlineListQuerySchema = z.object({
  taxYear: z.coerce.number().int().min(2024).max(2030).optional(),
  status: deadlineStatusSchema.optional(),
  jurisdiction: z.string().length(2).optional(),
  category: deadlineCategorySchema.optional(),
  from: z.string().regex(ISO_DATE_REGEX, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(ISO_DATE_REGEX, 'to must be YYYY-MM-DD').optional(),
});

export type DeadlineInput = z.infer<typeof deadlineInputSchema>;
export type DeadlineUpdate = z.infer<typeof deadlineUpdateSchema>;
export type DeadlineSnooze = z.infer<typeof deadlineSnoozeSchema>;
export type DeadlineListQuery = z.infer<typeof deadlineListQuerySchema>;
