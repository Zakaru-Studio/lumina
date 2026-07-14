/**
 * Offline world geometry for the map view.
 *
 * Everything here is computed **once** at module load from a bundled Natural
 * Earth dataset (`world-atlas`, ~110 kB TopoJSON) — there are no map tiles and
 * no network access, so photo coordinates never leave the machine. We project
 * with d3-geo's Natural Earth projection into a fixed virtual canvas
 * ({@link VB_W} × {@link VB_H} viewBox units); the component then applies its own
 * pan/zoom transform on top. Photo points are projected with the same
 * projection via {@link project}, so they line up with the drawn continents.
 */
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

import worldData from "world-atlas/countries-110m.json";

/** Fixed virtual canvas width (viewBox units). Height is derived from the fit. */
export const VB_W = 1000;

const topology = worldData as unknown as Topology;
const sphere = { type: "Sphere" } as const;

// Fit the projection to our virtual width; the height falls out of the bounds.
const projection = geoNaturalEarth1().fitWidth(VB_W, sphere);
const pathGen = geoPath(projection);

/** Fitted virtual canvas height (viewBox units). */
export const VB_H = Math.ceil(pathGen.bounds(sphere)[1][1]);

/** Outline of the globe (the rounded Natural-Earth frame). */
export const SPHERE_PATH = pathGen(sphere) ?? "";

/** Subtle latitude/longitude graticule. */
export const GRATICULE_PATH = pathGen(geoGraticule10()) ?? "";

const countries = topology.objects.countries as GeometryCollection;

/** Filled landmass (all countries merged into one path). */
export const LAND_PATH = pathGen(feature(topology, countries)) ?? "";

/** Interior country borders only (hairlines between neighbours). */
export const BORDERS_PATH = pathGen(mesh(topology, countries, (a, b) => a !== b)) ?? "";

/**
 * Project a `[lon, lat]` coordinate into virtual-canvas units, or `null` if the
 * projection cannot place it (e.g. clipped). Uses the exact projection that drew
 * the continents, so markers register precisely.
 */
export function project(lon: number, lat: number): [number, number] | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const p = projection([lon, lat]);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  return [p[0], p[1]];
}
