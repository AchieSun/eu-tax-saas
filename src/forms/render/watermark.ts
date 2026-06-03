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
 *   - WinAnsi-safe only in this milestone: the default text deliberately uses
 *     an ASCII hyphen (`-`), NOT an em-dash, because pdf-lib's Helvetica is
 *     WinAnsi-encoded and would throw on `—`. Proper transliteration /
 *     non-Latin support is T3.1c.
 *   - Performance: callers may supply a pre-embedded `font` to amortise the
 *     `embedFont(Helvetica)` cost across many renders (e.g. fill.ts already
 *     embeds Helvetica for coordinate draws and reuses it here).
 *
 * Edge cases (covered by tests):
 *   - 0-page doc           → no-op (does not throw)
 *   - text === ''          → no-op (does not draw)
 *   - opacity < 0 / > 1    → RangeError at the top, before any draw
 *   - opacity === 0        → still draws (visually invisible but valid)
 *   - rotation === 0 / 90  → horizontal / vertical text still centered
 */

import { type PDFDocument, type PDFFont, StandardFonts, degrees, rgb } from 'pdf-lib';

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

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Default text. ASCII hyphen on purpose — see file header. T3.1c will swap in
 * the proper em-dash once the Unicode/transliteration pass is wired up.
 */
const DEFAULT_TEXT = 'DRAFT - NOT FOR FILING';
const DEFAULT_OPACITY = 0.25;
const DEFAULT_ROTATION_DEG = 45;
const DEFAULT_COLOR = { r: 0.5, g: 0.5, b: 0.5 } as const;

/**
 * Empirical char-width factor for Helvetica at the size class we care about
 * (16..200 pt). Helvetica's average advance width is ~0.5 * fontSize for
 * uppercase ASCII, which is what every realistic watermark text will be.
 */
const HELVETICA_CHAR_WIDTH_FACTOR = 0.5;

/** Target the diagonal coverage at ~70% so the mark dominates without bleeding off the page. */
const DIAGONAL_COVERAGE = 0.7;

/** Clamp range protects against tiny page sizes (thumbnails) and huge ones (posters). */
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 200;

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
  const text = options.text ?? DEFAULT_TEXT;
  const opacity = options.opacity ?? DEFAULT_OPACITY;
  const rotation = options.rotationDegrees ?? DEFAULT_ROTATION_DEG;
  const color = options.color ?? DEFAULT_COLOR;

  // Opacity validated upfront so we fail loud BEFORE any partial draw.
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError(`applyWatermark: opacity must be in [0, 1], got ${String(opacity)}`);
  }

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
    const fontSize = computeFontSize(width, height, text);

    // Measure with the real font to get pixel-accurate centering.
    const tw = font.widthOfTextAtSize(text, fontSize);
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
 * Pick a font size such that the rendered text spans ~70% of the page
 * diagonal, then clamp into a safe range. Uses a cheap empirical width
 * estimate to avoid calling `font.widthOfTextAtSize` in a fit loop.
 */
function computeFontSize(width: number, height: number, text: string): number {
  if (text.length === 0) return MIN_FONT_SIZE;
  const diagonal = Math.sqrt(width * width + height * height);
  const targetTextWidth = diagonal * DIAGONAL_COVERAGE;
  const raw = Math.floor(targetTextWidth / (text.length * HELVETICA_CHAR_WIDTH_FACTOR));
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, raw));
}
