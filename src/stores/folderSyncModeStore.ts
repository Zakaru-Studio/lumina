/**
 * Drives the first-import "folder-management philosophy" choice modal. On the
 * very first import (when {@link import("@/types").AppConfig.folderSyncMode} is
 * still `null`) the user is asked once whether albums should mirror their
 * on-disk folders or stay app-only. The pending import is resumed via the stored
 * `continue` callback after the choice is persisted. Follows the store-driven
 * dialog pattern used across the shell.
 */
import { create } from "zustand";

interface FolderSyncModeState {
  /** Whether the choice modal is currently shown. */
  open: boolean;
  /** Runs after a mode is chosen and persisted (resumes the pending import). */
  continuation: (() => void) | null;
  /** Open the modal, deferring `onChosen` until the user picks a mode. */
  prompt: (onChosen: () => void) => void;
  close: () => void;
}

export const useFolderSyncMode = create<FolderSyncModeState>((set) => ({
  open: false,
  continuation: null,
  prompt: (onChosen) => set({ open: true, continuation: onChosen }),
  close: () => set({ open: false, continuation: null }),
}));
