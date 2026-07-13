/** Data hooks for browsing photos (infinite listing, detail, timeline, stats). */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import * as api from "@/lib/api";
import { qk } from "@/lib/query";
import type { Photo, PhotoFilter, PhotoQuery } from "@/types";

/** Key that ignores `offset` so pages share one infinite-query cache entry. */
function listKey(query: PhotoQuery) {
  const { filter, sortBy, sortDir, limit } = query;
  return ["photos", "list", { filter, sortBy, sortDir, limit }] as const;
}

/**
 * Paginated photo listing backed by `useInfiniteQuery`. The grid requests more
 * pages as the user scrolls; each page is a `Page<Photo>` window.
 */
export function usePhotoList(query: PhotoQuery) {
  return useInfiniteQuery({
    queryKey: listKey(query),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.listPhotos({ ...query, offset: pageParam }),
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return next < last.total ? next : undefined;
    },
  });
}

/** Flatten infinite-query pages into a single ordered photo array. */
export function flattenPhotos(pages: { items: Photo[] }[] | undefined): Photo[] {
  return pages ? pages.flatMap((p) => p.items) : [];
}

/** Single photo detail (includes tags). */
export function usePhoto(id: string | null) {
  return useQuery({
    queryKey: qk.photo(id ?? ""),
    queryFn: () => api.getPhoto(id as string),
    enabled: !!id,
  });
}

/** Per-day timeline sections for a filter. */
export function usePhotoTimeline(filter: PhotoFilter) {
  return useQuery({
    queryKey: qk.timeline(filter),
    queryFn: () => api.photoTimeline(filter),
  });
}

/** Aggregate library statistics. */
export function useLibraryStats() {
  return useQuery({ queryKey: qk.stats, queryFn: api.libraryStats });
}
