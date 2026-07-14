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
import {
  geoArea,
  geoContains,
  geoGraticule10,
  geoNaturalEarth1,
  geoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { FeatureCollection } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

import worldData from "world-atlas/countries-110m.json";
import { CITIES } from "./places";

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

/**
 * Inverse of {@link project}: map a point in virtual-canvas units back to
 * `[lon, lat]`, or `null` if it falls outside the projected globe. Used by the
 * location picker to turn a click/drag on the map into coordinates.
 */
export function unproject(x: number, y: number): [number, number] | null {
  const inv = projection.invert?.([x, y]);
  if (!inv || !Number.isFinite(inv[0]) || !Number.isFinite(inv[1])) return null;
  // Clamp to valid ranges (the inverse can drift slightly past the poles/antimeridian).
  const lon = Math.max(-180, Math.min(180, inv[0]));
  const lat = Math.max(-90, Math.min(90, inv[1]));
  return [lon, lat];
}

/** A place label anchored in virtual-canvas units. */
export interface PlaceLabel {
  name: string;
  x: number;
  y: number;
}

/** A country/region label with its spherical area (used to rank importance). */
export interface RegionLabel extends PlaceLabel {
  /** Steradians (0..4π) — larger countries label at lower zoom. */
  area: number;
}

/** A city label with the minimum zoom factor at which it becomes eligible. */
export interface CityLabel extends PlaceLabel {
  minK: number;
}

// Country/region labels: the projected area-weighted centroid and true spherical
// area of every country, computed once from the same bundled shapes drawn above.
// Sorted biggest-first so the map can show the N most prominent for a given zoom.
const countryFC = feature(topology, countries) as unknown as FeatureCollection;
export const REGION_LABELS: RegionLabel[] = countryFC.features
  .map((f) => {
    const [x, y] = pathGen.centroid(f as unknown as GeoPermissibleObjects);
    return {
      name: (f.properties as { name?: string } | null)?.name ?? "",
      x,
      y,
      area: geoArea(f as unknown as GeoPermissibleObjects),
    };
  })
  .filter((l) => l.name !== "" && Number.isFinite(l.x) && Number.isFinite(l.y))
  .sort((a, b) => b.area - a.area);

// City labels: project each bundled city once (dropping any the projection can't
// place). Kept in the gazetteer's prominence order so higher-ranked cities win
// label slots when several compete for the same patch of screen.
export const CITY_LABELS: CityLabel[] = CITIES.map((c) => {
  const p = project(c.lon, c.lat);
  return p ? { name: c.name, x: p[0], y: p[1], minK: c.minK } : null;
}).filter((c): c is CityLabel => c !== null);

/** Great-circle distance between two `[lat, lon]` points, in kilometres. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The resolved place for a coordinate. Either field may be `null`. */
export interface PlaceName {
  /** Nearest bundled city, when the point is close enough to be named by it. */
  city: string | null;
  /** Country/region containing the point (Natural Earth 110m); null over sea. */
  country: string | null;
}

/**
 * Fully-offline reverse geocode for a `[lat, lon]`: the country whose bundled
 * shape contains the point, plus the nearest gazetteer city when it is close
 * enough to name the spot. No tiles, no network — it runs on click only, so the
 * O(countries + cities) scan is negligible.
 */
export function reverseGeocode(lat: number, lon: number): PlaceName {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { city: null, country: null };

  let country: string | null = null;
  for (const f of countryFC.features) {
    if (geoContains(f as unknown as GeoPermissibleObjects, [lon, lat])) {
      country = (f.properties as { name?: string } | null)?.name ?? null;
      break;
    }
  }

  let nearest: { name: string; km: number } | null = null;
  for (const c of CITIES) {
    const km = haversineKm(lat, lon, c.lat, c.lon);
    if (!nearest || km < nearest.km) nearest = { name: c.name, km };
  }

  // Name the city only when it's plausibly the place: tight when we already have
  // a country (so a rural spot isn't mislabelled as a distant metro), looser when
  // we don't (a coastal point the coarse borders miss still gets its nearest city).
  const maxKm = country ? 60 : 250;
  const city = nearest && nearest.km <= maxKm ? nearest.name : null;
  return { city, country };
}
