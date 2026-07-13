/**
 * Windowed photo browsing for very large libraries (hundreds of thousands of
 * items).
 *
 * The architecture separates two concerns:
 *  - `usePhotoIds(query)` returns the FULL ordered id list for a query. It is
 *    lightweight (ids only, no metadata/thumbnails) so the grid can size its
 *    scrollbar to the entire library, support range-selection and select-all,
 *    and map any index → id even before its details are loaded.
 *  - `usePhotoWindow(query)` fetches photo *details* in fixed-size pages, only
 *    for the currently visible index range (plus overscan). Call `setRange` as
 *    the viewport moves; read details via `getPhoto(index)` (undefined until a
 *    page loads — render a skeleton meanwhile).
 */
import { useCallback, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import * as api from "@/lib/api";
import type { Photo, PhotoQuery } from "@/types";

/** Page size for detail windows. Larger = fewer requests, more per request. */
export const WINDOW_PAGE = 300;

/** Stable key for a query ignoring pagination (offset/limit vary per page). */
function baseKey(query: PhotoQuery) {
  const { filter, sortBy, sortDir } = query;
  return ["photos", "windowed", { filter, sortBy, sortDir }] as const;
}

/** The full ordered id list for a query. */
export function usePhotoIds(query: PhotoQuery, enabled = true) {
  return useQuery({
    queryKey: [...baseKey(query), "ids"] as const,
    queryFn: () => api.listPhotoIds(query),
    enabled,
    // Ids change less often; keep them warm to avoid refetch churn on scroll.
    staleTime: 30_000,
  });
}

/** Inclusive item range → the set of page indices that cover it. */
function pagesForRange(start: number, end: number): number[] {
  const first = Math.max(0, Math.floor(start / WINDOW_PAGE));
  const last = Math.max(first, Math.floor(end / WINDOW_PAGE));
  const pages: number[] = [];
  for (let p = first; p <= last; p++) pages.push(p);
  return pages;
}

export interface PhotoWindow {
  /** Total matching photos (from the first loaded page; 0 until known). */
  total: number;
  /** Detail for a global index, or undefined if its page isn't loaded yet. */
  getPhoto: (index: number) => Photo | undefined;
  /** Report the visible index range so the needed pages get fetched. */
  setRange: (start: number, end: number) => void;
  /** True while the first window is still loading. */
  isLoading: boolean;
}

/** Fetch photo details for the visible window of a query. */
export function usePhotoWindow(query: PhotoQuery, enabled = true): PhotoWindow {
  const [range, setRange] = useState<{ start: number; end: number }>({
    start: 0,
    end: WINDOW_PAGE,
  });

  // Always include page 0 so `total` is known even before scrolling.
  const pages = useMemo(() => {
    const set = new Set<number>([0, ...pagesForRange(range.start, range.end)]);
    return [...set].sort((a, b) => a - b);
  }, [range.start, range.end]);

  const key = baseKey(query);
  const results = useQueries({
    queries: pages.map((p) => ({
      queryKey: [...key, "page", p] as const,
      queryFn: () => api.listPhotos({ ...query, offset: p * WINDOW_PAGE, limit: WINDOW_PAGE }),
      enabled,
      staleTime: 30_000,
      placeholderData: (prev: unknown) => prev,
    })),
  });

  // Index page items by page number and read the authoritative total.
  const { byPage, total, isLoading } = useMemo(() => {
    const map = new Map<number, Photo[]>();
    let tot = 0;
    let loadingFirst = true;
    results.forEach((r, i) => {
      const p = pages[i];
      if (r.data) {
        map.set(p, r.data.items);
        tot = r.data.total;
        if (p === 0) loadingFirst = false;
      }
    });
    return { byPage: map, total: tot, isLoading: loadingFirst };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, pages]);

  const getPhoto = useCallback(
    (index: number): Photo | undefined => {
      const p = Math.floor(index / WINDOW_PAGE);
      const items = byPage.get(p);
      return items ? items[index - p * WINDOW_PAGE] : undefined;
    },
    [byPage],
  );

  const setRangeStable = useCallback((start: number, end: number) => {
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  return { total, getPhoto, setRange: setRangeStable, isLoading };
}
