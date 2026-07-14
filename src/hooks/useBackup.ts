/** Device-backup lifecycle: event subscription and progress wiring. */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";

import * as api from "@/lib/api";
import { onBackupDone, onBackupProgress, onDeviceConnected } from "@/lib/events";
import { qk } from "@/lib/query";
import { useBackupDevice } from "@/stores/backupDeviceStore";

/**
 * Subscribe once (mount in the app shell) to device-connection and backup
 * events. A connected device auto-opens the backup prompt when the user has left
 * that preference on; progress and completion flow into the backup store, and a
 * finished copy refreshes the library.
 */
export function useBackupEvents() {
  const qc = useQueryClient();

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let active = true;

    void (async () => {
      const subs = await Promise.all([
        onDeviceConnected(async (device) => {
          // Respect the "propose on connect" preference (fetched fresh so the
          // handler never reads a stale closed-over config).
          const cfg = await api.getConfig().catch(() => null);
          if (cfg && !cfg.autoBackupPrompt) return;
          useBackupDevice.getState().open(device);
        }),
        onBackupProgress((p) => useBackupDevice.getState().setProgress(p)),
        onBackupDone((s) => {
          useBackupDevice.getState().setDone(s);
          qc.invalidateQueries({ queryKey: qk.photos });
          qc.invalidateQueries({ queryKey: qk.stats });
          qc.invalidateQueries({ queryKey: qk.watchedFolders });
        }),
      ]);
      if (active) unlisteners.push(...subs);
      else subs.forEach((u) => u());
    })();

    return () => {
      active = false;
      unlisteners.forEach((u) => u());
    };
  }, [qc]);
}
