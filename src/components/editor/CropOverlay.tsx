/**
 * Interactive crop rectangle drawn over the (uncropped) preview image.
 *
 * Works entirely in normalised `0..1` coordinates relative to the transformed
 * image, so it is resolution-independent and matches the render pipeline. The
 * host renders the *full* transformed image while this tool is active and
 * overlays this component at `inset-0`, so the overlay's box maps 1:1 to the
 * image.
 */
import * as React from "react";

import { cn } from "@/lib/utils";
import type { CropRect } from "./params";
import { clamp } from "./params";

/** Which grip the pointer grabbed (a corner) or the body (move). */
type DragMode = "move" | "nw" | "ne" | "sw" | "se";

interface CropOverlayProps {
  /** Current crop rectangle, normalised. */
  rect: CropRect;
  /** Displayed image aspect (bw/bh) — needed to keep a pixel aspect ratio. */
  imageAspect: number;
  /** Target pixel aspect (w/h) to lock to, or `null` for free-form. */
  targetAspect: number | null;
  /** Commit a new rectangle (already clamped to bounds). */
  onChange: (rect: CropRect) => void;
}

const MIN_SIZE = 0.05; // Smallest crop as a fraction of the image.

export function CropOverlay({
  rect,
  imageAspect,
  targetAspect,
  onChange,
}: CropOverlayProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    start: CropRect;
  } | null>(null);

  // Aspect expressed in normalised space (see module docs in params.ts).
  const normAspect =
    targetAspect != null && imageAspect > 0 ? targetAspect / imageAspect : null;

  const onPointerDown = (mode: DragMode) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...rect },
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const state = drag.current;
    const box = ref.current;
    if (!state || !box) return;
    const bounds = box.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;

    const dx = (e.clientX - state.startX) / bounds.width;
    const dy = (e.clientY - state.startY) / bounds.height;
    const s = state.start;

    if (state.mode === "move") {
      const x = clamp(s.x + dx, 0, 1 - s.w);
      const y = clamp(s.y + dy, 0, 1 - s.h);
      onChange({ ...s, x, y });
      return;
    }

    // Resize: the corner opposite the grabbed one stays fixed.
    const anchorX = state.mode === "nw" || state.mode === "sw" ? s.x + s.w : s.x;
    const anchorY = state.mode === "nw" || state.mode === "ne" ? s.y + s.h : s.y;
    let px = clamp((state.mode === "nw" || state.mode === "sw" ? s.x : s.x + s.w) + dx, 0, 1);
    let py = clamp((state.mode === "nw" || state.mode === "ne" ? s.y : s.y + s.h) + dy, 0, 1);

    // Direction the moving corner travelled away from the fixed anchor.
    const dirX = px >= anchorX ? 1 : -1;
    const dirY = py >= anchorY ? 1 : -1;

    let w = Math.abs(px - anchorX);
    let h = Math.abs(py - anchorY);

    if (normAspect != null) {
      // Drive height from width, then re-clamp so we never leave the frame.
      h = w / normAspect;
      const maxH = dirY > 0 ? 1 - anchorY : anchorY;
      if (h > maxH) {
        h = maxH;
        w = h * normAspect;
      }
      const maxW = dirX > 0 ? 1 - anchorX : anchorX;
      if (w > maxW) {
        w = maxW;
        h = w / normAspect;
      }
      // Enforce MIN_SIZE without breaking the locked ratio: scale both dims by
      // the same factor rather than clamping each independently.
      if (w < MIN_SIZE || h < MIN_SIZE) {
        const k = Math.max(MIN_SIZE / w, MIN_SIZE / h);
        w *= k;
        h *= k;
      }
    } else {
      w = Math.max(MIN_SIZE, w);
      h = Math.max(MIN_SIZE, h);
    }

    // Recompute the moving corner (and hence the top-left) from the clamped
    // dims so x/y stay consistent with the final w/h.
    px = anchorX + dirX * w;
    py = anchorY + dirY * h;
    const x = Math.min(anchorX, px);
    const y = Math.min(anchorY, py);

    onChange({
      x: clamp(x, 0, 1 - w),
      y: clamp(y, 0, 1 - h),
      w: Math.min(w, 1),
      h: Math.min(h, 1),
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (drag.current) {
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      drag.current = null;
    }
  };

  const pct = (v: number) => `${v * 100}%`;
  const handle =
    "absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-primary shadow ring-1 ring-black/30";

  return (
    <div
      ref={ref}
      className="absolute inset-0 touch-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* A big box-shadow spread darkens everything outside the crop window. */}
      <div
        className="pointer-events-none absolute bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
        style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
      />

      {/* The crop window: draggable body + rule-of-thirds guides. */}
      <div
        className="absolute cursor-move border border-white/80"
        style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
        onPointerDown={onPointerDown("move")}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/3 top-0 h-full w-px bg-white/25" />
          <div className="absolute left-2/3 top-0 h-full w-px bg-white/25" />
          <div className="absolute left-0 top-1/3 h-px w-full bg-white/25" />
          <div className="absolute left-0 top-2/3 h-px w-full bg-white/25" />
        </div>

        <div
          className={cn(handle, "-left-1.5 -top-1.5 cursor-nwse-resize")}
          onPointerDown={onPointerDown("nw")}
        />
        <div
          className={cn(handle, "-right-1.5 -top-1.5 cursor-nesw-resize")}
          onPointerDown={onPointerDown("ne")}
        />
        <div
          className={cn(handle, "-bottom-1.5 -left-1.5 cursor-nesw-resize")}
          onPointerDown={onPointerDown("sw")}
        />
        <div
          className={cn(handle, "-bottom-1.5 -right-1.5 cursor-nwse-resize")}
          onPointerDown={onPointerDown("se")}
        />
      </div>
    </div>
  );
}
