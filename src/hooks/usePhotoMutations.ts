/**
 * Non-destructive photo mutations (rating, favorite, catalog removal).
 * All invalidate the photo/stats caches so the UI reflects changes instantly,
 * surface success via toasts, and offer Undo on removal.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { qk } from "@/lib/query";
import { DEDUPE_EXIT_MS, useDedupeExitStore } from "@/stores/dedupeExitStore";
import type { Photo } from "@/types";

function usePhotoInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.photos });
    qc.invalidateQueries({ queryKey: qk.stats });
    qc.invalidateQueries({ queryKey: qk.albums });
  };
}

/**
 * Patch cached {@link Photo} objects in place across the shapes react-query
 * holds them in — paginated lists (`{ items }`), infinite-query pages
 * (`{ pages: [{ items }] }`) and single details (`{ id }`) — leaving any other
 * shape (notably the plain `string[]` id lists) untouched.
 */
function patchCachedPhotos(old: unknown, apply: (p: Photo) => Photo): unknown {
  if (!old || typeof old !== "object") return old;
  const o = old as Record<string, unknown>;
  if (Array.isArray(o.items)) return { ...o, items: (o.items as Photo[]).map(apply) };
  if (Array.isArray(o.pages)) {
    return {
      ...o,
      pages: (o.pages as unknown[]).map((pg) => {
        const p = pg as Record<string, unknown> | null;
        return p && Array.isArray(p.items) ? { ...p, items: (p.items as Photo[]).map(apply) } : pg;
      }),
    };
  }
  if (typeof o.id === "string") return apply(old as Photo);
  return old;
}

/**
 * Optimistically patch a single field of the given photos across every cached
 * list/detail, instead of invalidating. The old `usePhotoInvalidation` refetched
 * the *entire* ordered id list (up to tens of thousands of ids over IPC) plus
 * every loaded window page on **each** rating/favorite change — pressing `1`–`5`
 * or `F` did this per keystroke. Here the visible grid updates instantly and the
 * id lists are only marked stale (`refetchType: "none"`), so a view filtered or
 * sorted by the changed field reconciles on its next mount/navigation rather than
 * churning live.
 */
function usePhotoFieldPatch() {
  const qc = useQueryClient();
  return (ids: string[], patch: (p: Photo) => Photo) => {
    const set = new Set(ids);
    const apply = (p: Photo) => (set.has(p.id) ? patch(p) : p);
    qc.setQueriesData({ queryKey: qk.photos }, (old) => patchCachedPhotos(old, apply));
    qc.setQueriesData({ queryKey: qk.albums }, (old) => patchCachedPhotos(old, apply));
    qc.invalidateQueries({ queryKey: qk.stats });
    // Mark ordered lists stale without a live refetch (they rarely reorder on a
    // rating/favorite change; a filtered/sorted view refreshes on next mount).
    qc.invalidateQueries({ queryKey: qk.photos, refetchType: "none" });
    qc.invalidateQueries({ queryKey: qk.albums, refetchType: "none" });
  };
}

/**
 * Cache update for deletions. Removes the deleted ids from album-photo lists
 * *in place* rather than refetching them, so a smart album that re-filters
 * server-side — notably Duplicates (`HAVING COUNT(*) > 1`) — doesn't hide a
 * surviving photo whose only duplicate was just removed. Plain lists
 * (library/search/timeline) refetch normally; only the albums *list* (for
 * counts) is invalidated, never the album *photos* we just patched.
 */
function useDeleteInvalidation() {
  const qc = useQueryClient();
  return (ids: string[]) => {
    const removed = new Set(ids);
    qc.setQueriesData(
      {
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "albums" &&
          q.queryKey[2] === "photos",
      },
      (old: unknown) => {
        const data = old as { pages?: { items: { id: string }[] }[] } | undefined;
        if (!data?.pages) return old;
        return {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.filter((it) => !removed.has(it.id)),
          })),
        };
      },
    );
    qc.invalidateQueries({ queryKey: qk.photos });
    qc.invalidateQueries({ queryKey: qk.stats });
    qc.invalidateQueries({ queryKey: qk.albums, exact: true });
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function useSetRating() {
  const patch = usePhotoFieldPatch();
  return useMutation({
    mutationFn: ({ ids, rating }: { ids: string[]; rating: number }) =>
      api.setRating(ids, rating),
    onSuccess: (_result, { ids, rating }) => patch(ids, (p) => ({ ...p, rating })),
  });
}

export function useSetFavorite() {
  const patch = usePhotoFieldPatch();
  return useMutation({
    mutationFn: ({ ids, favorite }: { ids: string[]; favorite: boolean }) =>
      api.setFavorite(ids, favorite),
    onSuccess: (_result, { ids, favorite }) => patch(ids, (p) => ({ ...p, isFavorite: favorite })),
  });
}

/**
 * Set the capture date/time (Unix seconds, local) for photos — baked into each
 * file's EXIF. Invalidates the affected photo details plus the shared lists, and
 * surfaces a summary toast (updated / skipped for RAW·video / failed).
 */
export function useSetCaptureDate() {
  const invalidate = usePhotoInvalidation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, timestamp }: { ids: string[]; timestamp: number }) =>
      api.setCaptureDate(ids, timestamp),
    onSuccess: (summary, { ids }) => {
      invalidate();
      ids.forEach((id) => qc.invalidateQueries({ queryKey: qk.photo(id) }));
      const parts: string[] = [];
      if (summary.updated) parts.push(`Updated ${plural(summary.updated, "date")}`);
      if (summary.exifWritten) parts.push(`${summary.exifWritten} written to file`);
      if (summary.failed) parts.push(`${summary.failed} failed`);
      const msg = parts.join(" · ") || "No changes";
      if (summary.failed && !summary.updated) toast.error(msg);
      else toast.success(msg);
    },
  });
}

/**
 * Set (or clear, with `null`) the GPS coordinates of photos from the location
 * editor. Refreshes the affected photo details, the shared lists and the map so
 * the pin moves immediately.
 */
export function useSetLocation() {
  const invalidate = usePhotoInvalidation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, lat, lon }: { ids: string[]; lat: number | null; lon: number | null }) =>
      api.setLocation(ids, lat, lon),
    onSuccess: (_result, { ids }) => {
      invalidate();
      ids.forEach((id) => qc.invalidateQueries({ queryKey: qk.photo(id) }));
      qc.invalidateQueries({ queryKey: qk.map });
      toast.success("Location updated");
    },
    onError: (err) =>
      toast.error("Could not update location", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });
}

/** Restore soft-deleted photos (used by the remove Undo action). */
export function useRestorePhotos() {
  const invalidate = usePhotoInvalidation();
  return useMutation({
    mutationFn: (ids: string[]) => api.restorePhotos(ids),
    onSuccess: invalidate,
  });
}

export function useRemovePhotos() {
  const { t } = useTranslation();
  const invalidate = useDeleteInvalidation();
  const invalidateAll = usePhotoInvalidation();
  return useMutation({
    mutationFn: (ids: string[]) => api.removePhotos(ids),
    onSuccess: (_removed, ids) => {
      invalidate(ids);
      toast.success(t("gallery.deleteToast.removedFromCatalog", { count: ids.length }), {
        description: t("gallery.deleteToast.originalsUntouched"),
        action: {
          label: t("common.undo"),
          onClick: () => {
            api
              .restorePhotos(ids)
              .then(() => {
                // Full refetch so restored photos rejoin every list, including
                // the album photos we patched out on removal.
                invalidateAll();
                toast.success(t("common.restored"));
              })
              .catch(() => toast.error(t("common.restoreError")));
          },
        },
      });
    },
  });
}

/**
 * Delete photos from disk AND catalog by sending the originals to the OS trash.
 * The catalog rows are dropped (no in-app Undo, unlike {@link useRemovePhotos}),
 * but the files stay recoverable from the system trash / Recycle Bin.
 */
export function useDeletePhotosFromDisk() {
  const { t } = useTranslation();
  const invalidate = useDeleteInvalidation();
  return useMutation({
    mutationFn: (ids: string[]) => api.deletePhotosFromDisk(ids),
    onSuccess: (_deleted, ids) => {
      invalidate(ids);
      toast.success(t("gallery.deleteToast.deletedFromDisk", { count: ids.length }), {
        description: t("gallery.deleteToast.movedToTrash"),
      });
    },
    onError: (err) =>
      toast.error(t("gallery.deleteToast.deleteError"), {
        description: err instanceof Error ? err.message : String(err),
      }),
  });
}

export type DedupeMode = "catalog" | "trash";

/**
 * Remove the redundant copies chosen by a smart-dedupe plan. Unlike the plain
 * removal hooks this keeps the rows in the grid, flags them as "exiting" so
 * {@link PhotoCell} can pulse-then-fade them out, and only drops them from the
 * cache once that animation has played ({@link DEDUPE_EXIT_MS}).
 *
 * `mode` chooses how the copies go away: `catalog` (undoable soft-remove) or
 * `trash` (files sent to the OS trash).
 */
export function useDedupeRemove() {
  const { t } = useTranslation();
  const patchOut = useDeleteInvalidation();
  const invalidateAll = usePhotoInvalidation();
  const startExit = useDedupeExitStore((s) => s.start);
  const clearExit = useDedupeExitStore((s) => s.clear);
  return useMutation({
    mutationFn: ({ ids, mode }: { ids: string[]; mode: DedupeMode }) =>
      mode === "catalog" ? api.removePhotos(ids) : api.deletePhotosFromDisk(ids),
    onSuccess: (_removed, { ids, mode }) => {
      // Animate the removed copies out, then drop them from the cache.
      startExit(ids);
      const timer = window.setTimeout(() => {
        patchOut(ids);
        clearExit();
      }, DEDUPE_EXIT_MS);

      const removed = t("dedupe.deduplicated", { count: ids.length });
      if (mode === "catalog") {
        toast.success(removed, {
          description: t("dedupe.removedFromCatalog"),
          action: {
            label: t("common.undo"),
            onClick: () => {
              // Cancel the pending drop and restore before the rows leave.
              window.clearTimeout(timer);
              clearExit();
              api
                .restorePhotos(ids)
                .then(() => {
                  invalidateAll();
                  toast.success(t("common.restored"));
                })
                .catch(() => toast.error(t("common.restoreError")));
            },
          },
        });
      } else {
        toast.success(removed, {
          description: t("dedupe.movedToTrash"),
        });
      }
    },
    onError: (err) =>
      toast.error(t("dedupe.error"), {
        description: err instanceof Error ? err.message : String(err),
      }),
  });
}
