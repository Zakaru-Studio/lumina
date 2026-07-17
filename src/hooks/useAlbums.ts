/** Album listing, detail, photo browsing and mutations. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { qk } from "@/lib/query";
import type { PhotoQuery } from "@/types";

export function useAlbums() {
  return useQuery({ queryKey: qk.albums, queryFn: api.listAlbums });
}

export function useAlbum(id: string | null) {
  return useQuery({
    queryKey: qk.album(id ?? ""),
    queryFn: () => api.getAlbum(id as string),
    enabled: !!id,
  });
}

/** Paginated photos within an album (smart or manual). */
export function useAlbumPhotos(albumId: string | null, query: PhotoQuery) {
  const { filter, sortBy, sortDir, limit } = query;
  return useInfiniteQuery({
    queryKey: ["albums", albumId ?? "", "photos", { filter, sortBy, sortDir, limit }] as const,
    enabled: !!albumId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.albumPhotos(albumId as string, { ...query, offset: pageParam }),
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return next < last.total ? next : undefined;
    },
  });
}

function useAlbumInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.albums });
}

export function useCreateAlbum() {
  const invalidate = useAlbumInvalidation();
  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string | null }) =>
      api.createAlbum(name, parentId ?? null),
    onSuccess: (album) => {
      invalidate();
      toast.success(`Album “${album.name}” created`);
    },
  });
}

/** Move a manual album under a new parent (null = root) at a sibling index. */
export function useMoveAlbum() {
  const invalidate = useAlbumInvalidation();
  return useMutation({
    mutationFn: ({
      id,
      parentId,
      newIndex,
    }: {
      id: string;
      parentId: string | null;
      newIndex: number;
    }) => api.moveAlbum(id, parentId, newIndex),
    onSuccess: invalidate,
    onError: (e) => toast.error(String(e)),
  });
}

export function useRenameAlbum() {
  const invalidate = useAlbumInvalidation();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameAlbum(id, name),
    onSuccess: invalidate,
  });
}

export function useDeleteAlbum() {
  const invalidate = useAlbumInvalidation();
  return useMutation({ mutationFn: (id: string) => api.deleteAlbum(id), onSuccess: invalidate });
}

/**
 * Delete several albums in one action, invalidating once at the end. Runs the
 * deletions sequentially — mirror albums trash their real on-disk folder, so we
 * avoid firing concurrent filesystem operations — and refreshes the list once
 * they're all gone rather than after each.
 */
export function useDeleteAlbums() {
  const invalidate = useAlbumInvalidation();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api.deleteAlbum(id);
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(String(e)),
  });
}

export function useAddToAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, photoIds }: { albumId: string; photoIds: string[] }) =>
      api.addToAlbum(albumId, photoIds),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: qk.albums });
      qc.invalidateQueries({ queryKey: qk.album(v.albumId) });
      toast.success(`Added ${v.photoIds.length} to album`);
    },
  });
}

export function useRemoveFromAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, photoIds }: { albumId: string; photoIds: string[] }) =>
      api.removeFromAlbum(albumId, photoIds),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: qk.albums });
      qc.invalidateQueries({ queryKey: ["albums", v.albumId] });
      const n = v.photoIds.length;
      toast.success(`Removed ${n} photo${n === 1 ? "" : "s"} from the album`);
    },
  });
}
