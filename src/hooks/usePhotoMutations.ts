/**
 * Non-destructive photo mutations (rating, color, favorite, catalog removal).
 * All invalidate the photo/stats caches so the UI reflects changes instantly,
 * surface success via toasts, and offer Undo on removal.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { qk } from "@/lib/query";
import type { ColorLabel } from "@/types";

function usePhotoInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.photos });
    qc.invalidateQueries({ queryKey: qk.stats });
    qc.invalidateQueries({ queryKey: qk.albums });
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

export function useSetColor() {
  const invalidate = usePhotoInvalidation();
  return useMutation({
    mutationFn: ({ ids, color }: { ids: string[]; color: ColorLabel }) =>
      api.setColor(ids, color),
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

/** Restore soft-deleted photos (used by the remove Undo action). */
export function useRestorePhotos() {
  const invalidate = usePhotoInvalidation();
  return useMutation({
    mutationFn: (ids: string[]) => api.restorePhotos(ids),
    onSuccess: invalidate,
  });
}

export function useRemovePhotos() {
  const invalidate = usePhotoInvalidation();
  return useMutation({
    mutationFn: (ids: string[]) => api.removePhotos(ids),
    onSuccess: (_removed, ids) => {
      invalidate();
      toast.success(`Removed ${plural(ids.length, "photo")} from the catalog`, {
        description: "The original files were not touched.",
        action: {
          label: "Undo",
          onClick: () => {
            api
              .restorePhotos(ids)
              .then(() => {
                invalidate();
                toast.success("Restored");
              })
              .catch(() => toast.error("Could not restore"));
          },
        },
      });
    },
  });
}
