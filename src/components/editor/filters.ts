/**
 * Pure, O(n) pixel-pass filters for the image editor.
 *
 * Every function mutates the passed {@link ImageData} in place and is a strict
 * no-op when its amount is `0`, so a neutral edit never touches pixels. They
 * are deliberately framework-free (no canvas, no React) and operate on the raw
 * RGBA `Uint8ClampedArray` so they run identically for live preview and the
 * full-resolution export.
 *
 * Amount conventions match {@link AdjustParams}: bipolar controls use
 * −100..100, unipolar controls use 0..100.
 */
import type { AdjustParams } from "./params";

/** Clamp to the valid 8-bit channel range. */
function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Smooth Hermite interpolation between two edges (used by the vignette). */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build the CSS `filter` string that handles Brightness, Contrast and
 * Saturation on the GPU during `drawImage`. Exposure is folded into
 * brightness (roughly a stop of headroom at the extremes). Returns `"none"`
 * when everything is neutral so the compositor can skip the pass.
 */
export function buildFilterString(a: AdjustParams): string {
  const parts: string[] = [];

  // Exposure + brightness → a single multiplicative brightness factor.
  const brightness = 1 + (a.brightness / 100) * 0.6 + (a.exposure / 100) * 0.6;
  if (Math.abs(brightness - 1) > 1e-3) {
    parts.push(`brightness(${Math.max(0, brightness).toFixed(3)})`);
  }

  // Contrast: −100..100 → 0..2.
  const contrast = 1 + a.contrast / 100;
  if (Math.abs(contrast - 1) > 1e-3) {
    parts.push(`contrast(${Math.max(0, contrast).toFixed(3)})`);
  }

  // Saturation: −100..100 → 0..2.
  const saturate = 1 + a.saturation / 100;
  if (Math.abs(saturate - 1) > 1e-3) {
    parts.push(`saturate(${Math.max(0, saturate).toFixed(3)})`);
  }

  return parts.length ? parts.join(" ") : "none";
}

/**
 * Warmth / temperature as a symmetric channel tint: positive warms (adds red,
 * removes blue), negative cools. `amount` is −100..100. Max shift ±32 levels.
 */
export function applyWarmth(img: ImageData, amount: number): void {
  if (!amount) return;
  const shift = (amount / 100) * 32;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp8(d[i] + shift); // R
    d[i + 2] = clamp8(d[i + 2] - shift); // B
  }
}

/**
 * Vibrance — a "smart" saturation boost. Unlike flat saturation, the boost is
 * weighted by `1 − currentSaturation`, so already-vivid pixels move far less
 * than muted ones (protecting skin tones and avoiding clipping). `amount` is
 * −100..100.
 */
export function applyVibrance(img: ImageData, amount: number): void {
  if (!amount) return;
  const amt = amount / 100;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) continue; // grey pixel — nothing to boost.

    // Current saturation in 0..1 and the perceptual grey (average) anchor.
    const sat = (max - min) / 255;
    const avg = (r + g + b) / 3;
    const factor = 1 + amt * (1 - sat);

    d[i] = clamp8(avg + (r - avg) * factor);
    d[i + 1] = clamp8(avg + (g - avg) * factor);
    d[i + 2] = clamp8(avg + (b - avg) * factor);
  }
}

/**
 * Separable box blur of the RGB channels (alpha preserved). Runs two O(n)
 * sliding-window passes, so cost is independent of `radius`. Returns a fresh
 * RGBA buffer; used as the low-pass component of {@link applyClarity}.
 */
function boxBlurRGB(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  const win = radius * 2 + 1;

  // Horizontal pass: src → tmp.
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      // Prime the window with clamped left edge.
      for (let k = -radius; k <= radius; k++) {
        const x = Math.min(w - 1, Math.max(0, k));
        sum += src[row + x * 4 + c];
      }
      for (let x = 0; x < w; x++) {
        tmp[row + x * 4 + c] = sum / win;
        const xOut = Math.max(0, x - radius);
        const xIn = Math.min(w - 1, x + radius + 1);
        sum += src[row + xIn * 4 + c] - src[row + xOut * 4 + c];
      }
    }
  }
  // Copy alpha once.
  for (let i = 3; i < src.length; i += 4) tmp[i] = src[i];

  // Vertical pass: tmp → out.
  for (let x = 0; x < w; x++) {
    const col = x * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const y = Math.min(h - 1, Math.max(0, k));
        sum += tmp[y * w * 4 + col + c];
      }
      for (let y = 0; y < h; y++) {
        out[y * w * 4 + col + c] = sum / win;
        const yOut = Math.max(0, y - radius);
        const yIn = Math.min(h - 1, y + radius + 1);
        sum += tmp[yIn * w * 4 + col + c] - tmp[yOut * w * 4 + col + c];
      }
    }
  }
  for (let i = 3; i < src.length; i += 4) out[i] = src[i];

  return out;
}

/**
 * Clarity — local-contrast enhancement via a large-radius unsharp mask
 * (`out = orig + amount·(orig − blur)`). Positive values add midtone punch,
 * negative values soften. `amount` is −100..100. The blur radius scales with
 * the image so the effect looks consistent across resolutions.
 */
export function applyClarity(
  img: ImageData,
  amount: number,
  w: number,
  h: number,
): void {
  if (!amount) return;
  const radius = Math.max(1, Math.round(Math.min(w, h) / 25));
  const blur = boxBlurRGB(img.data, w, h, radius);
  const amt = (amount / 100) * 0.8;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp8(d[i] + amt * (d[i] - blur[i]));
    d[i + 1] = clamp8(d[i + 1] + amt * (d[i + 1] - blur[i + 1]));
    d[i + 2] = clamp8(d[i + 2] + amt * (d[i + 2] - blur[i + 2]));
  }
}

/**
 * Sharpness — a 3×3 unsharp/convolution kernel (centre `1 + 4a`, cross `−a`)
 * applied to interior pixels against an immutable source copy. `amount` is
 * 0..100.
 */
export function applySharpen(
  img: ImageData,
  amount: number,
  w: number,
  h: number,
): void {
  if (amount <= 0) return;
  const a = amount / 100;
  const center = 1 + 4 * a;
  const src = Uint8ClampedArray.from(img.data);
  const d = img.data;
  const stride = w * 4;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * stride + x * 4;
      for (let c = 0; c < 3; c++) {
        const p = i + c;
        const v =
          center * src[p] -
          a * (src[p - 4] + src[p + 4] + src[p - stride] + src[p + stride]);
        d[p] = clamp8(v);
      }
    }
  }
}

/**
 * Vignette — radial darkening toward the corners using an elliptical distance
 * field and a smooth falloff. `amount` is 0..100 (fraction of light removed at
 * the extreme corners).
 */
export function applyVignette(
  img: ImageData,
  amount: number,
  w: number,
  h: number,
): void {
  if (amount <= 0) return;
  const amt = amount / 100;
  const d = img.data;
  const cx = w / 2;
  const cy = h / 2;
  const SQRT2 = Math.SQRT2;

  for (let y = 0; y < h; y++) {
    const ny = (y - cy) / cy;
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / cx;
      const dist = Math.hypot(nx, ny) / SQRT2; // 0 at centre, 1 at corners.
      const falloff = smoothstep(0.45, 1, dist);
      const factor = 1 - amt * falloff;
      if (factor >= 1) continue;
      const i = (y * w + x) * 4;
      d[i] = clamp8(d[i] * factor);
      d[i + 1] = clamp8(d[i + 1] * factor);
      d[i + 2] = clamp8(d[i + 2] * factor);
    }
  }
}
