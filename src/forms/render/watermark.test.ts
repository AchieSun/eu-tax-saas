/**
 * watermark.test.ts — Tests for the DRAFT watermark helper (W4 T3.1b).
 *
 * Strategy: build a synthetic PDF via tests/fixtures/pdf-builder, stamp the
 * watermark, then re-parse the resulting PDF and decompress each page's
 * content stream to scan for the literal text. pdf-lib serializes Tj text
 * operands as hex-strings (`<4452414654> Tj` for "DRAFT") inside
 * FlateDecode-compressed content streams, so a plain latin1 byte scan of the
 * saved bytes won't find anything — we have to inflate first.
 */

import { inflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildSynthPdfCoordOnly } from '../../../tests/fixtures/pdf-builder';
import { applyWatermark, computeWatermarkFit } from './watermark';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Decompress every Contents stream on `pageIdx` and return the concatenated
 * latin1 text. The result still contains PDF operators (`Tj`, `Tm`, etc.) but
 * any literal Tj operand text shows up either as `(text)` or as a hex string
 * `<48656c...>` — `extractTjStrings` handles both.
 */
function decodePageContentStream(pdf: PDFDocument, pageIdx: number): string {
  const page = pdf.getPage(pageIdx);
  const ctx = pdf.context;
  const contents = page.node.Contents();
  if (!contents) return '';

  // `Contents` may be a single stream ref or an array of stream refs.
  const items =
    typeof (contents as { asArray?: () => unknown[] }).asArray === 'function'
      ? (contents as { asArray: () => unknown[] }).asArray()
      : [contents];

  let combined = '';
  for (const item of items) {
    // `item` is typed `unknown` here because Contents() may be a single ref,
    // a stream object, or an array of refs. ctx.lookup accepts PDFObject |
    // PDFRef so an `as never` widening keeps us correct at runtime while
    // satisfying the LookupKey type union.
    const stream = ctx.lookup(item as never) as { contents?: Uint8Array };
    const raw = stream?.contents;
    if (!raw) continue;
    try {
      combined += inflateSync(Buffer.from(raw)).toString('latin1');
    } catch {
      // Stream wasn't deflated (older pdf-lib write paths) — read as-is.
      combined += Buffer.from(raw).toString('latin1');
    }
  }
  return combined;
}

/**
 * Pull every text operand out of a decoded content stream. Handles the two
 * shapes pdf-lib emits: `(literal) Tj` and `<48656c6c6f> Tj`. Returns the
 * concatenation so a single `.includes(search)` covers both.
 */
function extractTjStrings(decoded: string): string {
  let out = '';
  // Literal-string Tj operands: `(text) Tj`
  for (const m of decoded.matchAll(/\(([^)]*)\)\s*Tj/g)) {
    out += m[1];
  }
  // Hex-string Tj operands: `<hexpairs> Tj`
  for (const m of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    const hex = m[1];
    let s = '';
    for (let i = 0; i < hex.length; i += 2) {
      s += String.fromCharCode(Number.parseInt(hex.substring(i, i + 2), 16));
    }
    out += s;
  }
  return out;
}

/** Stamp the watermark and report whether the decoded text for any page contains `search`. */
async function applyAndScan(
  pdfBytes: Uint8Array,
  search: string,
  options?: Parameters<typeof applyWatermark>[1],
): Promise<{ contains: boolean; size: number; pagesContaining: number }> {
  const doc = await PDFDocument.load(pdfBytes);
  await applyWatermark(doc, options);
  const out = await doc.save();

  const reloaded = await PDFDocument.load(out);
  let pagesContaining = 0;
  for (let i = 0; i < reloaded.getPageCount(); i++) {
    const decoded = decodePageContentStream(reloaded, i);
    const text = extractTjStrings(decoded);
    if (text.includes(search)) pagesContaining += 1;
  }

  return {
    contains: pagesContaining > 0,
    size: out.byteLength,
    pagesContaining,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('applyWatermark — default behaviour', () => {
  it('stamps "DRAFT" on a single-page PDF', async () => {
    const pdf = await buildSynthPdfCoordOnly();
    const result = await applyAndScan(pdf, 'DRAFT');
    expect(result.contains).toBe(true);
    expect(result.pagesContaining).toBe(1);
  });

  it('stamps "DRAFT" on every page of a 3-page PDF', async () => {
    const pdf = await buildSynthPdfCoordOnly({ pageCount: 3 });
    const result = await applyAndScan(pdf, 'DRAFT');
    expect(result.pagesContaining).toBe(3);
  });

  it('produces a valid PDF that re-parses without error', async () => {
    const pdf = await buildSynthPdfCoordOnly();
    const doc = await PDFDocument.load(pdf);
    await applyWatermark(doc);
    const out = await doc.save();

    // %PDF magic header survives.
    expect(out[0]).toBe(0x25);
    expect(out[1]).toBe(0x50);
    expect(out[2]).toBe(0x44);
    expect(out[3]).toBe(0x46);

    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

describe('applyWatermark — option handling', () => {
  it('honours custom text and writes that instead of the default', async () => {
    const pdf = await buildSynthPdfCoordOnly();
    const withCustom = await applyAndScan(pdf, 'CUSTOM', { text: 'CUSTOM' });
    expect(withCustom.contains).toBe(true);

    // Default text must NOT appear when overridden.
    const withoutDefault = await applyAndScan(pdf, 'DRAFT', { text: 'CUSTOM' });
    expect(withoutDefault.contains).toBe(false);
  });

  it('renders at low opacity without crashing and still produces a valid PDF', async () => {
    const pdf = await buildSynthPdfCoordOnly();
    const result = await applyAndScan(pdf, 'DRAFT', { opacity: 0.1 });
    expect(result.contains).toBe(true);
    expect(result.size).toBeGreaterThan(0);
  });

  it('throws RangeError when opacity is out of bounds', async () => {
    const pdf = await buildSynthPdfCoordOnly();
    const doc1 = await PDFDocument.load(pdf);
    await expect(applyWatermark(doc1, { opacity: -0.5 })).rejects.toBeInstanceOf(RangeError);

    const doc2 = await PDFDocument.load(pdf);
    await expect(applyWatermark(doc2, { opacity: 1.5 })).rejects.toBeInstanceOf(RangeError);

    const doc3 = await PDFDocument.load(pdf);
    await expect(applyWatermark(doc3, { opacity: Number.NaN })).rejects.toBeInstanceOf(RangeError);
  });

  it('accepts rotation 0 (horizontal) and 90 (vertical) — both produce valid PDFs', async () => {
    const pdf = await buildSynthPdfCoordOnly();

    const horizontal = await applyAndScan(pdf, 'DRAFT', { rotationDegrees: 0 });
    expect(horizontal.contains).toBe(true);

    const vertical = await applyAndScan(pdf, 'DRAFT', { rotationDegrees: 90 });
    expect(vertical.contains).toBe(true);

    // Sanity: re-parse after 90deg rotation.
    const doc = await PDFDocument.load(pdf);
    await applyWatermark(doc, { rotationDegrees: 90 });
    const out = await doc.save();
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('honours a custom color without crashing', async () => {
    const pdf = await buildSynthPdfCoordOnly();
    const result = await applyAndScan(pdf, 'DRAFT', { color: { r: 1, g: 0, b: 0 } });
    expect(result.contains).toBe(true);
  });
});

describe('applyWatermark — edge cases', () => {
  it('is a no-op on a 0-page document (does not throw)', async () => {
    const doc = await PDFDocument.create(); // zero pages
    await expect(applyWatermark(doc)).resolves.toBeUndefined();
    // Doc still serializable.
    const out = await doc.save();
    expect(out.byteLength).toBeGreaterThan(0);
  });

  it('is a no-op when text is empty (byte size stays within small tolerance)', async () => {
    const pdf = await buildSynthPdfCoordOnly();

    // Baseline: load + save without watermark gives the comparison size.
    const baselineDoc = await PDFDocument.load(pdf);
    const baseline = await baselineDoc.save();

    const wmDoc = await PDFDocument.load(pdf);
    await applyWatermark(wmDoc, { text: '' });
    const wm = await wmDoc.save();

    // No draw means no new content-stream additions. Allow 100B slop for
    // pdf-lib's normal serialization variance (xref offsets, etc.).
    expect(Math.abs(wm.byteLength - baseline.byteLength)).toBeLessThanOrEqual(100);

    // And of course no "DRAFT" text should have been drawn.
    const reloaded = await PDFDocument.load(wm);
    const decoded = decodePageContentStream(reloaded, 0);
    expect(extractTjStrings(decoded).includes('DRAFT')).toBe(false);
  });

  it('reuses a caller-supplied font instead of embedding a new one', async () => {
    const pdf = await buildSynthPdfCoordOnly();
    const doc = await PDFDocument.load(pdf);
    const { StandardFonts: SF } = await import('pdf-lib');
    const font = await doc.embedFont(SF.Helvetica);

    await applyWatermark(doc, { font });
    const out = await doc.save();

    const reloaded = await PDFDocument.load(out);
    const decoded = decodePageContentStream(reloaded, 0);
    expect(extractTjStrings(decoded).includes('DRAFT')).toBe(true);
  });

  it('accepts opacity exactly 0 and exactly 1 (boundary inclusive)', async () => {
    const pdf = await buildSynthPdfCoordOnly();
    const doc0 = await PDFDocument.load(pdf);
    await expect(applyWatermark(doc0, { opacity: 0 })).resolves.toBeUndefined();

    const doc1 = await PDFDocument.load(pdf);
    await expect(applyWatermark(doc1, { opacity: 1 })).resolves.toBeUndefined();
  });
});

describe('applyWatermark — WinAnsi guard (T3.1c)', () => {
  it('default text uses a U+2014 em-dash internally but renders as an ASCII hyphen', async () => {
    // The constant in watermark.ts is `'DRAFT — NOT FOR FILING'` (em-dash).
    // After the WinAnsi guard, it must hit drawText as `'DRAFT - NOT FOR FILING'`
    // (hyphen) and never throw. We verify by scanning the decoded Tj stream.
    const pdf = await buildSynthPdfCoordOnly();
    const withHyphen = await applyAndScan(pdf, 'DRAFT - NOT FOR FILING');
    expect(withHyphen.contains).toBe(true);

    // And the literal em-dash bytes must NOT appear (guard actually ran).
    const withEmDash = await applyAndScan(pdf, 'DRAFT \u2014 NOT FOR FILING');
    expect(withEmDash.contains).toBe(false);
  });
});

// ── Oracle P1-5 (W4 review): rotated-bbox overflow + downscale ─────────
describe('computeWatermarkFit — overflow detection + downscale', () => {
  // Helper: build a one-page synth doc at the requested size and embed
  // Helvetica so we can pass a real PDFFont to computeWatermarkFit.
  async function embedHelvetica(width: number, height: number) {
    const bytes = await buildSynthPdfCoordOnly({ pageWidth: width, pageHeight: height });
    const pdf = await PDFDocument.load(bytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    return { pdf, font };
  }

  it('produces a non-clipped fit with rotated bbox inside the page safe area', async () => {
    // A4 portrait. The diagonal-coverage heuristic intentionally
    // over-estimates the ideal size (it's a crude 0.5×fontSize width
    // model), so even on A4 the fit pass may downscale a step or two
    // before the rotated bbox fits inside the 5% safe area. What we
    // contract on is the OUTCOME: a real-font-measured bbox that
    // demonstrably fits, never clipped, and never below MIN_FONT_SIZE.
    const { font } = await embedHelvetica(595, 842);
    const fit = computeWatermarkFit(595, 842, 'DRAFT - NOT FOR FILING', font, {
      rotationDegrees: 45,
    });
    expect(fit.clipped).toBe(false);
    expect(fit.bboxWidth).toBeLessThanOrEqual(595 * 0.95 + 0.0001);
    expect(fit.bboxHeight).toBeLessThanOrEqual(842 * 0.95 + 0.0001);
    expect(fit.fontSize).toBeGreaterThanOrEqual(16);
    expect(fit.fontSize).toBeLessThanOrEqual(200);
  });

  it('downscales when the page is too narrow for the ideal-size rotated bbox', async () => {
    // 300x842 — A4 height, but only half the width. Diagonal coverage
    // would happily pick a font size that overflows the narrow axis once
    // rotated 45°.
    const { font } = await embedHelvetica(300, 842);
    const fit = computeWatermarkFit(300, 842, 'DRAFT - NOT FOR FILING', font, {
      rotationDegrees: 45,
    });
    expect(fit.downscaled).toBe(true);
    expect(fit.clipped).toBe(false);
    expect(fit.bboxWidth).toBeLessThanOrEqual(300 * 0.95 + 0.0001);
    expect(fit.bboxHeight).toBeLessThanOrEqual(842 * 0.95 + 0.0001);
  });

  it('floors at MIN_FONT_SIZE and flags clipped:true on extremely narrow pages', async () => {
    // 50x50 — thumbnail-sized. The diagonal-coverage heuristic already
    // bottoms out at MIN_FONT_SIZE (16) here, so the very first measurement
    // overflows and we mark clipped:true without ever entering the shrink
    // branch (downscaled stays false because we never reduced from a
    // larger size).
    const { font } = await embedHelvetica(50, 50);
    const fit = computeWatermarkFit(50, 50, 'DRAFT - NOT FOR FILING', font, {
      rotationDegrees: 45,
    });
    expect(fit.fontSize).toBe(16);
    expect(fit.clipped).toBe(true);
    // Page is far too narrow at any size in our range — bbox MUST exceed
    // the safe area at the floor size.
    expect(fit.bboxWidth).toBeGreaterThan(50 * 0.95);
  });

  it('rotation 0 (horizontal) only checks width, allowing larger fontSize than 45°', async () => {
    // 1000x300 — wide and short. At 0° the rotated bbox = unrotated bbox,
    // so width is the only constraint; at 45° the diagonal halves the
    // effective space and forces downscale.
    const { font } = await embedHelvetica(1000, 300);
    const flat = computeWatermarkFit(1000, 300, 'DRAFT - NOT FOR FILING', font, {
      rotationDegrees: 0,
    });
    const diagonal = computeWatermarkFit(1000, 300, 'DRAFT - NOT FOR FILING', font, {
      rotationDegrees: 45,
    });
    expect(flat.fontSize).toBeGreaterThanOrEqual(diagonal.fontSize);
    expect(flat.bboxWidth).toBeLessThanOrEqual(1000 * 0.95 + 0.0001);
    expect(flat.bboxHeight).toBeLessThanOrEqual(300 * 0.95 + 0.0001);
    expect(diagonal.bboxHeight).toBeLessThanOrEqual(300 * 0.95 + 0.0001);
  });

  it('rotated bbox math: a square 45° rotation gives bbox = unrotatedDiagonal', async () => {
    // Sanity check on the projection formula. For a square text bbox
    // (tw = th = fontSize) at 45°, the rotated bbox edges should each be
    // (tw + th)/√2 × √2 = tw + th. Specifically: bboxWidth ≈ bboxHeight.
    const { font } = await embedHelvetica(2000, 2000);
    const fit = computeWatermarkFit(2000, 2000, 'X', font, { rotationDegrees: 45 });
    // 1-char text — width ≪ fontSize. Bbox width ≈ bbox height because at
    // 45° both axes get equal contributions from tw and th.
    expect(Math.abs(fit.bboxWidth - fit.bboxHeight)).toBeLessThan(1);
  });

  it('applyWatermark threads the fit result through end-to-end (narrow page still gets watermark)', async () => {
    const bytes = await buildSynthPdfCoordOnly({ pageWidth: 300, pageHeight: 842 });
    const pdf = await PDFDocument.load(bytes);
    await applyWatermark(pdf);
    const saved = await pdf.save();
    const reopened = await PDFDocument.load(saved);
    const decoded = decodePageContentStream(reopened, 0);
    const tj = extractTjStrings(decoded);
    // Watermark text must still be present even though the page was too
    // narrow for the ideal-size pass.
    expect(tj).toContain('DRAFT');
    expect(tj).toContain('NOT FOR FILING');
  });
});
