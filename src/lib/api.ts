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
  FolderPreview,
  LibraryStats,
  MapPoint,
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

/** All geolocated photos as lightweight points for the map view. */
export const photosWithGps = () => invoke<MapPoint[]>("photos_with_gps");

/** Resolve a renderable URL for a map point's thumbnail (asset protocol). */
export const mapPointSrc = (point: MapPoint): string | null =>
  point.thumbPath ? convertFileSrc(point.thumbPath) : null;

export const setRating = (ids: string[], rating: number) =>
  invoke<void>("set_rating", { ids, rating });

export const setFavorite = (ids: string[], favorite: boolean) =>
  invoke<void>("set_favorite", { ids, favorite });

/** Remove photos from the catalog only; original files are left on disk. */
export const removePhotos = (ids: string[]) =>
  invoke<number>("remove_photos", { ids });

/** Delete photos from BOTH disk and catalog; originals go to the OS trash. */
export const deletePhotosFromDisk = (ids: string[]) =>
  invoke<number>("delete_photos_from_disk", { ids });

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

/**
 * Overwrite a photo's ORIGINAL file in place with edited bytes, then refresh its
 * metadata and thumbnail. Destructive — replaces the source file. Catalog fields
 * (rating, color, favorite, tags, albums) are preserved.
 */
export const overwriteOriginal = (id: string, dataBase64: string) =>
  invoke<void>("overwrite_original", { id, dataBase64 });

/** Outcome of a batch capture-date edit. */
export interface SetDateSummary {
  /** Photos whose date was set (catalog override — works for every format). */
  updated: number;
  /** Subset also written into the file's EXIF (JPEG/TIFF/PNG). */
  exifWritten: number;
  failed: number;
}

/**
 * Set the capture date/time for one or more photos. Always recorded as a catalog
 * override (works for RAW/video too); additionally written into the file's EXIF
 * for JPEG/TIFF/PNG. `timestamp` is Unix **seconds** in local time.
 */
export const setCaptureDate = (ids: string[], timestamp: number) =>
  invoke<SetDateSummary>("set_capture_date", { ids, timestamp });

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

/**
 * Resolve a webview-displayable source path for a photo's full view. Normal
 * images return their original path; RAW files are rendered (once, cached) from
 * their embedded preview and that path is returned. Pass the result to
 * {@link assetSrc}.
 */
export const displayPreview = (id: string) =>
  invoke<string>("display_preview", { id });

/**
 * Append a stable cache-busting token so overwriting a file in place (same path,
 * e.g. "Save to original") forces the webview to re-fetch it instead of serving
 * the stale cached bytes. The token only changes when the file's mtime does, so
 * normal browsing stays fully cacheable. Tauri's asset protocol ignores the
 * query string when resolving the file.
 */
const versioned = (url: string, version: number | null): string =>
  version ? `${url}?v=${version}` : url;

/**
 * Resolve a renderable URL for a photo's thumbnail (asset protocol). `cacheBust`
 * (bumped when thumbnails are regenerated at a new size) is appended so the
 * webview re-fetches the overwritten file instead of serving stale bytes.
 */
export const thumbnailSrc = (photo: Photo, cacheBust = 0): string | null => {
  if (!photo.thumbPath) return null;
  const url = versioned(convertFileSrc(photo.thumbPath), photo.fileModified);
  if (!cacheBust) return url;
  return `${url}${url.includes("?") ? "&" : "?"}tv=${cacheBust}`;
};

/** Resolve a renderable URL for the full-resolution original. */
export const originalSrc = (photo: Photo): string =>
  versioned(convertFileSrc(photo.path), photo.fileModified);

/** Resolve a renderable URL for an arbitrary cached file path (asset protocol). */
export const assetSrc = (absolutePath: string): string => convertFileSrc(absolutePath);

// --- Scanning / folders ---

export const scanFolders = (paths: string[]) =>
  invoke<void>("scan_folders", { paths });

export const rescanLibrary = () => invoke<void>("rescan_library");

/** Regenerate every thumbnail at the current configured size. */
export const regenerateThumbnails = () => invoke<void>("regenerate_thumbnails");

export const scanProgress = () => invoke<ScanProgress>("scan_progress");

export const listWatchedFolders = () =>
  invoke<WatchedFolder[]>("list_watched_folders");

export const addWatchedFolder = (path: string) =>
  invoke<WatchedFolder>("add_watched_folder", { path });

export const removeWatchedFolder = (id: string) =>
  invoke<void>("remove_watched_folder", { id });

// --- Import as albums ---

/** Preview the folder trees under `paths` as proposed album hierarchies. */
export const previewImportTree = (paths: string[]) =>
  invoke<FolderPreview[]>("preview_import_tree", { paths });

/**
 * Register `paths` and create albums mirroring their folder trees, using
 * `rootNames[i]` as the name of the root album for `paths[i]`. Starts the scan.
 */
export const importAsAlbums = (paths: string[], rootNames: string[]) =>
  invoke<void>("import_as_albums", { paths, rootNames });

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

export const createAlbum = (name: string, parentId?: string | null) =>
  invoke<Album>("create_album", { name, parentId: parentId ?? null });

/** Move a manual album under `parentId` (null = root) at position `newIndex`. */
export const moveAlbum = (id: string, parentId: string | null, newIndex: number) =>
  invoke<void>("move_album", { id, parentId, newIndex });

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
