/**
 * In-app auto-update coordination. A single store drives both the startup
 * prompt ({@link import("@/components/updater/UpdatePrompt")}) and the manual
 * "Check for updates" button in Settings, so their state never diverges.
 *
 * The check hits the signed GitHub Releases manifest configured in
 * `tauri.conf.json` (`plugins.updater.endpoints`). Only signed bundles whose
 * signature matches the embedded public key are ever installed.
 */
import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Where the update flow currently is. */
export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "upToDate"
  | "error";

/** The pending {@link Update} handle lives outside the store: it is a plugin
 * object (not serialisable) and we only ever need the latest one. */
let pendingUpdate: Update | null = null;

interface UpdaterState {
  status: UpdaterStatus;
  /** Version offered by the manifest, when `status === "available"`. */
  version: string | null;
  /** Release notes from the manifest, if any. */
  notes: string | null;
  /** Download progress in `[0, 1]`, or `null` when unknown/not downloading. */
  progress: number | null;
  /** Human-readable error for the last failed check/install. */
  error: string | null;
  /** Whether the update dialog should be shown. */
  dialogOpen: boolean;

  /**
   * Query the manifest. `manual` surfaces the "up to date" / error outcome to
   * the user (Settings button); the silent startup check stays quiet unless an
   * update is actually found.
   */
  check: (opts?: { manual?: boolean }) => Promise<void>;
  /** Download + install the pending update, then relaunch the app. */
  installAndRestart: () => Promise<void>;
  /** Re-open the update dialog (e.g. from the header update indicator). */
  openDialog: () => void;
  /** Close the dialog without installing. */
  dismiss: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  progress: null,
  error: null,
  dialogOpen: false,

  check: async ({ manual = false } = {}) => {
    // Avoid overlapping checks / re-checking while a download is in flight.
    const s = get().status;
    if (s === "checking" || s === "downloading") return;
    set({ status: "checking", error: null });
    try {
      const update = await check();
      if (update) {
        pendingUpdate = update;
        set({
          status: "available",
          version: update.version,
          notes: update.body ?? null,
          dialogOpen: true,
        });
      } else {
        pendingUpdate = null;
        set({ status: "upToDate" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The silent startup check must never nag on transient network errors.
      set({ status: "error", error: manual ? message : null });
    }
  },

  installAndRestart: async () => {
    if (!pendingUpdate) return;
    set({ status: "downloading", progress: null, error: null });
    let downloaded = 0;
    let contentLength = 0;
    try {
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            set({ progress: 0 });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            set({ progress: contentLength > 0 ? downloaded / contentLength : null });
            break;
          case "Finished":
            set({ progress: 1 });
            break;
        }
      });
      // Installed — relaunch into the new version.
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ status: "error", error: message });
    }
  },

  openDialog: () => set({ dialogOpen: true }),

  dismiss: () => set({ dialogOpen: false }),
}));
