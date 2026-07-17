/**
 * Drives the "back up your library?" prompt. Opened either automatically when
 * the recognised backup drive is (re)connected (carrying the drive's resolved
 * destination path + label) or manually from Settings (no device). The copy runs
 * in the backend and streams progress/summary back through {@link useBackupEvents},
 * which pushes updates into this store so the dialog can render.
 */
import { create } from "zustand";

import type { BackupProgress, BackupSummary, DeviceInfo } from "@/types";

/** Where the backup flow currently is. */
export type BackupStatus = "idle" | "copying" | "done" | "cancelled" | "error";

interface BackupDeviceState {
  /** Whether the prompt is open. */
  isOpen: boolean;
  /** The recognised backup drive that triggered the prompt (its `path` is the
   * destination resolved on the current drive letter), or null for a manual run. */
  device: DeviceInfo | null;
  status: BackupStatus;
  progress: BackupProgress | null;
  summary: BackupSummary | null;

  /** Open the prompt; pass the detected backup drive, or nothing for a manual run. */
  open: (device?: DeviceInfo | null) => void;
  /** Close the prompt and reset transient state. */
  close: () => void;
  /** Mark the copy as started (clears any previous summary). */
  begin: () => void;
  setProgress: (p: BackupProgress) => void;
  /** Record the final summary, deriving the terminal status from it. */
  setDone: (s: BackupSummary) => void;
}

export const useBackupDevice = create<BackupDeviceState>((set) => ({
  isOpen: false,
  device: null,
  status: "idle",
  progress: null,
  summary: null,

  open: (device = null) =>
    set({ isOpen: true, device, status: "idle", progress: null, summary: null }),
  close: () =>
    set({ isOpen: false, device: null, status: "idle", progress: null, summary: null }),
  begin: () => set({ status: "copying", progress: null, summary: null }),
  setProgress: (progress) => set({ progress, status: "copying" }),
  setDone: (summary) =>
    set({
      summary,
      status: summary.error ? "error" : summary.cancelled ? "cancelled" : "done",
    }),
}));
