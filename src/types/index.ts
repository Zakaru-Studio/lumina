/**
 * Shared data contract mirroring the Rust backend (`src-tauri/src/core`).
 *
 * These types are the single source of truth on the frontend. They match the
 * camelCase JSON produced by the backend's `serde(rename_all = "camelCase")`.
 */

export type MediaType = "photo" | "video";

export type ColorLabel = "none" | "red" | "yellow" | "green" | "blue" | "purple";

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
  colorLabel: ColorLabel;
  isFavorite: boolean;
  isRaw: boolean;
  thumbStatus: ThumbStatus;
  thumbPath: string | null;
  tags: string[];
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
  count: number;
}

export interface WatchedFolder {
  id: string;
  path: string;
  addedAt: number;
  active: boolean;
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

export type SortBy = "takenAt" | "importedAt" | "filename" | "rating" | "fileSize";
export type SortDir = "asc" | "desc";

export interface PhotoFilter {
  text?: string | null;
  minRating?: number | null;
  colorLabel?: string | null;
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
