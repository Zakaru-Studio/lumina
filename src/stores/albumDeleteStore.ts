/**
 * Drives the strong confirmation shown before deleting a *mirror* album — one
 * backed by an on-disk folder (`album.folderPath != null`), where deleting the
 * album sends the real folder and its contents to the Recycle Bin. Virtual
 * albums don't use this: they keep their lighter, existing confirmation.
 *
 * `payload` holds the mirror album pending deletion (`null` when closed).
 */
import { createDialogStore } from "@/stores/createDialogStore";

/** The mirror album pending deletion, plus what to run once it's gone. */
export interface AlbumDeleteTarget {
  id: string;
  name: string;
  /** Optional side-effect after a successful delete (e.g. navigate away). */
  onDeleted?: () => void;
}

export const useAlbumDelete = createDialogStore<AlbumDeleteTarget>();
