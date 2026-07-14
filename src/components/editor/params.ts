/**
 * Edit parameter model + geometry helpers for the image editor.
 *
 * All parameters are plain, serialisable numbers/booleans with neutral
 * (no-op) defaults, so an untouched edit reproduces the original pixels. The
 * crop rectangle is stored in **normalised** coordinates (`0..1`) relative to
 * the *transformed* image (after rotate/flip/straighten), which makes it
 * resolution-independent: the exact same params render correctly against a
 * downscaled preview source and the full-resolution export source.
 */

/** Any image-like source we can draw to a canvas and measure. */
export type ImageSource = HTMLImageElement | HTMLCanvasElement;

/** Fixed aspect-ratio presets for the crop tool. */
export type AspectKey = "free" | "1:1" | "4:3" | "3:2" | "16:9" | "original";

/** Tonal / colour adjustments. Ranges annotated per field. */
export interface AdjustParams {
  /** Exposure, −100..100 (0 neutral) — folded into CSS `brightness`. */
  exposure: number;
  /** Brightness, −100..100 (0 neutral) — CSS `brightness`. */
  brightness: number;
  /** Contrast, −100..100 (0 neutral) — CSS `contrast`. */
  contrast: number;
  /** Highlights, −100..100 (0 neutral) — luminance-masked shift of bright tones. */
  highlights: number;
  /** Shadows, −100..100 (0 neutral) — luminance-masked shift of dark tones. */
  shadows: number;
  /** Whites, −100..100 (0 neutral) — luminance-masked shift of the brightest tones. */
  whites: number;
  /** Blacks, −100..100 (0 neutral) — luminance-masked shift of the darkest tones. */
  blacks: number;
  /** Saturation, −100..100 (0 neutral) — CSS `saturate`. */
  saturation: number;
  /** Vibrance, −100..100 (0 neutral) — smart saturation (pixel pass). */
  vibrance: number;
  /** Warmth / temperature, −100..100 (0 neutral) — blue↔yellow R/B channel tint. */
  warmth: number;
  /** Tint, −100..100 (0 neutral) — green↔magenta shift on the green channel. */
  tint: number;
  /** Clarity, −100..100 (0 neutral) — large-radius local contrast. */
  clarity: number;
  /** Sharpness, 0..100 (0 neutral) — 3×3 unsharp mask. */
  sharpness: number;
  /** Vignette, 0..100 (0 neutral) — radial edge darkening. */
  vignette: number;
}

/** Geometric transform applied before cropping. */
export interface TransformParams {
  /** Number of clockwise 90° rotation steps (kept in `0..3`). */
  rotate90: number;
  /** Fine straighten angle in degrees, −45..45. */
  straighten: number;
  /** Mirror horizontally. */
  flipH: boolean;
  /** Mirror vertically. */
  flipV: boolean;
}

/** Normalised crop rectangle (relative to the transformed image). */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Crop state: the rectangle plus its locked aspect preset. */
export interface CropParams extends CropRect {
  aspect: AspectKey;
}

/** Output resize. `null` dimensions mean "use the natural cropped size". */
export interface ResizeParams {
  width: number | null;
  height: number | null;
  lockAspect: boolean;
}

/** The complete, self-contained description of an edit. */
export interface EditParams {
  adjust: AdjustParams;
  transform: TransformParams;
  crop: CropParams;
  resize: ResizeParams;
}

/** Neutral adjustment defaults (every pass is a no-op). */
export const DEFAULT_ADJUST: AdjustParams = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  vibrance: 0,
  warmth: 0,
  tint: 0,
  clarity: 0,
  sharpness: 0,
  vignette: 0,
};

/** A full-frame, identity edit. */
export function defaultParams(): EditParams {
  return {
    adjust: { ...DEFAULT_ADJUST },
    transform: { rotate90: 0, straighten: 0, flipH: false, flipV: false },
    crop: { x: 0, y: 0, w: 1, h: 1, aspect: "free" },
    resize: { width: null, height: null, lockAspect: true },
  };
}

/** Numeric aspect ratio (w/h) for a preset, or `null` for free. */
export function aspectValue(
  key: AspectKey,
  natW: number,
  natH: number,
): number | null {
  switch (key) {
    case "1:1":
      return 1;
    case "4:3":
      return 4 / 3;
    case "3:2":
      return 3 / 2;
    case "16:9":
      return 16 / 9;
    case "original":
      return natH > 0 ? natW / natH : null;
    case "free":
    default:
      return null;
  }
}

/**
 * Size of the axis-aligned bounding box of `source` after applying the
 * rotate-90 steps and the straighten angle. Flips do not change the box.
 */
export function transformedSize(
  source: ImageSource,
  t: TransformParams,
): { bw: number; bh: number } {
  const sw = source.width;
  const sh = source.height;
  const rad = ((t.rotate90 * 90 + t.straighten) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    bw: Math.max(1, Math.round(sw * cos + sh * sin)),
    bh: Math.max(1, Math.round(sw * sin + sh * cos)),
  };
}

/**
 * Natural (full-quality) size of the cropped region, in transformed pixels.
 * This is the default export size when no explicit resize is given.
 */
export function croppedNaturalSize(
  source: ImageSource,
  params: EditParams,
): { width: number; height: number } {
  const { bw, bh } = transformedSize(source, params.transform);
  return {
    width: Math.max(1, Math.round(params.crop.w * bw)),
    height: Math.max(1, Math.round(params.crop.h * bh)),
  };
}

/** Clamp helper shared across editor modules. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
