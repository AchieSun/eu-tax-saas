/**
 * Shared types for F1 tax calculator (rule engine).
 * All calculators consume the same Input shape and produce the same Result shape.
 */

import { z } from 'zod';

export const SUPPORTED_COUNTRIES = ['ES', 'PT', 'DE', 'NL', 'UK'] as const;
export type Country = (typeof SUPPORTED_COUNTRIES)[number];

export const INCOME_TYPES = [
  'salary',
  'self_employed',
  'dividends',
  'interest',
  'rental',
  'capital_gains',
  'crypto',
  'other',
] as const;
export type IncomeType = (typeof INCOME_TYPES)[number];

export const SPECIAL_STATUSES = [
  'none',
  'beckham', // ES
  'ifici', // PT
  'fig', // UK
  '30pct_ruling', // NL
  'forschungspauschale', // DE
] as const;
export type SpecialStatus = (typeof SPECIAL_STATUSES)[number];

export const FILING_STATUSES = ['single', 'married_joint', 'married_separate'] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];

export const calculatorInputSchema = z.object({
  country: z.enum(SUPPORTED_COUNTRIES),
  taxYear: z.number().int().min(2024).max(2030),
  incomeType: z.enum(INCOME_TYPES),
  grossIncome: z.number().nonnegative(),
  specialStatus: z.enum(SPECIAL_STATUSES).default('none'),
  filingStatus: z.enum(FILING_STATUSES).default('single'),
  region: z.string().optional(), // e.g. ES autonomous community, NL "with/without AOW"
  age: z.number().int().min(0).max(120).optional(),
});

export type CalculatorInput = z.infer<typeof calculatorInputSchema>;

export interface TaxBreakdownItem {
  label: string;
  amount: number;
  rate?: number;
  citation?: string;
}

export interface CalculatorResult {
  country: Country;
  taxYear: number;
  grossIncome: number;
  taxOwed: number;
  netIncome: number;
  effectiveRate: number; // taxOwed / grossIncome
  marginalRate: number; // top bracket rate hit
  breakdown: TaxBreakdownItem[];
  source: string; // primary legal citation
  /** Set when AT/BMF/Belastingdienst haven't published final figures yet. */
  provisional?: boolean;
}

/**
 * Round down to whole EUR (Germany requires this per § 32a Abs. 1 EStG; safe default elsewhere).
 */
export function floorEur(x: number): number {
  return Math.floor(x);
}

/**
 * Round half away from zero (used for human-display effective rates).
 */
export function round(x: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}
