/**
 * Global UI state: theme, sidebar, and the library grid zoom level. Persisted
 * to localStorage so the app reopens exactly as the user left it.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n, { normalizeLanguage, type Language } from "@/i18n";
import type { Theme } from "@/types";

/** Bounds for the library grid cell size (px), driven by Ctrl+wheel zoom. */
export const MIN_CELL = 96;
export const MAX_CELL = 360;
export const DEFAULT_CELL = 168;

/**
 * How the delete action behaves. `ask` shows the choice dialog; `library` and
 * `disk` skip it and always remove from the catalog / delete from disk. Set from
 * the dialog's "don't ask again" toggle and editable in Settings.
 */
export type DeletePreference = "ask" | "library" | "disk";

interface UiState {
  theme: Theme;
  language: Language;
  sidebarCollapsed: boolean;
  /** Ids of albums whose children are collapsed in the sidebar tree. */
  collapsedAlbums: string[];
  /** Target grid cell size in pixels. */
  cellSize: number;
  commandOpen: boolean;
  deletePreference: DeletePreference;
  /** Bumped when thumbnails are regenerated, to bust cached thumbnail URLs. */
  thumbCacheBust: number;

  setTheme: (theme: Theme) => void;
  setLanguage: (language: Language) => void;
  toggleSidebar: () => void;
  toggleAlbumCollapsed: (id: string) => void;
  bumpThumbCacheBust: () => void;
  setCellSize: (size: number) => void;
  zoomBy: (delta: number) => void;
  setCommandOpen: (open: boolean) => void;
  setDeletePreference: (preference: DeletePreference) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      language: "en",
      sidebarCollapsed: false,
      collapsedAlbums: [],
      cellSize: DEFAULT_CELL,
      commandOpen: false,
      deletePreference: "ask",
      thumbCacheBust: 0,

      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => {
        void i18n.changeLanguage(language);
        set({ language });
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleAlbumCollapsed: (id) =>
        set((s) => ({
          collapsedAlbums: s.collapsedAlbums.includes(id)
            ? s.collapsedAlbums.filter((a) => a !== id)
            : [...s.collapsedAlbums, id],
        })),
      bumpThumbCacheBust: () => set((s) => ({ thumbCacheBust: s.thumbCacheBust + 1 })),
      setCellSize: (size) =>
        set({ cellSize: Math.max(MIN_CELL, Math.min(MAX_CELL, Math.round(size))) }),
      zoomBy: (delta) =>
        set((s) => ({
          cellSize: Math.max(MIN_CELL, Math.min(MAX_CELL, Math.round(s.cellSize + delta))),
        })),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setDeletePreference: (deletePreference) => set({ deletePreference }),
    }),
    {
      name: "lumina-ui",
      partialize: (s) => ({
        theme: s.theme,
        language: s.language,
        sidebarCollapsed: s.sidebarCollapsed,
        collapsedAlbums: s.collapsedAlbums,
        cellSize: s.cellSize,
        deletePreference: s.deletePreference,
        thumbCacheBust: s.thumbCacheBust,
      }),
      onRehydrateStorage: () => (state) => {
        // Sync i18next to the persisted language once the store rehydrates.
        if (state) void i18n.changeLanguage(normalizeLanguage(state.language));
      },
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
