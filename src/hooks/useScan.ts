/** Scan lifecycle: event subscription, progress, and folder controls. */
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { onLibraryChanged, onScanDone, onScanProgress } from "@/lib/events";
import { qk } from "@/lib/query";
import { useScanStore } from "@/stores/scanStore";

/**
 * Subscribe to backend scan events once (mount in the app shell). Updates the
 * scan store and invalidates data queries as photos land — throttled so a busy
 * scan doesn't thrash the query cache.
 */
export function useScanEvents() {
  const qc = useQueryClient();
  const setProgress = useScanStore((s) => s.setProgress);
  const setSummary = useScanStore((s) => s.setSummary);
  const lastInvalidate = useRef(0);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let active = true;

    const invalidateThrottled = () => {
      const now = Date.now();
      if (now - lastInvalidate.current < 600) return;
      lastInvalidate.current = now;
      qc.invalidateQueries({ queryKey: qk.photos });
      qc.invalidateQueries({ queryKey: qk.stats });
    };

    void (async () => {
      const subs = await Promise.all([
        onScanProgress((p) => setProgress(p)),
        onLibraryChanged(invalidateThrottled),
        onScanDone((s) => {
          setSummary(s);
          qc.invalidateQueries({ queryKey: qk.photos });
          qc.invalidateQueries({ queryKey: qk.stats });
          qc.invalidateQueries({ queryKey: qk.albums });
          if (s.added > 0 || s.updated > 0) {
            const bits = [
              s.added > 0 ? `${s.added} added` : null,
              s.updated > 0 ? `${s.updated} updated` : null,
              s.failed > 0 ? `${s.failed} failed` : null,
            ].filter(Boolean);
            toast.success("Scan complete", { description: bits.join(" · ") });
          }
        }),
      ]);
      if (active) unlisteners.push(...subs);
      else subs.forEach((u) => u());
    })();

    // Prime current progress for late mounts.
    void api.scanProgress().then(setProgress).catch(() => {});

    return () => {
      active = false;
      unlisteners.forEach((u) => u());
    };
  }, [qc, setProgress, setSummary]);
}

export function useWatchedFolders() {
  return useQuery({ queryKey: qk.watchedFolders, queryFn: api.listWatchedFolders });
}

export function useScanControls() {
  const qc = useQueryClient();
  const invalidateFolders = () => qc.invalidateQueries({ queryKey: qk.watchedFolders });

  const importFolders = useMutation({
    mutationFn: async () => {
      const paths = await api.pickFolders();
      if (paths.length === 0) return [] as string[];
      await api.scanFolders(paths);
      return paths;
    },
    onSuccess: invalidateFolders,
  });

  const addFolder = useMutation({
    mutationFn: (path: string) => api.addWatchedFolder(path),
    onSuccess: invalidateFolders,
  });

  const removeFolder = useMutation({
    mutationFn: (id: string) => api.removeWatchedFolder(id),
    onSuccess: invalidateFolders,
  });

  const rescan = useMutation({ mutationFn: () => api.rescanLibrary() });

  return { importFolders, addFolder, removeFolder, rescan };
}
