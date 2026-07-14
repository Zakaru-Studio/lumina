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
  /** Live pixel height of the scan progress bar (0 when hidden). Lets other
   *  bottom-anchored overlays (e.g. the selection toolbar) sit above it. */
  barHeight: number;

  setProgress: (p: ScanProgress) => void;
  setSummary: (s: ScanSummary) => void;
  setBarHeight: (h: number) => void;
}

const IDLE_PHASES = new Set(["idle"]);

export const useScanStore = create<ScanState>((set) => ({
  progress: null,
  lastSummary: null,
  isScanning: false,
  barHeight: 0,

  setProgress: (p) =>
    set({
      progress: p,
      isScanning: !IDLE_PHASES.has(p.phase) && p.total > 0 && p.processed < p.total,
    }),

  setSummary: (s) => set({ lastSummary: s, isScanning: false, progress: null }),

  // No-op when unchanged so consumers don't re-render on every scan tick.
  setBarHeight: (h) => set((s) => (s.barHeight === h ? s : { barHeight: h })),
}));
