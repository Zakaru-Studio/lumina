/** Tag listing and mutations. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api";
import { qk } from "@/lib/query";

export function useTags() {
  return useQuery({ queryKey: qk.tags, queryFn: api.listTags });
}

function useTagInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.tags });
    qc.invalidateQueries({ queryKey: qk.photos });
  };
}

export function useCreateTag() {
  const invalidate = useTagInvalidation();
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color?: string }) =>
      api.createTag(name, color),
    onSuccess: invalidate,
  });
}

export function useUpdateTag() {
  const invalidate = useTagInvalidation();
  return useMutation({
    mutationFn: ({ id, name, color }: { id: string; name: string; color?: string }) =>
      api.updateTag(id, name, color),
    onSuccess: invalidate,
  });
}

export function useDeleteTag() {
  const invalidate = useTagInvalidation();
  return useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: invalidate,
  });
}

export function useAttachTag() {
  const invalidate = useTagInvalidation();
  return useMutation({
    mutationFn: ({ tagId, photoIds }: { tagId: string; photoIds: string[] }) =>
      api.attachTag(tagId, photoIds),
    onSuccess: invalidate,
  });
}

export function useDetachTag() {
  const invalidate = useTagInvalidation();
  return useMutation({
    mutationFn: ({ tagId, photoIds }: { tagId: string; photoIds: string[] }) =>
      api.detachTag(tagId, photoIds),
    onSuccess: invalidate,
  });
}
