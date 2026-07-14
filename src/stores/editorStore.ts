/**
 * Global state for the non-destructive image editor.
 *
 * The editor is a singleton overlay mounted once in the app shell. Any part of
 * the app launches it imperatively:
 *
 * ```ts
 * useEditorStore.getState().open(photo.id);
 * ```
 *
 * When `photoId` is `null` the editor renders nothing.
 */
import { create } from "zustand";

interface EditorState {
  /** The photo currently being edited, or `null` when the editor is closed. */
  photoId: string | null;
  /** Open the editor for a given photo id. */
  open: (id: string) => void;
  /** Close the editor and discard the working edit (originals are untouched). */
  close: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  photoId: null,
  open: (id) => set({ photoId: id }),
  close: () => set({ photoId: null }),
}));
