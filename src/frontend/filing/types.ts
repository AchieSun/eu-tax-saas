/**
 * W4 T4.1 — Filing draft view shared types.
 *
 * Pure types module (no runtime imports beyond the SUPPORTED_FORMS preset)
 * so it can be imported by both the fetch client (`./api.ts`) and the
 * SolidJS view layer without circular dependency risk.
 *
 * The shapes here mirror the GET /api/forms/:c/:y/:f response (camelCase
 * field roster) and the X-Render-* header bundle returned by the POST
 * /render endpoint defined in `src/api/routes/forms.ts`.
 */

export interface FieldMeta {
  key: string;
  acroName: string;
  fieldType: 'text' | 'number' | 'date' | 'checkbox';
  fieldKind: 'acroform' | 'coordinate';
  dataPath: string;
  pageNumber: number | null;
  xCoord: number | null;
  yCoord: number | null;
  fontSize: number | null;
  sourcePath: string | null;
  citation: string | null;
}

export interface FormMetadata {
  country: string;
  taxYear: number;
  formType: string;
  version: number;
  contentHash: string;
  versionCreatedAt: string;
  fields: FieldMeta[];
}

export interface RenderResult {
  pdfBlob: Blob;
  warnings: number;
  filledFields: number;
  mappingVersion: number;
  mappingHash: string;
}

export interface FormPicker {
  country: string; // 'DE' | 'NL' | 'PT' | 'ES' | 'UK'
  year: number; // 2024 | 2025 | 2026
  form: string; // snake_case, e.g. 'mantelbogen'
}

/**
 * Stable preset list — keeps the picker constrained to forms we know exist
 * in D1 today. Extending this list is a one-liner: add a new entry and the
 * picker selects pick it up automatically.
 */
export const SUPPORTED_FORMS: ReadonlyArray<FormPicker & { label: string }> = [
  { country: 'DE', year: 2024, form: 'mantelbogen', label: 'DE — Mantelbogen ESt 1 A 2024' },
];
