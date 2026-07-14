/**
 * People / face-recognition hooks: capability status, the people list, per-person
 * data, all mutations, and the backend event subscription.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { onFaceDone, onFaceProgress, onPeopleChanged } from "@/lib/events";
import { qk } from "@/lib/query";
import { useFaceStore } from "@/stores/faceStore";

/** Filters for the People list. */
export interface PeopleFilters {
  includeHidden: boolean;
  namedOnly: boolean;
  minFaces: number;
}

export function useFaceStatus() {
  return useQuery({ queryKey: qk.faceStatus, queryFn: api.faceStatus });
}

export function usePeople(filters: PeopleFilters) {
  const { data: status } = useFaceStatus();
  return useQuery({
    queryKey: qk.people(filters),
    queryFn: () =>
      api.listPeople(filters.includeHidden, filters.namedOnly, filters.minFaces),
    enabled: status?.enabled ?? false,
  });
}

export function usePerson(id: string | undefined) {
  return useQuery({
    queryKey: qk.person(id ?? ""),
    queryFn: () => api.getPerson(id as string),
    enabled: !!id,
  });
}

/** Faces detected in a single photo (for the lightbox "People" overlay). */
export function useFacesInPhoto(photoId: string | null | undefined) {
  const { data: status } = useFaceStatus();
  return useQuery({
    queryKey: qk.facesInPhoto(photoId ?? ""),
    queryFn: () => api.facesInPhoto(photoId as string),
    enabled: !!photoId && (status?.enabled ?? false),
  });
}

export function useSetFaceRecognition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.setFaceRecognitionEnabled(enabled),
    onSuccess: (status) => {
      qc.setQueryData(qk.faceStatus, status);
      qc.invalidateQueries({ queryKey: qk.aiStatus });
      qc.invalidateQueries({ queryKey: qk.config });
    },
  });
}

export function useIndexFacesNow() {
  return useMutation({ mutationFn: () => api.indexFacesNow() });
}

export function useClearFaceData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearFaceData(),
    onSuccess: (status) => {
      qc.setQueryData(qk.faceStatus, status);
      qc.invalidateQueries({ queryKey: ["people"] });
    },
  });
}

export function useRenamePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string | null }) =>
      api.renamePerson(id, name),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: qk.person(id) });
    },
  });
}

export function useSetPersonHidden() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      api.setPersonHidden(id, hidden),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people"] }),
  });
}

export function useDeletePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePerson(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: qk.faceStatus });
    },
  });
}

export function useMergePeople() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sources, into }: { sources: string[]; into: string }) =>
      api.mergePeople(sources, into),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people"] }),
  });
}

/**
 * Subscribe to face-indexing events: keep the progress store live and refresh
 * the People views on completion / changes. Mount once in the app shell.
 */
export function useFaceEvents() {
  const qc = useQueryClient();
  const setProgress = useFaceStore((s) => s.setProgress);
  const setRunning = useFaceStore((s) => s.setRunning);
  const { t } = useTranslation();

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let active = true;
    void (async () => {
      const subs = await Promise.all([
        onFaceProgress((p) => setProgress(p)),
        onFaceDone((s) => {
          setRunning(false);
          qc.invalidateQueries({ queryKey: ["people"] });
          qc.invalidateQueries({ queryKey: ["faces"] });
          qc.invalidateQueries({ queryKey: qk.faceStatus });
          if (s.photosProcessed > 0) {
            toast.success(
              t("people.indexDone", { people: s.people, faces: s.facesDetected }),
            );
          }
        }),
        onPeopleChanged(() => {
          qc.invalidateQueries({ queryKey: ["people"] });
          qc.invalidateQueries({ queryKey: ["faces"] });
          qc.invalidateQueries({ queryKey: qk.faceStatus });
        }),
      ]);
      if (active) unlisteners.push(...subs);
      else subs.forEach((u) => u());
    })();
    return () => {
      active = false;
      unlisteners.forEach((u) => u());
    };
  }, [qc, setProgress, setRunning, t]);
}
