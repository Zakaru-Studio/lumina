/**
 * Drives the shared "delete photos" confirmation dialog. Every delete entry
 * point (selection toolbar, cell context menu, keyboard shortcut) opens this
 * with the target ids instead of deleting directly, so the "remove from library
 * vs delete from disk" choice is presented consistently in one place.
 *
 * `payload` holds the ids pending a delete decision (`null` when closed).
 */
import { createDialogStore } from "@/stores/createDialogStore";

export const useDeleteDialog = createDialogStore<string[]>((ids) => ids.length === 0);
