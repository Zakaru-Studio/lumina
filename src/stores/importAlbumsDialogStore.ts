/**
 * Drives the "import folders as albums" dialog. Picking folders opens this with
 * the chosen paths instead of scanning directly, so the user decides — from one
 * place — whether to mirror the folder tree as albums or just import the media.
 */
import { create } from "zustand";

interface ImportAlbumsDialogState {
  /** Picked folder paths awaiting the import decision, or null when closed. */
  paths: string[] | null;
  open: (paths: string[]) => void;
  close: () => void;
}

export const useImportAlbumsDialog = create<ImportAlbumsDialogState>((set) => ({
  paths: null,
  open: (paths) => set({ paths: paths.length > 0 ? paths : null }),
  close: () => set({ paths: null }),
}));
