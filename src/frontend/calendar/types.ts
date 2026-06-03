/**
 * F6 Calendar — shared types.
 *
 * Keep this file pure types (no runtime imports) so it can be consumed by
 * both view and API modules without circular dependency risk.
 */

export const COUNTRIES = ['DE', 'NL', 'PT', 'ES', 'UK', 'OTHER'] as const;
export type Country = (typeof COUNTRIES)[number];

/**
 * Sentinel used inside the local `pendingChanges` map to mark a cell as
 * "the user wants this day erased". It is distinct from `null`/`undefined`
 * (which mean "no pending change") so we can faithfully round-trip an
 * intentional delete through the save pipeline.
 */
export const ERASE = '__ERASE__' as const;
export type Erase = typeof ERASE;

/** What the user has chosen in the palette: a country, the eraser, or nothing. */
export type PaintTool = Country | Erase | null;

/** A single day entry as exchanged with /api/days. */
export interface DayEntry {
  date: string; // YYYY-MM-DD
  country: Country;
  source?: string;
  note?: string | null;
}

/** Display metadata for the 6 countries (label + accent color). */
export interface CountryMeta {
  label: string;
  /** Background color (used for filled cells and palette chips). */
  bg: string;
  /** Foreground (text) color paired with `bg`. */
  fg: string;
}

export const COUNTRY_META: Record<Country, CountryMeta> = {
  DE: { label: '德国 DE', bg: '#f59e0b', fg: '#ffffff' },     // amber-500 — German flag yellow
  NL: { label: '荷兰 NL', bg: '#f97316', fg: '#ffffff' },     // orange-500 — Dutch orange
  PT: { label: '葡萄牙 PT', bg: '#e11d48', fg: '#ffffff' },   // rose-600 — Portuguese red
  ES: { label: '西班牙 ES', bg: '#b91c1c', fg: '#ffffff' },   // red-700 — Spanish flag red
  UK: { label: '英国 UK', bg: '#1d4ed8', fg: '#ffffff' },     // blue-700 — Union Jack blue
  OTHER: { label: '其它 OTHER', bg: '#94a3b8', fg: '#ffffff' }, // slate-400 — neutral
};
