/**
 * Photo selection state for the library/timeline grids. Supports single,
 * toggle (Ctrl/Cmd) and range (Shift) selection against an ordered id list.
 */
import { create } from "zustand";

interface SelectionState {
  selected: Set<string>;
  /** Anchor id for shift-range selection. */
  anchor: string | null;

  isSelected: (id: string) => boolean;
  count: () => number;
  /** Replace selection with a single id. */
  select: (id: string) => void;
  /** Toggle a single id (Ctrl/Cmd click). */
  toggle: (id: string) => void;
  /** Select the inclusive range between the anchor and `id` within `order`. */
  selectRange: (id: string, order: string[]) => void;
  /** Select every id in `order`. */
  selectAll: (order: string[]) => void;
  clear: () => void;
  setSelected: (ids: string[]) => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selected: new Set<string>(),
  anchor: null,

  isSelected: (id) => get().selected.has(id),
  count: () => get().selected.size,

  select: (id) => set({ selected: new Set([id]), anchor: id }),

  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next, anchor: id };
    }),

  selectRange: (id, order) =>
    set((s) => {
      const anchor = s.anchor ?? id;
      const a = order.indexOf(anchor);
      const b = order.indexOf(id);
      if (a === -1 || b === -1) return { selected: new Set([id]), anchor: id };
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const next = new Set(s.selected);
      for (let i = lo; i <= hi; i++) {
        const item = order[i];
        if (item) next.add(item);
      }
      return { selected: next, anchor };
    }),

  selectAll: (order) => set({ selected: new Set(order), anchor: order[order.length - 1] ?? null }),

  clear: () => set({ selected: new Set<string>(), anchor: null }),

  setSelected: (ids) => set({ selected: new Set(ids), anchor: ids[ids.length - 1] ?? null }),
}));
