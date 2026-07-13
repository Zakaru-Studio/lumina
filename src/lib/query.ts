/** TanStack Query client and centralized query-key factory. */
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ApiError, PhotoFilter, PhotoQuery, SortBy, SortDir } from "@/types";

/** Extract a human message from a rejected Tauri command (an `ApiError`). */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiError).message);
  }
  return typeof error === "string" ? error : "Something went wrong";
}

export const queryClient = new QueryClient({
  // Surface every failed mutation (user action) as a toast so errors are never
  // swallowed silently.
  mutationCache: new MutationCache({
    onError: (error) => toast.error(errorMessage(error)),
  }),
  defaultOptions: {
    queries: {
      // Photos rarely change out from under us except via events (which we
      // invalidate explicitly), so keep data warm for snappy navigation.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Stable, hierarchical query keys for cache invalidation. */
export const qk = {
  photos: ["photos"] as const,
  photoList: (query: PhotoQuery) => ["photos", "list", query] as const,
  photo: (id: string) => ["photos", "detail", id] as const,
  timeline: (filter: PhotoFilter) => ["photos", "timeline", filter] as const,
  stats: ["stats"] as const,
  tags: ["tags"] as const,
  albums: ["albums"] as const,
  album: (id: string) => ["albums", id] as const,
  albumPhotos: (id: string, query: PhotoQuery) => ["albums", id, "photos", query] as const,
  watchedFolders: ["watchedFolders"] as const,
  config: ["config"] as const,
  aiStatus: ["aiStatus"] as const,
};

/** Build a default [`PhotoQuery`] with an optional filter/sort override. */
export function buildQuery(opts?: {
  filter?: PhotoFilter;
  sortBy?: SortBy;
  sortDir?: SortDir;
  offset?: number;
  limit?: number;
}): PhotoQuery {
  return {
    filter: opts?.filter ?? {},
    sortBy: opts?.sortBy ?? "takenAt",
    sortDir: opts?.sortDir ?? "desc",
    offset: opts?.offset ?? 0,
    limit: opts?.limit ?? 200,
  };
}
