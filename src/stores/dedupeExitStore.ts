/**
 * Tracks photos that were just deduplicated and are animating out of the grid.
 *
 * The dedupe removal defers dropping these rows from the query cache until the
 * exit animation (pulse, then fade) has played, so {@link PhotoCell} can render
 * them one last time with the `dedupe-exiting` class. Membership is cleared once
 * the cache is patched (or the removal is undone).
 */
import { create } from "zustand";

/** How long the exit animation runs before the rows are dropped (ms). Kept in
 * sync with the `dedupe-exit` keyframe duration in `index.css`. */
export const DEDUPE_EXIT_MS = 1600;

interface DedupeExitState {
  /** Ids currently animating out. */
  ids: Set<string>;
  /** Mark ids as exiting (replaces any previous set). */
  start: (ids: string[]) => void;
  /** Clear all exiting ids (after the cache is patched, or on undo). */
  clear: () => void;
}

export const useDedupeExitStore = create<DedupeExitState>((set) => ({
  ids: new Set(),
  start: (ids) => set({ ids: new Set(ids) }),
  clear: () => set({ ids: new Set() }),
}));
