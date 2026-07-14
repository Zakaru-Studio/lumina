/**
 * Drives the shared "rename media" dialog. Every entry point (photo cell context
 * menu, lightbox) opens this with the target photo instead of renaming directly,
 * so the same small dialog is presented consistently in one place.
 *
 * `payload` holds the photo pending a rename (`null` when closed).
 */
import { createDialogStore } from "@/stores/createDialogStore";

/** The minimal photo identity the rename dialog needs. */
export interface RenameTarget {
  id: string;
  filename: string;
}

export const useRenamePhoto = createDialogStore<RenameTarget>();
