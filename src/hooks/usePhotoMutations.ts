/**
 * Non-destructive photo mutations (rating, favorite, catalog removal).
 * All invalidate the photo/stats caches so the UI reflects changes instantly,
 * surface success via toasts, and offer Undo on removal.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { qk } from "@/lib/query";

function usePhotoInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.photos });
    qc.invalidateQueries({ queryKey: qk.stats });
    qc.invalidateQueries({ queryKey: qk.albums });
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
  const invalidate = usePhotoInvalidation();
  return useMutation({
    mutationFn: ({ ids, rating }: { ids: string[]; rating: number }) =>
      api.setRating(ids, rating),
    onSuccess: invalidate,
  });
}

export function useSetFavorite() {
  const invalidate = usePhotoInvalidation();
  return useMutation({
    mutationFn: ({ ids, favorite }: { ids: string[]; favorite: boolean }) =>
      api.setFavorite(ids, favorite),
    onSuccess: invalidate,
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

/** Restore soft-deleted photos (used by the remove Undo action). */
export function useRestorePhotos() {
  const invalidate = usePhotoInvalidation();
  return useMutation({
    mutationFn: (ids: string[]) => api.restorePhotos(ids),
    onSuccess: invalidate,
  });
}

export function useRemovePhotos() {
  const invalidate = useDeleteInvalidation();
  const invalidateAll = usePhotoInvalidation();
  return useMutation({
    mutationFn: (ids: string[]) => api.removePhotos(ids),
    onSuccess: (_removed, ids) => {
      invalidate(ids);
      toast.success(`Removed ${plural(ids.length, "photo")} from the catalog`, {
        description: "The original files were not touched.",
        action: {
          label: "Undo",
          onClick: () => {
            api
              .restorePhotos(ids)
              .then(() => {
                // Full refetch so restored photos rejoin every list, including
                // the album photos we patched out on removal.
                invalidateAll();
                toast.success("Restored");
              })
              .catch(() => toast.error("Could not restore"));
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
  const invalidate = useDeleteInvalidation();
  return useMutation({
    mutationFn: (ids: string[]) => api.deletePhotosFromDisk(ids),
    onSuccess: (_deleted, ids) => {
      invalidate(ids);
      toast.success(`Deleted ${plural(ids.length, "photo")} from disk`, {
        description: "The original files were moved to the trash.",
      });
    },
    onError: (err) =>
      toast.error("Could not delete from disk", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });
}
