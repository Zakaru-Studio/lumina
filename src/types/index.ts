/**
 * Shared data contract mirroring the Rust backend (`src-tauri/src/core`).
 *
 * These types are the single source of truth on the frontend. They match the
 * camelCase JSON produced by the backend's `serde(rename_all = "camelCase")`.
 */

export type MediaType = "photo" | "video";

export type ThumbStatus = "pending" | "ready" | "failed";

export type AlbumKind = "manual" | "smart";

export type Theme = "light" | "dark" | "system";

/** A catalogued photo with indexed metadata. */
export interface Photo {
  id: string;
  path: string;
  filename: string;
  folder: string;
  format: string;
  mediaType: MediaType;
  takenAt: number | null;
  fileCreated: number | null;
  fileModified: number | null;
  importedAt: number;
  width: number;
  height: number;
  orientation: number;
  fileSize: number;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  iso: number | null;
  focalLength: number | null;
  aperture: number | null;
  shutterSpeed: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  hash: string | null;
  rating: number;
  isFavorite: boolean;
  isRaw: boolean;
  thumbStatus: ThumbStatus;
  thumbPath: string | null;
  tags: string[];
}

/** One hash-identical set of duplicates: the copy to keep and the ones to drop. */
export interface DedupeGroup {
  keep: Photo;
  remove: Photo[];
}

/** A "smart dedupe" proposal across the whole catalog (advisory until confirmed). */
export interface DedupePlan {
  groups: DedupeGroup[];
  totalRemove: number;
}

/**
 * A lightweight geolocated photo for the map view. Mirrors the backend
 * `MapPoint` — just enough to plot a marker and show its thumbnail, without the
 * full {@link Photo} payload. Only photos carrying GPS coordinates appear here.
 */
export interface MapPoint {
  id: string;
  gpsLat: number;
  gpsLon: number;
  filename: string;
  takenAt: number | null;
  thumbPath: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
  count: number;
}

/** A reverse-geocoded place (online fallback for the map). Any field may be null. */
export interface GeoPlace {
  city: string | null;
  region: string | null;
  country: string | null;
}

/** A forward-geocoding hit: a typed place resolved to a coordinate. */
export interface GeoSearchResult {
  lat: number;
  lon: number;
  place: GeoPlace;
  displayName: string;
}

export interface Album {
  id: string;
  name: string;
  kind: AlbumKind;
  rule: Record<string, unknown> | null;
  icon: string | null;
  sortOrder: number;
  createdAt: number;
  /** Parent album id for nesting; `null` for a root album (manual albums only). */
  parentId: string | null;
  /** On-disk folder this album mirrors; `null` for virtual/smart albums. */
  folderPath: string | null;
  count: number;
  /** Thumbnail path of the album's representative photo (gallery cover); null when empty. */
  coverThumbPath: string | null;
}

export interface WatchedFolder {
  id: string;
  path: string;
  addedAt: number;
  active: boolean;
  /** True when this root is a bidirectional mirror of its on-disk folders. */
  mirror: boolean;
}

/**
 * A node in a proposed album hierarchy built from a folder tree (import preview).
 * Each node is a candidate album: `mediaCount` is the media assigned directly to
 * it and `children` are its sub-albums. Recursive.
 */
export interface FolderPreview {
  name: string;
  path: string;
  mediaCount: number;
  children: FolderPreview[];
}

export interface TimelineSection {
  date: string; // YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  count: number;
}

export interface LibraryStats {
  total: number;
  favorites: number;
  raw: number;
  videos: number;
  pendingThumbs: number;
  tags: number;
  albums: number;
}

export interface AppConfig {
  cacheDir: string | null;
  thumbnailSize: number;
  thumbnailQuality: number;
  workerThreads: number;
  language: string;
  theme: Theme;
  /** Destination folder (external drive) for USB-device backups. */
  backupDestination: string | null;
  /** Auto-open the backup prompt when a device with photos is connected. */
  autoBackupPrompt: boolean;
  /** Default folder-management mode chosen at first import: `"mirror"` |
   * `"virtual"`, or `null` until the user picks (triggers the choice modal). */
  folderSyncMode: string | null;
  /** On-device face recognition ("People") turned on. */
  faceRecognitionEnabled: boolean;
}

export interface AiStatus {
  enabled: boolean;
  embedders: number;
  detectors: number;
}

// --- Faces / People (on-device face recognition) ---

/** A face crop reference: a photo thumbnail + the face's normalized bbox. The
 * UI crops the thumbnail to the box via CSS (no separate crop files). */
export interface FaceThumb {
  faceId: string;
  photoId: string;
  thumbPath: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Photo's display-oriented pixel dimensions, for an undistorted square crop. */
  photoW: number;
  photoH: number;
}

/** A person = a cluster of faces, optionally named by the user. */
export interface PersonSummary {
  id: string;
  name: string | null;
  faceCount: number;
  isHidden: boolean;
  cover: FaceThumb | null;
}

/** One detected face within a photo (overlays / corrections). */
export interface FaceBox {
  id: string;
  personId: string | null;
  personName: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  score: number | null;
}

export interface FaceStats {
  people: number;
  namedPeople: number;
  faces: number;
  indexedPhotos: number;
  pendingPhotos: number;
}

/** Full face-feature status for gating + the settings panel. */
export interface FaceStatus {
  enabled: boolean;
  modelsInstalled: boolean;
  running: boolean;
  stats: FaceStats;
}

/** Live face-indexing progress (event payload). */
export interface FaceProgress {
  processed: number;
  total: number;
  faces: number;
  people: number;
  current: string | null;
}

/** Emitted when a face-indexing pass finishes. */
export interface FaceSummary {
  photosProcessed: number;
  facesDetected: number;
  people: number;
  failed: number;
  durationMs: number;
  /** Set when the run aborted before completing; null on a normal finish. */
  error: string | null;
}

// --- Query contract ---

export type SortBy = "takenAt" | "importedAt" | "filename" | "rating" | "fileSize" | "timeline";
export type SortDir = "asc" | "desc";

export interface PhotoFilter {
  text?: string | null;
  minRating?: number | null;
  isFavorite?: boolean | null;
  isRaw?: boolean | null;
  mediaType?: string | null;
  cameraModel?: string | null;
  lens?: string | null;
  folder?: string | null;
  /** Match photos whose reverse-geocoded place (city/region/country) contains this text. */
  place?: string | null;
  dateFrom?: number | null;
  dateTo?: number | null;
  tags?: string[];
  albumId?: string | null;
  personId?: string | null;
}

export interface PhotoQuery {
  filter: PhotoFilter;
  sortBy: SortBy;
  sortDir: SortDir;
  offset: number;
  limit: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

// --- Events ---

export type ScanPhase = "discovering" | "indexing" | "thumbnailing" | "idle";

export interface ScanProgress {
  phase: ScanPhase;
  discovered: number;
  indexed: number;
  thumbnailed: number;
  /** Tasks fully processed (indexed *or* thumbnailed); reaches `total` on done. */
  processed: number;
  total: number;
  current: string | null;
}

export interface ScanSummary {
  added: number;
  updated: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

/** A connected removable device that may hold media to back up. */
export interface DeviceInfo {
  /** Root mount path (e.g. `E:\` on Windows). */
  path: string;
  /** Human-readable volume label, or the drive letter when unavailable. */
  label: string;
  /** Rough count of media files found (capped during the probe). */
  mediaCount: number;
}

/** Fast preview of what a device backup would copy vs skip. */
export interface BackupPreview {
  toCopy: number;
  toSkip: number;
  bytes: number;
}

/** Live progress of a running backup. */
export interface BackupProgress {
  processed: number;
  total: number;
  copied: number;
  skipped: number;
  bytesCopied: number;
  current: string | null;
}

/** Summary emitted when a backup run completes. */
export interface BackupSummary {
  copied: number;
  skipped: number;
  failed: number;
  bytesCopied: number;
  durationMs: number;
}

/** Serialized backend error (`core::error::ApiError`). */
export interface ApiError {
  kind: string;
  message: string;
}
