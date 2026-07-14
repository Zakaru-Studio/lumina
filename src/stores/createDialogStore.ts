/**
 * Factory for the store-driven dialog pattern used across the shell. Every such
 * store is the same shape: a single `payload` (the open target, or `null` when
 * the dialog is closed) plus `open`/`close`. The dialog component is mounted
 * once (in the app shell) and every entry point calls `open(...)` so the modal
 * is presented consistently from one place.
 *
 * Pass `isEmpty` to treat certain payloads as "stay closed" (e.g. an empty id
 * list), matching the guards the hand-written stores used.
 *
 * @example
 *   export const useRenamePhoto = createDialogStore<RenameTarget>();
 *   export const useDeleteDialog = createDialogStore<string[]>((ids) => ids.length === 0);
 */
import { create } from "zustand";

export interface DialogStore<T> {
  /** The open payload, or `null` when the dialog is closed. */
  payload: T | null;
  /** Open the dialog for `payload` (unless `isEmpty` rejects it). */
  open: (payload: T) => void;
  close: () => void;
}

export function createDialogStore<T>(isEmpty?: (payload: T) => boolean) {
  return create<DialogStore<T>>((set) => ({
    payload: null,
    open: (payload) => set({ payload: isEmpty?.(payload) ? null : payload }),
    close: () => set({ payload: null }),
  }));
}
