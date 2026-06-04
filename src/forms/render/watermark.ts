// Oracle P1-5 (W4 review): rotated-bbox overflow detection + downscale fit pass.
/**
 * watermark.ts — Pure helper for W4 T3.1b (DRAFT watermark layer).
 *
 * Stamps a large, diagonal, semi-transparent "DRAFT" mark on every page of a
 * pdf-lib `PDFDocument`. Intended to run as the FINAL pass in the render
 * pipeline (after all field-level draws) so the output is unmistakably marked
 * as a draft before it leaves the worker.
 *
 * Design contract:
 *   - Pure-ish: mutates the supplied `doc` in place, returns `void`. No I/O,
 *     no PDF serialization. The caller is responsible for `doc.save()`.
 *   - Idempotent shape: re-running stacks an additional watermark — that is
 *     the *intended* behaviour. Callers that need exactly-once semantics
 *     must track it themselves.
 *   - WinAnsi-safe via `toWinAnsi` (T3.1c): the supplied text is run through
 *     the WinAnsi transliteration guard before measurement and draw. The
 *     default text intentionally uses an em-dash (`—`) which transliterates
 *     to an ASCII hyphen — this is the canonical end-to-end proof that the
 *     guard is wired up. Watermark-text replacements are NOT surfaced as
 *     warnings (watermark is internal, not user data).
 *   - Performance: callers may supply a pre-embedded `font` to amortise the
 *     `embedFont(Helvetica)` cost across many renders (e.g. fill.ts already
 *     embeds Helvetica for coordinate draws and reuses it here).
 *
 * Oracle P1-5 (W4 review):
 *   The original `computeFontSize` used an empirical 0.5 * size width
 *   estimate keyed off the page diagonal. That worked for A4 portrait /
 *   landscape, but on narrow or rotated pages the resulting bounding box
 *   could overflow the page edges (especially around 45° where the rotated
 *   bbox is √2× the unrotated bbox). The new `computeWatermarkFit` measures
 *   with the real font, projects the rotated bounding box, and downscales
 *   in 5% steps until the rotated bbox fits inside the page (with a 5%
 *   safety margin), bottoming out at `MIN_FONT_SIZE` so tiny pages still
 *   get a watermark even if it's slightly clipped.
 *
 * Edge cases (covered by tests):
 *   - 0-page doc           → no-op (does not throw)
 *   - text === ''          → no-op (does not draw)
 *   - opacity < 0 / > 1    → RangeError at the top, before any draw
 *   - opacity === 0        → still draws (visually invisible but valid)
 *   - rotation === 0 / 90  → horizontal / vertical text still centered
 *   - narrow page          → fit pass downscales until rotated bbox fits
 *   - extremely narrow     → font size bottoms out at MIN_FONT_SIZE
 */

import { type PDFDocument, type PDFFont, StandardFonts, degrees, rgb } from 'pdf-lib';
import { toWinAnsi } from './winansi';

// ─── Public types ───────────────────────────────────────────────────────────

export interface WatermarkOptions {
  /** Watermark text. ASCII-only in this milestone (WinAnsi/Helvetica). */
  text?: string;
  /** Fill opacity, 0..1 inclusive. Default 0.25. Throws RangeError if out of range. */
  opacity?: number;
  /** Each channel 0..1. Default mid-gray for readability over light + dark backgrounds. */
  color?: { r: number; g: number; b: number };
  /**
   * Pre-embedded font to reuse. If omitted, `applyWatermark` embeds
   * `StandardFonts.Helvetica` itself — supply one if you are batching many
   * watermarks against the same doc to avoid re-embedding cost.
   */
  font?: PDFFont;
  /** Rotation in degrees, applied around the page center. Default 45 (diagonal). */
  rotationDegrees?: number;
}

/**
 * Oracle P1-5 (W4 review): output of the fit pass.
 *
 *   - `fontSize`     — final font size to render with (clamped to MIN..MAX).
 *   - `textWidth`    — measured pdf-lib width at `fontSize` (font.widthOfTextAtSize).
 *   - `bboxWidth`    — rotated-text bounding-box width on the page.
 *   - `bboxHeight`   — rotated-text bounding-box height on the page.
 *   - `downscaled`   — true if the fit loop reduced fontSize below the
 *                      "ideal" (diagonal-coverage) size to avoid overflow.
 *   - `clipped`      — true if the rotated bbox still exceeds the safe area
 *                      even at `MIN_FONT_SIZE` (page is too narrow to fit
 *                      the watermark; we render anyway).
 */
export interface WatermarkFit {
  fontSize: number;
  textWidth: number;
  bboxWidth: number;
  bboxHeight: number;
  downscaled: boolean;
  clipped: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Default text. Uses a U+2014 em-dash; the WinAnsi guard transliterates
 * this to an ASCII hyphen at render time, so the on-page output is still
 * `DRAFT - NOT FOR FILING`. Keeping the source-of-truth as an em-dash
 * proves the guard is wired up end-to-end (regression-canary).
 */
const DEFAULT_TEXT = 'DRAFT — NOT FOR FILING';
const DEFAULT_OPACITY = 0.25;
const DEFAULT_ROTATION_DEG = 45;
const DEFAULT_COLOR = { r: 0.5, g: 0.5, b: 0.5 } as const;

/**
 * Empirical char-width factor for Helvetica at the size class we care about
 * (16..200 pt). Helvetica's average advance width is ~0.5 * fontSize for
 * uppercase ASCII, which is what every realistic watermark text will be.
 *
 * Used ONLY for the initial size guess; the fit pass measures with the real
 * font (`font.widthOfTextAtSize`) before deciding whether to downscale.
 */
const HELVETICA_CHAR_WIDTH_FACTOR = 0.5;

/** Target the diagonal coverage at ~70% so the mark dominates without bleeding off the page. */
const DIAGONAL_COVERAGE = 0.7;

/** Clamp range protects against tiny page sizes (thumbnails) and huge ones (posters). */
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 200;

/**
 * Oracle P1-5 (W4 review): safety margin so the rotated bbox is kept at
 * least 5% inside the page edges. Prevents borderline cases (e.g. JIS B5
 * landscape at 45°) from clipping a glyph.
 */
const SAFE_AREA_FACTOR = 0.95;

/** Oracle P1-5 (W4 review): max iterations for the downscale fit loop. */
const MAX_FIT_ITERATIONS = 32;

/**
 * Oracle P1-5 (W4 review): shrink the candidate font size by 5% each
 * iteration of the fit loop. Geometric decay reaches MIN_FONT_SIZE quickly
 * even from MAX_FONT_SIZE (200 → 16 in ~50 iterations; capped at 32).
 */
const FIT_SHRINK_FACTOR = 0.95;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Stamp a diagonal watermark across every page of `doc`. Mutates the document
 * in place; the caller still owns `doc.save()`.
 *
 * Throws `RangeError` only for an invalid `opacity`. Every other invalid
 * input degrades to a no-op (0-page doc, empty text) so this helper is safe
 * to wire as a default-ON final pass in fillForm.
 */
export async function applyWatermark(
  doc: PDFDocument,
  options: WatermarkOptions = {},
): Promise<void> {
  const rawText = options.text ?? DEFAULT_TEXT;
  const opacity = options.opacity ?? DEFAULT_OPACITY;
  const rotation = options.rotationDegrees ?? DEFAULT_ROTATION_DEG;
  const color = options.color ?? DEFAULT_COLOR;

  // Opacity validated upfront so we fail loud BEFORE any partial draw.
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError(`applyWatermark: opacity must be in [0, 1], got ${String(opacity)}`);
  }

  // WinAnsi guard (T3.1c). Watermark text is internal — we silently
  // transliterate any non-encodable codepoints rather than surfacing
  // warnings (callers can't fix the watermark text per-render anyway).
  const { text } = toWinAnsi(rawText);

  // Visual no-ops short-circuit before we pay the font-embed cost.
  if (text === '') return;
  const pages = doc.getPages();
  if (pages.length === 0) return;

  // Embed Helvetica only if the caller didn't supply a font — embedFont is
  // expensive and the pipeline (fill.ts) already has one ready to share.
  const font = options.font ?? (await doc.embedFont(StandardFonts.Helvetica));

  const rad = (rotation * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  for (const page of pages) {
    const { width, height } = page.getSize();
    // Oracle P1-5 (W4 review): real-font fit pass replaces the old
    // empirical-only computeFontSize. Returns the measured text width so we
    // can center accurately without re-measuring below.
    const fit = computeWatermarkFit(width, height, text, font, { rotationDegrees: rotation });
    const fontSize = fit.fontSize;
    const tw = fit.textWidth;
    const th = fontSize; // Helvetica cap height ≈ fontSize for centering purposes.

    // pdf-lib rotates around the text's lower-left origin. To keep the
    // visual center of the rotated text at the page center, we offset the
    // origin by half the rotated bounding box.
    const cx = width / 2;
    const cy = height / 2;
    const x = cx - (tw * cosR - th * sinR) / 2;
    const y = cy - (tw * sinR + th * cosR) / 2;

    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
      opacity,
      rotate: degrees(rotation),
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Oracle P1-5 (W4 review): compute a font size such that the rotated text
 * bounding box fits inside the page's safe area.
 *
 * Algorithm:
 *   1. Estimate an "ideal" size from the diagonal-coverage heuristic
 *      (same as the original empirical formula) and clamp to [MIN, MAX].
 *   2. Measure the real text width with `font.widthOfTextAtSize(text, size)`.
 *   3. Project the rotated bounding box on the page axes:
 *        bboxWidth  = |tw * cos(θ)| + |th * sin(θ)|
 *        bboxHeight = |tw * sin(θ)| + |th * cos(θ)|
 *      (th ≈ fontSize for Helvetica; close enough for fit purposes.)
 *   4. If bbox exceeds page * SAFE_AREA_FACTOR, shrink size by
 *      FIT_SHRINK_FACTOR (5%) and re-measure, up to MAX_FIT_ITERATIONS.
 *   5. If we hit MIN_FONT_SIZE and still overflow, flag `clipped: true`
 *      and return — we'd rather render a slightly-clipped watermark than
 *      no watermark at all.
 *
 * Exported (not just internal) so tests can assert the fit decisions
 * directly without round-tripping through pdf-lib.
 */
export function computeWatermarkFit(
  pageWidth: number,
  pageHeight: number,
  text: string,
  font: PDFFont,
  options: { rotationDegrees?: number } = {},
): WatermarkFit {
  const rotation = options.rotationDegrees ?? DEFAULT_ROTATION_DEG;
  const rad = (rotation * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  const maxBoxWidth = pageWidth * SAFE_AREA_FACTOR;
  const maxBoxHeight = pageHeight * SAFE_AREA_FACTOR;

  // 1. Initial guess from the diagonal-coverage heuristic.
  const idealSize = initialFontSizeGuess(pageWidth, pageHeight, text);
  let size = idealSize;
  let downscaled = false;

  // 2-4. Fit loop — shrink until the rotated bbox fits or we hit the floor.
  let measured: WatermarkFit | null = null;
  for (let i = 0; i < MAX_FIT_ITERATIONS; i++) {
    const tw = font.widthOfTextAtSize(text, size);
    const th = size;
    const bboxWidth = tw * absCos + th * absSin;
    const bboxHeight = tw * absSin + th * absCos;

    const fits = bboxWidth <= maxBoxWidth && bboxHeight <= maxBoxHeight;
    measured = {
      fontSize: size,
      textWidth: tw,
      bboxWidth,
      bboxHeight,
      downscaled,
      clipped: false,
    };
    if (fits) return measured;

    const next = Math.max(MIN_FONT_SIZE, Math.floor(size * FIT_SHRINK_FACTOR));
    if (next === size) {
      // Already at the floor; mark clipped and bail.
      measured.clipped = true;
      return measured;
    }
    size = next;
    downscaled = true;
  }

  // 5. Iteration cap hit — return the last measurement marked clipped.
  if (measured) {
    measured.clipped = true;
    return measured;
  }
  // Defensive fallback (unreachable: loop runs at least once for non-empty text).
  return {
    fontSize: MIN_FONT_SIZE,
    textWidth: 0,
    bboxWidth: 0,
    bboxHeight: 0,
    downscaled: false,
    clipped: true,
  };
}

/**
 * Pick the initial font size guess such that the rendered text spans ~70%
 * of the page diagonal, then clamp into [MIN, MAX]. Cheap empirical width
 * estimate (no font measurement) — the fit loop refines from here.
 */
function initialFontSizeGuess(width: number, height: number, text: string): number {
  if (text.length === 0) return MIN_FONT_SIZE;
  const diagonal = Math.sqrt(width * width + height * height);
  const targetTextWidth = diagonal * DIAGONAL_COVERAGE;
  const raw = Math.floor(targetTextWidth / (text.length * HELVETICA_CHAR_WIDTH_FACTOR));
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, raw));
}
