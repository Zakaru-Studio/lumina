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
  BackupPreview,
  BackupProgress,
  DedupePlan,
  DeviceInfo,
  FaceBox,
  FaceStatus,
  FolderPreview,
  GeoPlace,
  GeoSearchResult,
  LibraryStats,
  MapPoint,
  Page,
  PersonSummary,
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

/**
 * Reverse-geocode a coordinate to a place name via the free Nominatim service —
 * the online fallback used only when the offline gazetteer can't name a point.
 * Resolves to `null` when nothing matches or the lookup fails. `lang` localizes
 * the returned names (a UI language code such as `"en"` / `"fr"`).
 */
export const reverseGeocode = (lat: number, lon: number, lang: string) =>
  invoke<GeoPlace | null>("reverse_geocode", { lat, lon, lang });

/** Distinct reverse-geocoded place names present in the cache (for the library
 * place filter). May be empty until coordinates have been resolved. */
export const listPlaces = () => invoke<string[]>("list_places");

/** Forward-geocode a free-text place (city / region / country) to a coordinate.
 * Resolves to `null` when nothing matches or the lookup fails. */
export const geocodeSearch = (query: string, lang: string) =>
  invoke<GeoSearchResult | null>("geocode_search", { query, lang });

/** Forward-geocode a free-text address to several ranked matches (address
 * search box). Empty when nothing matches or the lookup fails. */
export const geocodeSearchAll = (query: string, lang: string) =>
  invoke<GeoSearchResult[]>("geocode_search_all", { query, lang });

/** Set (or clear, with `null`) the GPS coordinates of photos. Catalog-only. */
export const setLocation = (ids: string[], lat: number | null, lon: number | null) =>
  invoke<void>("set_location", { ids, lat, lon });

/** Read the cached place for a coordinate (no online lookup); null if none. */
export const getPlace = (lat: number, lon: number, lang: string) =>
  invoke<GeoPlace | null>("get_place", { lat, lon, lang });

/** Store a user-entered place (city / region / country) for a coordinate. */
export const setPlace = (
  lat: number,
  lon: number,
  lang: string,
  city: string | null,
  region: string | null,
  country: string | null,
) => invoke<void>("set_place", { lat, lon, lang, city, region, country });

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

/**
 * Compute a smart dedupe proposal (which copy to keep / remove per hash group).
 * Pass `ids` to scope it to a selection (test a subset); omit for the whole catalog.
 */
export const dedupePlan = (ids?: string[]) =>
  invoke<DedupePlan>("dedupe_plan", { ids: ids ?? null });

/** Full ordered id list for a query (backbone of windowed browsing). */
export const listPhotoIds = (query: PhotoQuery) =>
  invoke<string[]>("list_photo_ids", { query });

/** Save edited image bytes (base64/data-URL) as a NEW file. Returns the path. */
export const saveEditedImage = (destPath: string, dataBase64: string) =>
  invoke<string>("save_edited_image", { destPath, dataBase64 });

/**
 * Encode a base64 PNG (from the editor's canvas) to AVIF at `quality` (1–100) and
 * save it as a NEW file at `destPath`. Browsers can't encode AVIF from a canvas,
 * so this path re-encodes backend-side. Returns the saved path.
 */
export const saveAvif = (destPath: string, dataBase64: string, quality: number) =>
  invoke<string>("save_avif", { destPath, dataBase64, quality });

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
      { name: "AVIF", extensions: ["avif"] },
    ],
  });
  return path ?? null;
}

/**
 * Rename a media file. `newName` is the new file name (including its extension);
 * for a mirror album the file is renamed on disk, otherwise only the catalog
 * entry is updated.
 */
export const renamePhoto = (id: string, newName: string) =>
  invoke<void>("rename_photo", { id, newName });

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
 * When `mirror` is true the roots become bidirectional folder mirrors (album
 * edits change the on-disk folders, and Explorer changes sync back); otherwise
 * the albums are app-only and the files/folders are never touched.
 */
export const importAsAlbums = (paths: string[], rootNames: string[], mirror: boolean) =>
  invoke<void>("import_as_albums", { paths, rootNames, mirror });

// --- Device backup ---

/** List removable devices currently connected that hold media. */
export const listRemovableDevices = () =>
  invoke<DeviceInfo[]>("list_removable_devices");

/** Preview how many files a backup would copy vs skip (fast, path+size based). */
export const previewBackup = (source: string, dest: string) =>
  invoke<BackupPreview>("preview_backup", { source, dest });

/** Start backing up `source` into `dest`. Progress arrives via events. */
export const startBackup = (source: string, dest: string) =>
  invoke<void>("start_backup", { source, dest });

export const backupProgress = () =>
  invoke<BackupProgress>("backup_progress");

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

// --- Faces / People (on-device face recognition) ---

/** Full status of the face feature (enabled, models installed, running, counts). */
export const faceStatus = () => invoke<FaceStatus>("face_status");

/**
 * Turn face recognition on/off. Enabling downloads the models on first use
 * (may take a moment) and starts indexing; the returned status reflects the
 * outcome. Rejects (leaving the feature off) if the model download fails.
 */
export const setFaceRecognitionEnabled = (enabled: boolean) =>
  invoke<FaceStatus>("set_face_recognition_enabled", { enabled });

/** Manually (re)start an indexing pass over photos still lacking faces. */
export const indexFacesNow = () => invoke<void>("index_faces_now");

/** Erase all face data (faces, people, indexing state). */
export const clearFaceData = () => invoke<FaceStatus>("clear_face_data");

/** List people (clusters). */
export const listPeople = (
  includeHidden: boolean,
  namedOnly: boolean,
  minFaces: number,
) => invoke<PersonSummary[]>("list_people", { includeHidden, namedOnly, minFaces });

export const getPerson = (id: string) =>
  invoke<PersonSummary | null>("get_person", { id });

/** All face boxes detected in a photo (overlays / corrections). */
export const facesInPhoto = (photoId: string) =>
  invoke<FaceBox[]>("faces_in_photo", { photoId });

export const renamePerson = (id: string, name: string | null) =>
  invoke<void>("rename_person", { id, name: name ?? null });

export const setPersonHidden = (id: string, hidden: boolean) =>
  invoke<void>("set_person_hidden", { id, hidden });

/** Delete a person and all of its face detections. */
export const deletePerson = (id: string) =>
  invoke<void>("delete_person", { id });

/** Merge `sources` into `into`; their faces become confirmed members of the target. */
export const mergePeople = (sources: string[], into: string) =>
  invoke<void>("merge_people", { sources, into });

/** Reassign faces to a person (`null` detaches them). */
export const assignFaces = (faceIds: string[], personId: string | null) =>
  invoke<void>("assign_faces", { faceIds, personId: personId ?? null });

export const createPerson = (name?: string | null) =>
  invoke<string>("create_person", { name: name ?? null });

// --- Native dialogs ---

/** Open the OS folder picker (multi-select). Returns absolute paths. */
export async function pickFolders(): Promise<string[]> {
  const selected = await openDialog({ directory: true, multiple: true });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}
