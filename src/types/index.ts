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
  count: number;
}

export interface WatchedFolder {
  id: string;
  path: string;
  addedAt: number;
  active: boolean;
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
}

export interface AiStatus {
  enabled: boolean;
  embedders: number;
  detectors: number;
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
  dateFrom?: number | null;
  dateTo?: number | null;
  tags?: string[];
  albumId?: string | null;
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

/** Serialized backend error (`core::error::ApiError`). */
export interface ApiError {
  kind: string;
  message: string;
}
