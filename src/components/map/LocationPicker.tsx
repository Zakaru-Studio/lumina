import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  BORDERS_PATH,
  GRATICULE_PATH,
  LAND_PATH,
  SPHERE_PATH,
  VB_H,
  VB_W,
  project,
  unproject,
} from "./geo";

/** Zoom bounds. `1` shows the whole world; higher zooms in. */
const MIN_K = 1;
const MAX_K = 96;

/** Uniform scale applied to the 24×24 lucide `MapPin` glyph (keeps its aspect
 * ratio). Its tip sits at glyph coords (12, 21.8), which we anchor on the point. */
const PIN_SCALE = 2.3;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Pan transform clamped so the map can't be dragged off-screen. */
function clampTranslate(tx: number, ty: number, k: number): [number, number] {
  return [clamp(tx, VB_W * (1 - k), 0), clamp(ty, VB_H * (1 - k), 0)];
}

/** Props for {@link LocationPicker}. */
export interface LocationPickerProps {
  /** Current marker coordinate, or null for "not placed yet". */
  lat: number | null;
  lon: number | null;
  /** Fired whenever the user clicks the map or drags the marker. */
  onChange: (lat: number, lon: number) => void;
  /** Height/size classes for the map container (defaults to `h-64`). */
  className?: string;
}

/**
 * A compact, fully-offline map for picking a coordinate. Reuses the same bundled
 * Natural Earth geometry and projection as the main map view. Click anywhere to
 * drop the pin, drag the pin to fine-tune, wheel/buttons to zoom. Emits the
 * unprojected `[lat, lon]` on every change; there is no network access.
 */
export function LocationPicker({ lat, lon, onChange, className }: LocationPickerProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [k, setK] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [panning, setPanning] = useState(false);

  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const applyView = useCallback((nk: number, ntx: number, nty: number) => {
    const [cx, cy] = clampTranslate(ntx, nty, nk);
    view.current = { k: nk, tx: cx, ty: cy };
    setK(nk);
    setTx(cx);
    setTy(cy);
  }, []);

  // Marker position in viewBox units (null when unplaced or unprojectable).
  const marker = lat != null && lon != null ? project(lon, lat) : null;

  /** Map a client pixel to the SVG viewBox coordinate system. Uses the on-screen
   * bounding rect and inverts `preserveAspectRatio="xMidYMid meet"` by hand — so,
   * unlike `getScreenCTM()`, it stays correct even when an ancestor applies a CSS
   * transform (the Radix dialog centers + scales its content). */
  const clientToVb = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scale = Math.min(rect.width / VB_W, rect.height / VB_H);
    const offsetX = (rect.width - VB_W * scale) / 2;
    const offsetY = (rect.height - VB_H * scale) / 2;
    return [(clientX - rect.left - offsetX) / scale, (clientY - rect.top - offsetY) / scale];
  }, []);

  const zoomAround = useCallback(
    (vx: number, vy: number, factor: number) => {
      const { k: ck, tx: ctx, ty: cty } = view.current;
      const nk = clamp(ck * factor, MIN_K, MAX_K);
      if (nk === ck) return;
      const wx = (vx - ctx) / ck;
      const wy = (vy - cty) / ck;
      applyView(nk, vx - wx * nk, vy - wy * nk);
    },
    [applyView],
  );

  // Center the view on the marker whenever it exists but hasn't been framed yet
  // (i.e. the picker just opened with a coordinate). Only runs on mount.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !marker) return;
    framed.current = true;
    const nk = 6;
    applyView(nk, VB_W / 2 - marker[0] * nk, VB_H / 2 - marker[1] * nk);
  }, [marker, applyView]);

  // Native, non-passive wheel handler so we can preventDefault the page scroll.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vb = clientToVb(e.clientX, e.clientY);
      if (!vb) return;
      zoomAround(vb[0], vb[1], Math.exp(-e.deltaY * 0.0015));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [clientToVb, zoomAround]);

  // --- Pointer handling: drag the marker, pan the map, or click to place. ---
  const drag = useRef<
    { mode: "marker" } | { mode: "pan"; startVb: [number, number]; tx0: number; ty0: number; moved: boolean } | null
  >(null);

  /** Emit the coordinate under a viewBox point. The map is drawn under a
   * `translate(tx,ty) scale(k)` transform, so a viewBox point must be mapped
   * back into the untransformed world space (`(vb - t) / k`) before unprojecting
   * — otherwise the pin lands far off at any zoom other than 1. */
  const emitAt = useCallback(
    (vb: [number, number]) => {
      const { k: ck, tx: ctx, ty: cty } = view.current;
      const ll = unproject((vb[0] - ctx) / ck, (vb[1] - cty) / ck);
      if (ll) onChange(ll[1], ll[0]); // [lat, lon]
    },
    [onChange],
  );

  const onMarkerPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = { mode: "marker" };
    setPanning(false);
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const vb = clientToVb(e.clientX, e.clientY);
    if (!vb) return;
    drag.current = { mode: "pan", startVb: vb, tx0: view.current.tx, ty0: view.current.ty, moved: false };
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const vb = clientToVb(e.clientX, e.clientY);
    if (!vb) return;
    if (d.mode === "marker") {
      emitAt(vb);
      return;
    }
    const dx = vb[0] - d.startVb[0];
    const dy = vb[1] - d.startVb[1];
    if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) d.moved = true;
    applyView(view.current.k, d.tx0 + dx, d.ty0 + dy);
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // A click on the map (no drag) drops/moves the pin there.
    if (d && d.mode === "pan" && !d.moved) emitAt(d.startVb);
  };

  const reset = () => applyView(1, 0, 0);
  const zoomButton = (factor: number) => zoomAround(VB_W / 2, VB_H / 2, factor);

  const mx = marker ? tx + marker[0] * k : 0;
  const my = marker ? ty + marker[1] * k : 0;

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-lg border bg-[hsl(var(--map-ocean))]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        className={cn("h-full w-full", panning ? "cursor-grabbing" : "cursor-crosshair")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "none" }}
      >
        <g transform={`translate(${tx} ${ty}) scale(${k})`}>
          <path d={SPHERE_PATH} className="fill-[hsl(var(--map-ocean))] stroke-[hsl(var(--map-graticule))]" strokeWidth={0.6 / k} />
          <path d={GRATICULE_PATH} fill="none" className="stroke-[hsl(var(--map-graticule))]" strokeWidth={0.5 / k} strokeOpacity={0.6} />
          <path d={LAND_PATH} className="fill-[hsl(var(--map-land))]" />
          <path d={BORDERS_PATH} fill="none" className="stroke-[hsl(var(--map-border))]" strokeWidth={0.4 / k} strokeOpacity={0.7} />
        </g>

        {/* Marker: the lucide MapPin glyph, in untransformed space so it keeps a
            constant on-screen size. Scaled uniformly (original aspect ratio) and
            offset so its tip lands exactly on the picked/clicked coordinate. */}
        {marker ? (
          <g
            transform={`translate(${mx} ${my}) scale(${PIN_SCALE}) translate(-12 -21.8)`}
            className="cursor-grab"
            onPointerDown={onMarkerPointerDown}
          >
            <path
              d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
              className="fill-[hsl(var(--primary))] stroke-[hsl(var(--primary-foreground))]"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            <circle cx={12} cy={10} r={3} className="fill-[hsl(var(--primary-foreground))]" />
          </g>
        ) : null}
      </svg>

      {/* Zoom controls. */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-lg bg-background/70 px-1 py-1 backdrop-blur">
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("mapView.zoomOut")} disabled={k <= MIN_K + 0.001} onClick={() => zoomButton(1 / 1.6)}>
          <Minus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("mapView.zoomIn")} disabled={k >= MAX_K - 0.001} onClick={() => zoomButton(1.6)}>
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("mapView.resetView")} disabled={k === 1 && tx === 0 && ty === 0} onClick={reset}>
          <Maximize className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
