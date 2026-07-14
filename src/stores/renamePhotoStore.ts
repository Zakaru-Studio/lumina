/**
 * Drives the shared "rename media" dialog. Every entry point (photo cell context
 * menu, lightbox) opens this with the target photo instead of renaming directly,
 * so the same small dialog is presented consistently in one place.
 */
import { create } from "zustand";

/** The minimal photo identity the rename dialog needs. */
export interface RenameTarget {
  id: string;
  filename: string;
}

interface RenamePhotoState {
  /** Photo pending a rename, or `null` when the dialog is closed. */
  target: RenameTarget | null;
  open: (target: RenameTarget) => void;
  close: () => void;
}

export const useRenamePhoto = create<RenamePhotoState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
