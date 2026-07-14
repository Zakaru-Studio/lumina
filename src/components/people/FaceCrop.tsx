import { User } from "lucide-react";

import { assetSrc } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { FaceThumb } from "@/types";

interface FaceCropProps {
  /** The face to crop, or null to render a placeholder. */
  face: FaceThumb | null;
  alt?: string;
  className?: string;
}

/**
 * Compute a normalized crop rect that is **square in pixels** (so the face is
 * never stretched), centered on the face with a margin and clamped inside the
 * image. Works in pixel space using the photo's oriented dimensions, then
 * converts back to normalized coords for the CSS crop.
 */
function framed(f: FaceThumb) {
  const margin = 0.4;
  const W = f.photoW > 0 ? f.photoW : 1;
  const H = f.photoH > 0 ? f.photoH : 1;

  const cx = (f.x + f.w / 2) * W;
  const cy = (f.y + f.h / 2) * H;
  // A true (pixel) square covering the face box plus margin, bounded by the image.
  let side = Math.max(f.w * W, f.h * H) * (1 + margin);
  side = Math.min(side, W, H);

  let left = cx - side / 2;
  let top = cy - side / 2;
  left = Math.min(Math.max(left, 0), W - side);
  top = Math.min(Math.max(top, 0), H - side);

  // Back to normalized: w·W === h·H === side, which keeps the image aspect ratio
  // (and thus the face) undistorted under the CSS `fill` crop below.
  return { x: left / W, y: top / H, w: side / W, h: side / H };
}

/**
 * Render a face by cropping the owning photo's thumbnail to the face bbox —
 * purely in CSS, so no separate crop files are generated or stored. Width and
 * height percentages are independent of the container, so the image's own
 * aspect ratio is corrected automatically and the (near-square) face renders
 * undistorted and centered. The parent sizes this via `className` (e.g.
 * `aspect-square rounded-full`).
 */
export function FaceCrop({ face, alt, className }: FaceCropProps) {
  if (!face || !face.thumbPath) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          className,
        )}
      >
        <User className="h-1/3 w-1/3" />
      </div>
    );
  }
  const { x, y, w, h } = framed(face);
  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      <img
        src={assetSrc(face.thumbPath)}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute max-w-none"
        style={{
          width: `${100 / w}%`,
          height: `${100 / h}%`,
          left: `${(-x / w) * 100}%`,
          top: `${(-y / h) * 100}%`,
          objectFit: "fill",
        }}
      />
    </div>
  );
}
