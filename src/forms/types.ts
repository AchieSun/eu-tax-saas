/**
 * FormMapping Zod schema — single source of truth for the YAML field-mapping
 * format used by W4 (PDF filling / Filing assistant).
 *
 * The YAML files live under `app/src/forms/<COUNTRY>/<YEAR>/<form>.yml` and are
 * loaded at build time via `import.meta.glob` (see ./load.ts).
 *
 * Downstream consumers:
 *   - T1.4 YAML→D1 ingest CLI         (writes into form_field_mappings)
 *   - T2.1 GET /api/forms/:c/:y/:f    (returns parsed FormMapping)
 *   - T3.1 pdf-fill service           (drives pdf-lib AcroForm + overlay draw)
 *
 * Schema conventions (per W4 Decision 1 & 5):
 *   - Every field MUST carry a non-empty `citation` (BMF/HMRC/AEAT reference).
 *     This is the legal/audit anchor — no anonymous numbers in tax forms.
 *   - Discriminator `kind` splits AcroForm widget fills from absolute-coordinate
 *     draws (used for scanned PDFs with no fillable widgets).
 *   - `transform` is an enum, not a free string, so the pdf-fill service can
 *     pattern-match exhaustively at the type level.
 */

import { z } from 'zod';

/** Dot-notation path into the user data bundle (e.g. "calculation.de.income.gross"). */
export const SourcePathSchema = z.string().min(1);

/** How to convert the raw source value into the string written to the PDF. */
export const TransformSchema = z
  .enum([
    'none',
    'floor',
    'round',
    'format-currency-eur', // e.g. "12.345,67 €"
    'format-currency-no-symbol', // e.g. "12345.67" — German tax forms want no symbol
    'format-date-iso', // YYYY-MM-DD
    'format-date-de', // DD.MM.YYYY
    'boolean-x', // "X" if true, "" otherwise
  ])
  .default('none');

/** Field kind: AcroForm widget by name, or absolute coordinate draw. */
export const FieldKindSchema = z.enum(['acroform', 'coordinate']);

const AcroFormFieldSchema = z.object({
  kind: z.literal('acroform'),
  pdfField: z.string().min(1), // AcroForm widget name in the PDF
  sourcePath: SourcePathSchema,
  type: z.enum(['text', 'number', 'date', 'checkbox']).default('text'),
  transform: TransformSchema,
  citation: z.string().min(1), // BMF reference / doc anchor — REQUIRED
  fontSize: z.number().positive().optional(),
});

const CoordinateFieldSchema = z.object({
  kind: z.literal('coordinate'),
  sourcePath: SourcePathSchema,
  type: z.enum(['text', 'number', 'date']).default('text'),
  transform: TransformSchema,
  citation: z.string().min(1),
  page: z.number().int().nonnegative(), // 0-indexed page
  x: z.number(), // PDF point coordinates (lower-left origin)
  y: z.number(),
  fontSize: z.number().positive().default(10),
});

export const FieldSchema = z.discriminatedUnion('kind', [
  AcroFormFieldSchema,
  CoordinateFieldSchema,
]);

export const FormMappingSchema = z.object({
  country: z.enum(['DE', 'NL', 'PT', 'ES', 'UK']),
  year: z.number().int().min(2020).max(2030),
  form: z.string().min(1), // e.g. "mantelbogen", "anlage-n"
  formTitle: z.string().min(1), // human-readable
  sourceUrl: z.string().url(), // official source PDF URL
  sourceVersion: z.string().min(1), // e.g. "BMF 2024-12-15"
  fields: z.array(FieldSchema).min(1),
});

export type FormMapping = z.infer<typeof FormMappingSchema>;
export type Field = z.infer<typeof FieldSchema>;
export type AcroFormField = z.infer<typeof AcroFormFieldSchema>;
export type CoordinateField = z.infer<typeof CoordinateFieldSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type FieldKind = z.infer<typeof FieldKindSchema>;
