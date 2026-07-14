/**
 * Tracks which manual album (if any) is currently being viewed, so components
 * rendered deep in the grid (cells, selection toolbar, lightbox) can offer a
 * "remove from this album" action without prop-drilling the album through the
 * whole tree. Set by {@link AlbumDetailPage} for manual albums only.
 */
import { create } from "zustand";

interface AlbumContextState {
  albumId: string | null;
  albumName: string | null;
  set: (albumId: string, albumName: string) => void;
  clear: () => void;
}

export const useAlbumContext = create<AlbumContextState>((set) => ({
  albumId: null,
  albumName: null,
  set: (albumId, albumName) => set({ albumId, albumName }),
  clear: () => set({ albumId: null, albumName: null }),
}));
