/**
 * The single boundary between the React app and the Rust backend.
 *
 * Every backend capability is exposed here as a typed function. Components and
 * hooks call these — never `invoke` directly — so the command surface stays in
 * one place and the app holds no business logic.
 */
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import type {
  AiStatus,
  Album,
  AppConfig,
  ColorLabel,
  LibraryStats,
  Page,
  Photo,
  PhotoFilter,
  PhotoQuery,
  ScanProgress,
  Tag,
  TimelineSection,
  WatchedFolder,
} from "@/types";

// --- Photos ---

export const listPhotos = (query: PhotoQuery) =>
  invoke<Page<Photo>>("list_photos", { query });

export const getPhoto = (id: string) => invoke<Photo>("get_photo", { id });

export const countPhotos = (filter: PhotoFilter) =>
  invoke<number>("count_photos", { filter });

export const photoTimeline = (filter: PhotoFilter) =>
  invoke<TimelineSection[]>("photo_timeline", { filter });

export const libraryStats = () => invoke<LibraryStats>("library_stats");

export const setRating = (ids: string[], rating: number) =>
  invoke<void>("set_rating", { ids, rating });

export const setColor = (ids: string[], color: ColorLabel) =>
  invoke<void>("set_color", { ids, color });

export const setFavorite = (ids: string[], favorite: boolean) =>
  invoke<void>("set_favorite", { ids, favorite });

export const removePhotos = (ids: string[]) =>
  invoke<number>("remove_photos", { ids });

/** Restore soft-deleted photos to the catalog (Undo of remove). */
export const restorePhotos = (ids: string[]) =>
  invoke<number>("restore_photos", { ids });

/** List catalog duplicates (photos sharing an identical content hash). */
export const listDuplicates = (query: PhotoQuery) =>
  invoke<Page<Photo>>("list_duplicates", { query });

/** Full ordered id list for a query (backbone of windowed browsing). */
export const listPhotoIds = (query: PhotoQuery) =>
  invoke<string[]>("list_photo_ids", { query });

/** Save edited image bytes (base64/data-URL) as a NEW file. Returns the path. */
export const saveEditedImage = (destPath: string, dataBase64: string) =>
  invoke<string>("save_edited_image", { destPath, dataBase64 });

/** Prompt for a destination path to save an image copy. Returns null if cancelled. */
export async function pickSavePath(defaultName: string): Promise<string | null> {
  const path = await saveDialog({
    defaultPath: defaultName,
    filters: [
      { name: "JPEG", extensions: ["jpg", "jpeg"] },
      { name: "PNG", extensions: ["png"] },
      { name: "WebP", extensions: ["webp"] },
    ],
  });
  return path ?? null;
}

/** Reveal a file in the OS file manager (Explorer/Finder). */
export const revealInExplorer = (path: string) => revealItemInDir(path);

// --- Thumbnails ---

export const thumbnailPath = (id: string) =>
  invoke<string | null>("thumbnail_path", { id });

export const ensureThumbnail = (id: string) =>
  invoke<string>("ensure_thumbnail", { id });

/** Resolve a renderable URL for a photo's thumbnail (asset protocol). */
export const thumbnailSrc = (photo: Photo): string | null =>
  photo.thumbPath ? convertFileSrc(photo.thumbPath) : null;

/** Resolve a renderable URL for the full-resolution original. */
export const originalSrc = (photo: Photo): string => convertFileSrc(photo.path);

// --- Scanning / folders ---

export const scanFolders = (paths: string[]) =>
  invoke<void>("scan_folders", { paths });

export const rescanLibrary = () => invoke<void>("rescan_library");

export const scanProgress = () => invoke<ScanProgress>("scan_progress");

export const listWatchedFolders = () =>
  invoke<WatchedFolder[]>("list_watched_folders");

export const addWatchedFolder = (path: string) =>
  invoke<WatchedFolder>("add_watched_folder", { path });

export const removeWatchedFolder = (id: string) =>
  invoke<void>("remove_watched_folder", { id });

// --- Tags ---

export const listTags = () => invoke<Tag[]>("list_tags");

export const createTag = (name: string, color?: string) =>
  invoke<Tag>("create_tag", { name, color: color ?? null });

export const updateTag = (id: string, name: string, color?: string) =>
  invoke<void>("update_tag", { id, name, color: color ?? null });

export const deleteTag = (id: string) => invoke<void>("delete_tag", { id });

export const attachTag = (tagId: string, photoIds: string[]) =>
  invoke<void>("attach_tag", { tagId, photoIds });

export const detachTag = (tagId: string, photoIds: string[]) =>
  invoke<void>("detach_tag", { tagId, photoIds });

// --- Albums ---

export const listAlbums = () => invoke<Album[]>("list_albums");

export const getAlbum = (id: string) => invoke<Album>("get_album", { id });

export const createAlbum = (name: string) =>
  invoke<Album>("create_album", { name });

export const renameAlbum = (id: string, name: string) =>
  invoke<void>("rename_album", { id, name });

export const deleteAlbum = (id: string) => invoke<void>("delete_album", { id });

export const addToAlbum = (albumId: string, photoIds: string[]) =>
  invoke<void>("add_to_album", { albumId, photoIds });

export const removeFromAlbum = (albumId: string, photoIds: string[]) =>
  invoke<void>("remove_from_album", { albumId, photoIds });

export const albumPhotos = (albumId: string, query: PhotoQuery) =>
  invoke<Page<Photo>>("album_photos", { albumId, query });

// --- Settings / AI ---

export const getConfig = () => invoke<AppConfig>("get_config");

export const updateConfig = (config: AppConfig) =>
  invoke<AppConfig>("update_config", { config });

export const aiStatus = () => invoke<AiStatus>("ai_status");

// --- Native dialogs ---

/** Open the OS folder picker (multi-select). Returns absolute paths. */
export async function pickFolders(): Promise<string[]> {
  const selected = await openDialog({ directory: true, multiple: true });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}
