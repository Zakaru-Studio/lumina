/**
 * Drives the "back up this device?" prompt shown when a removable device with
 * photos is connected. A connected device opens the dialog; the copy runs in the
 * backend and streams progress/summary back through {@link useBackupEvents},
 * which pushes updates into this store so the dialog can render a progress bar.
 */
import { create } from "zustand";

import type { BackupProgress, BackupSummary, DeviceInfo } from "@/types";

/** Where the backup flow currently is. */
export type BackupStatus = "idle" | "copying" | "done";

interface BackupDeviceState {
  /** The connected device we're offering to back up, or null when closed. */
  device: DeviceInfo | null;
  status: BackupStatus;
  progress: BackupProgress | null;
  summary: BackupSummary | null;

  /** Open the prompt for a freshly-connected device. */
  open: (device: DeviceInfo) => void;
  /** Close the prompt and reset transient state. */
  close: () => void;
  /** Mark the copy as started (clears any previous summary). */
  begin: () => void;
  setProgress: (p: BackupProgress) => void;
  setDone: (s: BackupSummary) => void;
}

export const useBackupDevice = create<BackupDeviceState>((set) => ({
  device: null,
  status: "idle",
  progress: null,
  summary: null,

  open: (device) => set({ device, status: "idle", progress: null, summary: null }),
  close: () => set({ device: null, status: "idle", progress: null, summary: null }),
  begin: () => set({ status: "copying", progress: null, summary: null }),
  setProgress: (progress) => set({ progress, status: "copying" }),
  setDone: (summary) => set({ summary, status: "done" }),
}));
