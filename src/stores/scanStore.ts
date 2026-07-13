/**
 * Live scan progress, fed by backend events (see `useScanEvents`). Kept in a
 * store rather than query cache because it updates at high frequency.
 */
import { create } from "zustand";
import type { ScanProgress, ScanSummary } from "@/types";

interface ScanState {
  progress: ScanProgress | null;
  lastSummary: ScanSummary | null;
  isScanning: boolean;

  setProgress: (p: ScanProgress) => void;
  setSummary: (s: ScanSummary) => void;
}

const IDLE_PHASES = new Set(["idle"]);

export const useScanStore = create<ScanState>((set) => ({
  progress: null,
  lastSummary: null,
  isScanning: false,

  setProgress: (p) =>
    set({
      progress: p,
      isScanning: !IDLE_PHASES.has(p.phase) && p.total > 0 && p.indexed + p.thumbnailed < p.total * 2,
    }),

  setSummary: (s) => set({ lastSummary: s, isScanning: false, progress: null }),
}));
