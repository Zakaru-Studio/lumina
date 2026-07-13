/**
 * Global UI state: theme, sidebar, and the library grid zoom level. Persisted
 * to localStorage so the app reopens exactly as the user left it.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Theme } from "@/types";

/** Bounds for the library grid cell size (px), driven by Ctrl+wheel zoom. */
export const MIN_CELL = 96;
export const MAX_CELL = 360;
export const DEFAULT_CELL = 168;

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  /** Target grid cell size in pixels. */
  cellSize: number;
  commandOpen: boolean;

  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setCellSize: (size: number) => void;
  zoomBy: (delta: number) => void;
  setCommandOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarCollapsed: false,
      cellSize: DEFAULT_CELL,
      commandOpen: false,

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setCellSize: (size) =>
        set({ cellSize: Math.max(MIN_CELL, Math.min(MAX_CELL, Math.round(size))) }),
      zoomBy: (delta) =>
        set((s) => ({
          cellSize: Math.max(MIN_CELL, Math.min(MAX_CELL, Math.round(s.cellSize + delta))),
        })),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
    }),
    {
      name: "lumina-ui",
      partialize: (s) => ({
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        cellSize: s.cellSize,
      }),
    },
  ),
);

/** Resolve the effective theme (`system` → matchMedia) and apply it to <html>. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}
