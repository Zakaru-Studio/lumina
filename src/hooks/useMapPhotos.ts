/** Data hooks for the map view: geolocated points and on-demand detail. */
import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api";
import { qk } from "@/lib/query";
import { useUiStore } from "@/stores/uiStore";
import type { Photo } from "@/types";

/**
 * All geolocated photos in the catalog as lightweight {@link MapPoint}s. This is
 * a single, cached call — the map clusters and projects them entirely on the
 * client, so panning and zooming never touch the backend.
 */
export function useMapPhotos() {
  return useQuery({
    queryKey: qk.map,
    queryFn: api.photosWithGps,
  });
}

/**
 * Resolve full {@link Photo} detail for a set of ids (a selected cluster), so
 * the shared Lightbox can render originals and metadata. Fetches lazily and in
 * parallel; only runs while `ids` is non-empty. Missing/rejected ids are simply
 * dropped, preserving the input order for the ones that resolve.
 */
/**
 * Online reverse-geocode for a coordinate — the fallback used when the offline
 * gazetteer can't name a point. Disabled while `lat`/`lon` are null (so it only
 * fires when actually needed), and cached indefinitely per rounded coordinate
 * since a place name never changes. Failures resolve to `null`, never a toast.
 */
export function useReverseGeocode(lat: number | null, lon: number | null) {
  const lang = useUiStore((s) => s.language);
  const rLat = lat != null ? Math.round(lat * 1000) / 1000 : null;
  const rLon = lon != null ? Math.round(lon * 1000) / 1000 : null;
  return useQuery({
    queryKey: ["reverseGeocode", rLat, rLon, lang] as const,
    queryFn: () => api.reverseGeocode(rLat as number, rLon as number, lang),
    enabled: rLat != null && rLon != null,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 0,
  });
}

/**
 * Forward-geocode a typed place (city / region / country) to a coordinate, as an
 * imperative mutation the location editor triggers on demand. Localizes results
 * to the current UI language.
 */
export function useGeocodeSearch() {
  const lang = useUiStore((s) => s.language);
  return useMutation({
    mutationFn: (query: string) => api.geocodeSearch(query, lang),
  });
}

/**
 * Search-as-you-type address lookup for the location editor. Fires only for
 * terms of 3+ characters (the caller debounces the term), keeps the previous
 * results visible while refetching, and caches per term + language.
 */
export function useAddressSearch(term: string) {
  const lang = useUiStore((s) => s.language);
  const q = term.trim();
  return useQuery({
    queryKey: ["geocodeSearchAll", q, lang] as const,
    queryFn: () => api.geocodeSearchAll(q, lang),
    enabled: q.length >= 3,
    staleTime: 5 * 60_000,
    retry: 0,
    placeholderData: (prev) => prev,
  });
}

/**
 * Read the stored place for a coordinate from the local cache (no online call),
 * for the Lightbox row and to pre-fill the location editor. Disabled when the
 * coordinate is null. Keyed by rounded coordinate + language.
 */
export function usePlace(lat: number | null, lon: number | null) {
  const lang = useUiStore((s) => s.language);
  const rLat = lat != null ? Math.round(lat * 1000) / 1000 : null;
  const rLon = lon != null ? Math.round(lon * 1000) / 1000 : null;
  return useQuery({
    queryKey: ["place", rLat, rLon, lang] as const,
    queryFn: () => api.getPlace(rLat as number, rLon as number, lang),
    enabled: rLat != null && rLon != null,
    staleTime: 60_000,
    retry: 0,
  });
}

/**
 * Persist a user-entered place (city / region / country) for a coordinate,
 * overriding the geocoded name. Invalidates the cached place + reverse-geocode
 * lookups so the map and Lightbox pick it up.
 */
export function useSetPlace() {
  const lang = useUiStore((s) => s.language);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: {
      lat: number;
      lon: number;
      city: string | null;
      region: string | null;
      country: string | null;
    }) => api.setPlace(p.lat, p.lon, lang, p.city, p.region, p.country),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["place"] });
      qc.invalidateQueries({ queryKey: ["reverseGeocode"] });
    },
  });
}

export function useClusterPhotos(ids: string[]): Photo[] {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["photos", "detail", id] as const,
      queryFn: () => api.getPhoto(id),
      staleTime: 60_000,
    })),
  });
  // Memoised so an unchanged cluster returns the SAME array reference across
  // renders — otherwise the derived `photoIds` and the Lightbox props would be
  // new every render. React Query structural-shares `results`, so this only
  // recomputes when a detail actually resolves/changes.
  return useMemo(() => {
    const byId = new Map<string, Photo>();
    for (const r of results) {
      if (r.data) byId.set(r.data.id, r.data);
    }
    return ids.map((id) => byId.get(id)).filter((p): p is Photo => Boolean(p));
  }, [results, ids]);
}
