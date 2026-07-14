import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { mapPointSrc } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { MapPoint } from "@/types";

import {
  BORDERS_PATH,
  CITY_LABELS,
  GRATICULE_PATH,
  LAND_PATH,
  REGION_LABELS,
  SPHERE_PATH,
  VB_H,
  VB_W,
} from "./geo";
import { clusterize, place, type Cluster } from "./cluster";

/** Zoom bounds. `1` shows the whole world; higher zooms in. */
const MIN_K = 1;
const MAX_K = 64;

/** Props for {@link MapView}. */
export interface MapViewProps {
  points: MapPoint[];
  /** Id of the currently selected cluster (for highlight), or null. */
  selectedId: string | null;
  /** Fired when a cluster is clicked (null when clicking empty ocean). */
  onSelect: (cluster: Cluster | null) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** The pan transform, clamped so the map can never be dragged off-screen. */
function clampTranslate(tx: number, ty: number, k: number): [number, number] {
  return [clamp(tx, VB_W * (1 - k), 0), clamp(ty, VB_H * (1 - k), 0)];
}

/** Marker radius (viewBox units) grows gently with member count. */
function radiusFor(count: number): number {
  if (count <= 1) return 4.5;
  return clamp(6 + Math.log2(count) * 2.4, 8, 24);
}

/**
 * A fully-offline, stylized world map. Continents are drawn from bundled Natural
 * Earth vectors (no tiles, no network); geotagged photos are projected, grid-
 * clustered on the client, and plotted as glowing markers. Supports wheel zoom
 * toward the cursor, drag-to-pan and click-to-inspect. Colors are driven by the
 * app's theme tokens, so it adapts to light/dark automatically.
 */
export function MapView({ points, selectedId, onSelect }: MapViewProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [k, setK] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [hovered, setHovered] = useState<Cluster | null>(null);

  // Latest transform in refs so native (non-passive) wheel/pan handlers read
  // fresh values without re-binding.
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const applyView = useCallback((nk: number, ntx: number, nty: number) => {
    const [ctx, cty] = clampTranslate(ntx, nty, nk);
    view.current = { k: nk, tx: ctx, ty: cty };
    setK(nk);
    setTx(ctx);
    setTy(cty);
  }, []);

  // Project once; re-cluster only when the point set or the *discrete* zoom
  // level changes (panning leaves clusters untouched). Quantizing the continuous
  // `k` to a log-scale bucket keeps a fractional wheel tick from re-clustering
  // the whole point set on every frame; the visual transform still uses `k`.
  const placed = useMemo(() => place(points), [points]);
  const zoomLevel = Math.round(Math.log2(k) * 4);
  const clusters = useMemo(() => clusterize(placed, 2 ** (zoomLevel / 4)), [placed, zoomLevel]);

  // Background place-name labels (countries + major cities), recomputed on
  // pan/zoom. Cheap by construction: it walks two small pre-projected lists,
  // culls to the viewport, thins overlaps on a coarse grid, and caps how many
  // render — no tiles, no geocoding, no per-frame projection.
  const labels = useMemo(() => {
    type L = { key: string; name: string; cx: number; cy: number; kind: "region" | "city" };
    const out: L[] = [];
    const occupied = new Set<string>();
    const CELL = 44; // viewBox-unit grid: at most one label per cell
    const cellKey = (cx: number, cy: number) => `${Math.round(cx / CELL)}:${Math.round(cy / CELL)}`;
    const inView = (cx: number, cy: number) =>
      cx > -12 && cy > -8 && cx < VB_W + 12 && cy < VB_H + 8;

    // Countries: biggest-first (REGION_LABELS is pre-sorted by area); the number
    // shown grows with zoom.
    const regionBudget = Math.round(clamp(12 + Math.log2(k) * 4, 12, 40));
    let regions = 0;
    for (const r of REGION_LABELS) {
      if (regions >= regionBudget) break;
      const cx = tx + r.x * k;
      const cy = ty + r.y * k;
      if (!inView(cx, cy)) continue;
      const cell = cellKey(cx, cy);
      if (occupied.has(cell)) continue;
      occupied.add(cell);
      out.push({ key: `r:${r.name}`, name: r.name.toUpperCase(), cx, cy, kind: "region" });
      regions++;
    }

    // Cities: hidden at the world view, filling in as you zoom past their tier.
    if (k >= 2) {
      const cityBudget = Math.round(clamp(Math.log2(k) * 9, 8, 60));
      let cities = 0;
      for (const c of CITY_LABELS) {
        if (cities >= cityBudget) break;
        if (k < c.minK) continue;
        const cx = tx + c.x * k;
        const cy = ty + c.y * k;
        if (!inView(cx, cy)) continue;
        const cell = cellKey(cx, cy);
        if (occupied.has(cell)) continue;
        occupied.add(cell);
        out.push({ key: `c:${c.name}`, name: c.name, cx, cy, kind: "city" });
        cities++;
      }
    }
    return out;
  }, [k, tx, ty]);

  /** Map a client pixel to a point in the SVG's viewBox coordinate system. */
  const clientToVb = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }, []);

  /** Zoom by `factor`, keeping the viewBox point `(vx, vy)` under the cursor. */
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

  // Native, non-passive wheel handler so we can preventDefault page scroll.
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

  // --- Drag-to-pan ---
  const drag = useRef<{ startVb: [number, number]; tx0: number; ty0: number; moved: boolean } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const vb = clientToVb(e.clientX, e.clientY);
    if (!vb) return;
    drag.current = { startVb: vb, tx0: view.current.tx, ty0: view.current.ty, moved: false };
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const vb = clientToVb(e.clientX, e.clientY);
    if (!vb) return;
    const dx = vb[0] - d.startVb[0];
    const dy = vb[1] - d.startVb[1];
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.moved = true;
    applyView(view.current.k, d.tx0 + dx, d.ty0 + dy);
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // A click on empty ocean (no drag) clears the selection.
    if (d && !d.moved) onSelect(null);
  };

  /** Reset to the whole-world view. */
  const reset = () => applyView(1, 0, 0);

  /** Zoom via the on-screen buttons, holding the map center fixed. */
  const zoomButton = (factor: number) => zoomAround(VB_W / 2, VB_H / 2, factor);

  const onMarkerClick = (cluster: Cluster, e: React.MouseEvent) => {
    e.stopPropagation();
    if (cluster.points.length > 1 && view.current.k < MAX_K) {
      // Multi-photo cluster: zoom toward it to break it apart, and select it.
      zoomAround(cluster.x * view.current.k + view.current.tx, cluster.y * view.current.k + view.current.ty, 2.2);
    }
    onSelect(cluster);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[hsl(var(--map-ocean))]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        className={cn("h-full w-full", panning ? "cursor-grabbing" : "cursor-grab")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "none" }}
      >
        <defs>
          {/* Soft glow used behind markers. */}
          <filter id="marker-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {/* World, under the pan/zoom transform. */}
        <g transform={`translate(${tx} ${ty}) scale(${k})`}>
          {/* Ocean disc / globe frame. */}
          <path d={SPHERE_PATH} className="fill-[hsl(var(--map-ocean))] stroke-[hsl(var(--map-graticule))]" strokeWidth={0.6 / k} />
          {/* Graticule. */}
          <path
            d={GRATICULE_PATH}
            fill="none"
            className="stroke-[hsl(var(--map-graticule))]"
            strokeWidth={0.5 / k}
            strokeOpacity={0.6}
          />
          {/* Landmass. */}
          <path d={LAND_PATH} className="fill-[hsl(var(--map-land))]" />
          {/* Country hairlines. */}
          <path
            d={BORDERS_PATH}
            fill="none"
            className="stroke-[hsl(var(--map-border))]"
            strokeWidth={0.4 / k}
            strokeOpacity={0.7}
          />
        </g>

        {/* Place-name labels: subtle cartographic context. Drawn in untransformed
            viewBox space (constant on-screen size) and behind the photo markers.
            A background-coloured text halo keeps them legible over any land. */}
        <g className="pointer-events-none select-none">
          {labels.map((l) =>
            l.kind === "region" ? (
              <text
                key={l.key}
                x={l.cx}
                y={l.cy}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-[hsl(var(--map-label))]"
                opacity={0.8}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  paintOrder: "stroke",
                  stroke: "hsl(var(--map-ocean))",
                  strokeWidth: 2.4,
                  strokeLinejoin: "round",
                }}
              >
                {l.name}
              </text>
            ) : (
              <g key={l.key} opacity={0.9}>
                <circle cx={l.cx} cy={l.cy} r={1.3} className="fill-[hsl(var(--map-label))]" />
                <text
                  x={l.cx + 3.5}
                  y={l.cy}
                  textAnchor="start"
                  dominantBaseline="central"
                  className="fill-[hsl(var(--map-label))]"
                  style={{
                    fontSize: 8.5,
                    fontWeight: 500,
                    paintOrder: "stroke",
                    stroke: "hsl(var(--map-ocean))",
                    strokeWidth: 1.8,
                    strokeLinejoin: "round",
                  }}
                >
                  {l.name}
                </text>
              </g>
            ),
          )}
        </g>

        {/* Markers, drawn in untransformed viewBox space so they keep a constant
            on-screen size regardless of zoom. */}
        <g>
          {clusters.map((c) => {
            const cx = tx + c.x * k;
            const cy = ty + c.y * k;
            if (cx < -30 || cy < -30 || cx > VB_W + 30 || cy > VB_H + 30) return null;
            const count = c.points.length;
            const r = radiusFor(count);
            const selected = c.id === selectedId;
            return (
              <g
                key={c.id}
                transform={`translate(${cx} ${cy})`}
                className="cursor-pointer"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => onMarkerClick(c, e)}
                onMouseEnter={() => setHovered(c)}
                onMouseLeave={() => setHovered((h) => (h?.id === c.id ? null : h))}
              >
                {/* Glow halo. */}
                <circle r={r + 3} className="fill-[hsl(var(--primary))]" opacity={0.28} filter="url(#marker-glow)" />
                {/* Selection ring. */}
                {selected ? (
                  <circle r={r + 4} fill="none" className="stroke-[hsl(var(--primary))]" strokeWidth={1.5} />
                ) : null}
                {/* Body. */}
                <circle
                  r={r}
                  className="fill-[hsl(var(--primary))] stroke-[hsl(var(--primary-foreground))]"
                  strokeWidth={count > 1 ? 1 : 0.8}
                  fillOpacity={0.92}
                />
                {count > 1 ? (
                  <text
                    textAnchor="middle"
                    dy="0.35em"
                    className="pointer-events-none fill-[hsl(var(--primary-foreground))] font-semibold"
                    style={{ fontSize: count >= 100 ? 8 : 9 }}
                  >
                    {count > 999 ? "999+" : count}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hover thumbnail preview. */}
      {hovered ? <HoverPreview cluster={hovered} k={k} tx={tx} ty={ty} svg={svgRef.current} /> : null}

      {/* Zoom controls. */}
      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-xl bg-background/70 px-1 py-1 backdrop-blur">
        <Button variant="ghost" size="icon" aria-label={t("mapView.zoomOut")} disabled={k <= MIN_K + 0.001} onClick={() => zoomButton(1 / 1.6)}>
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-10 text-center text-xs tabular-nums text-foreground">{Math.round(k)}×</span>
        <Button variant="ghost" size="icon" aria-label={t("mapView.zoomIn")} disabled={k >= MAX_K - 0.001} onClick={() => zoomButton(1.6)}>
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t("mapView.resetView")} disabled={k === 1 && tx === 0 && ty === 0} onClick={reset}>
          <Maximize className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * A small thumbnail card that follows the hovered marker. Positioned in CSS
 * pixels by mapping the marker's viewBox point back through the live screen CTM,
 * so it tracks precisely across pan/zoom and letterboxing.
 */
function HoverPreview({
  cluster,
  k,
  tx,
  ty,
  svg,
}: {
  cluster: Cluster;
  k: number;
  tx: number;
  ty: number;
  svg: SVGSVGElement | null;
}) {
  const { t } = useTranslation();
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  const host = svg.parentElement?.getBoundingClientRect();
  if (!ctm || !host) return null;

  const pt = svg.createSVGPoint();
  pt.x = tx + cluster.x * k;
  pt.y = ty + cluster.y * k;
  const screen = pt.matrixTransform(ctm);
  const left = screen.x - host.left;
  const top = screen.y - host.top;

  const rep = cluster.points[0];
  const src = mapPointSrc(rep);
  const count = cluster.points.length;

  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full pb-3"
      style={{ left, top }}
    >
      <div className="flex flex-col items-center gap-1 rounded-xl bg-popover/95 p-1.5 shadow-lg ring-1 ring-border backdrop-blur">
        <div className="h-24 w-24 overflow-hidden rounded-lg bg-muted">
          {src ? (
            <img src={src} alt={rep.filename} className="h-full w-full object-cover" draggable={false} />
          ) : null}
        </div>
        <span className="max-w-[9rem] truncate px-1 text-[11px] text-muted-foreground">
          {count > 1 ? t("mapView.photosHere", { n: count }) : rep.filename}
        </span>
      </div>
    </div>
  );
}
