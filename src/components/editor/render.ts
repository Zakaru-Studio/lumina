/**
 * The single render pipeline shared by live preview and final export.
 *
 * `renderTo` is a pure function of `(canvas, source, params, forExport)`: given
 * the same inputs it always produces the same pixels. Preview and export differ
 * only in the `source` they pass (a downscaled copy vs. the full-resolution
 * original) and in whether the output is clamped to a preview-sized canvas.
 * Because the crop rectangle is normalised, both paths reuse this code verbatim.
 */
import {
  applyClarity,
  applySharpen,
  applyVibrance,
  applyVignette,
  applyWarmth,
  buildFilterString,
} from "./filters";
import type { EditParams, ImageSource } from "./params";
import { transformedSize } from "./params";

/** Longest-edge cap (px) for the live preview render. */
export const PREVIEW_MAX_EDGE = 1600;

/**
 * Reused scratch canvas for the transformed base image. Resized per call so we
 * avoid allocating a fresh full-size canvas on every render (preview fires on
 * every slider tick / crop drag). Safe because `renderTo` runs synchronously on
 * the main thread — there is never a second concurrent user of this canvas.
 */
let scratchBase: HTMLCanvasElement | null = null;

function getScratchBase(w: number, h: number): HTMLCanvasElement {
  // Assigning `width`/`height` (even to the same value) resets the canvas, so
  // each call starts from a cleared surface.
  const c = scratchBase ?? (scratchBase = document.createElement("canvas"));
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Render `source` through `params` into `canvas`, resizing the canvas to the
 * output dimensions.
 *
 * Pipeline:
 *   1. Draw the source into a transformed base canvas (rotate90 + straighten,
 *      then flips), sized to its rotated bounding box.
 *   2. Blit the normalised crop region into `canvas` with the CSS filter chain
 *      (brightness/contrast/saturate, exposure folded into brightness).
 *   3. Run the guarded pixel passes in order: warmth → vibrance → clarity →
 *      sharpness → vignette. Each is a no-op at its neutral value.
 *
 * @param forExport  When `true`, output is full resolution (or the explicit
 *                   resize). When `false`, output is clamped to
 *                   {@link PREVIEW_MAX_EDGE} for responsiveness.
 */
export function renderTo(
  canvas: HTMLCanvasElement,
  source: ImageSource,
  params: EditParams,
  forExport: boolean,
): void {
  const { transform, crop, adjust, resize } = params;
  const { bw, bh } = transformedSize(source, transform);

  // --- 1. Transformed base canvas -----------------------------------------
  const base = getScratchBase(bw, bh);
  const bctx = base.getContext("2d");
  if (!bctx) return;
  bctx.imageSmoothingQuality = "high";
  // Paint an opaque background first. A non-90° rotation (straighten) draws the
  // image into a larger bounding box, leaving transparent triangular corners.
  // JPEG has no alpha, so `toDataURL('image/jpeg')` would flatten those corners
  // to black on export. Filling here keeps the corners a defined colour and
  // makes the on-screen preview match the exported file exactly.
  bctx.fillStyle = "#000";
  bctx.fillRect(0, 0, bw, bh);
  bctx.save();
  bctx.translate(bw / 2, bh / 2);
  bctx.rotate(((transform.rotate90 * 90 + transform.straighten) * Math.PI) / 180);
  bctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
  bctx.drawImage(source, -source.width / 2, -source.height / 2);
  bctx.restore();

  // --- 2. Output geometry --------------------------------------------------
  // Source crop rectangle in transformed-pixel space.
  const sx = crop.x * bw;
  const sy = crop.y * bh;
  const sw = Math.max(1, crop.w * bw);
  const sh = Math.max(1, crop.h * bh);

  // Logical output size honours an explicit resize; otherwise natural crop size.
  let outW = resize.width ?? Math.round(sw);
  let outH = resize.height ?? Math.round(sh);
  outW = Math.max(1, outW);
  outH = Math.max(1, outH);

  // Clamp the preview to a sane working size.
  if (!forExport) {
    const longest = Math.max(outW, outH);
    if (longest > PREVIEW_MAX_EDGE) {
      const k = PREVIEW_MAX_EDGE / longest;
      outW = Math.max(1, Math.round(outW * k));
      outH = Math.max(1, Math.round(outH * k));
    }
  }

  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingQuality = "high";

  // --- 2b. Filtered blit of the crop region -------------------------------
  ctx.filter = buildFilterString(adjust);
  ctx.drawImage(base, sx, sy, sw, sh, 0, 0, outW, outH);
  ctx.filter = "none";

  // --- 3. Pixel passes -----------------------------------------------------
  const needsPixels =
    adjust.warmth !== 0 ||
    adjust.vibrance !== 0 ||
    adjust.clarity !== 0 ||
    adjust.sharpness > 0 ||
    adjust.vignette > 0;
  if (!needsPixels) return;

  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, outW, outH);
  } catch {
    // Canvas is tainted (cross-origin source) — degrade gracefully by keeping
    // the CSS-filtered result without the pixel passes.
    return;
  }

  applyWarmth(img, adjust.warmth);
  applyVibrance(img, adjust.vibrance);
  applyClarity(img, adjust.clarity, outW, outH);
  applySharpen(img, adjust.sharpness, outW, outH);
  applyVignette(img, adjust.vignette, outW, outH);

  ctx.putImageData(img, 0, 0);
}

/** MIME type for a destination path, inferred from its extension. */
export function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "jpg":
    case "jpeg":
    default:
      return "image/jpeg";
  }
}
