/**
 * Drives the shared "delete photos" confirmation dialog. Every delete entry
 * point (selection toolbar, cell context menu, keyboard shortcut) opens this
 * with the target ids instead of deleting directly, so the "remove from library
 * vs delete from disk" choice is presented consistently in one place.
 */
import { create } from "zustand";

interface DeleteDialogState {
  /** Ids pending a delete decision, or `null` when the dialog is closed. */
  ids: string[] | null;
  /** Open the dialog for `ids` (no-op on an empty list). */
  open: (ids: string[]) => void;
  close: () => void;
}

export const useDeleteDialog = create<DeleteDialogState>((set) => ({
  ids: null,
  open: (ids) => set({ ids: ids.length > 0 ? ids : null }),
  close: () => set({ ids: null }),
}));
