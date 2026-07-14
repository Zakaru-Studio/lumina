/** Live face-indexing progress, updated from backend `face://*` events. */
import { create } from "zustand";
import type { FaceProgress } from "@/types";

interface FaceState {
  progress: FaceProgress | null;
  running: boolean;
  setProgress: (p: FaceProgress) => void;
  setRunning: (r: boolean) => void;
  reset: () => void;
}

export const useFaceStore = create<FaceState>((set) => ({
  progress: null,
  running: false,
  setProgress: (progress) =>
    set({ progress, running: progress.processed < progress.total }),
  setRunning: (running) => set({ running }),
  reset: () => set({ progress: null, running: false }),
}));
