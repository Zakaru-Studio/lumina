/** Data hooks for the map view: geolocated points and on-demand detail. */
import { useQueries, useQuery } from "@tanstack/react-query";

import * as api from "@/lib/api";
import { qk } from "@/lib/query";
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
export function useClusterPhotos(ids: string[]): Photo[] {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["photos", "detail", id] as const,
      queryFn: () => api.getPhoto(id),
      staleTime: 60_000,
    })),
  });
  const byId = new Map<string, Photo>();
  for (const r of results) {
    if (r.data) byId.set(r.data.id, r.data);
  }
  return ids.map((id) => byId.get(id)).filter((p): p is Photo => Boolean(p));
}
