/** Client-side spatial clustering of geolocated photos for the map. */
import type { MapPoint } from "@/types";

import { project } from "./geo";

/** A photo already projected into virtual-canvas units. */
export interface PlacedPoint {
  point: MapPoint;
  x: number;
  y: number;
}

/** A group of nearby photos rendered as a single marker. */
export interface Cluster {
  /**
   * Stable id: the representative (first, newest) member's photo id. Unlike the
   * transient grid-cell key, this survives a zoom change — when a cluster splits
   * apart on zoom-in, the subcluster that still contains the representative photo
   * keeps the same id — so a selection ring stays matched across zoom.
   */
  id: string;
  /** Centroid in virtual-canvas units. */
  x: number;
  y: number;
  /** Members, newest-first (input order is preserved). */
  points: MapPoint[];
}

/** Project every point with valid coordinates into canvas space, once. */
export function place(points: MapPoint[]): PlacedPoint[] {
  const out: PlacedPoint[] = [];
  for (const point of points) {
    const xy = project(point.gpsLon, point.gpsLat);
    if (xy) out.push({ point, x: xy[0], y: xy[1] });
  }
  return out;
}

/** Target marker spacing in virtual-canvas units before the zoom factor. */
const CELL_BASE = 22;

/**
 * Grid-cluster placed points at the given zoom `k`. Cells shrink as you zoom in
 * (`CELL_BASE / k`), so clusters naturally break apart. Clustering depends only
 * on `k` and the points — never on the pan offset — so panning is free and only
 * a zoom change recomputes groups.
 */
export function clusterize(placed: PlacedPoint[], k: number): Cluster[] {
  const cell = CELL_BASE / k;
  const buckets = new Map<string, PlacedPoint[]>();
  for (const p of placed) {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    const key = `${cx}:${cy}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(p);
    else buckets.set(key, [p]);
  }

  const clusters: Cluster[] = [];
  for (const members of buckets.values()) {
    let sx = 0;
    let sy = 0;
    for (const m of members) {
      sx += m.x;
      sy += m.y;
    }
    clusters.push({
      id: members[0].point.id,
      x: sx / members.length,
      y: sy / members.length,
      points: members.map((m) => m.point),
    });
  }
  return clusters;
}
