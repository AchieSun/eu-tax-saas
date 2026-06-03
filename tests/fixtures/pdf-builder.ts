/**
 * pdf-builder.ts — Test-facing re-export of the synthetic PDF builders.
 *
 * The real implementations now live in `src/forms/render/synth.ts` so the
 * production W4 T3.2 render endpoint can use them as a dev-fallback source
 * without dragging tests/ into the Worker bundle. This file is kept as a
 * thin re-export so existing test imports (`tests/fixtures/pdf-builder`)
 * continue to work unchanged.
 */

export type {
  FieldKind,
  FieldSpec,
  BuildAcroFormOptions,
  BuildCoordOnlyOptions,
} from '../../src/forms/render/synth';
export {
  buildSynthPdfWithAcroForm,
  buildSynthPdfCoordOnly,
  defaultMantelStyleFields,
} from '../../src/forms/render/synth';
