//! Domain models shared by every module and serialized to the frontend.
//!
//! These structs are the single source of truth for the data contract. The
//! TypeScript definitions in `src/types/index.ts` mirror them field-for-field
//! (camelCase on the wire via `rename_all`).

use serde::{Deserialize, Serialize};

/// A catalogued photo (or, in future, video) with its indexed metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id: String,
    pub path: String,
    pub filename: String,
    pub folder: String,
    pub format: String,
    pub media_type: MediaType,

    // Timestamps — Unix seconds (UTC). `None` when unknown.
    pub taken_at: Option<i64>,
    pub file_created: Option<i64>,
    pub file_modified: Option<i64>,
    pub imported_at: i64,

    pub width: u32,
    pub height: u32,
    pub orientation: u16,
    pub file_size: i64,

    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<i64>,
    pub focal_length: Option<f64>,
    pub aperture: Option<f64>,
    pub shutter_speed: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,

    pub hash: Option<String>,
    pub rating: u8,
    pub is_favorite: bool,
    pub is_raw: bool,

    pub thumb_status: ThumbStatus,
    pub thumb_path: Option<String>,

    /// Populated on demand (detail view); empty in list projections.
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Media discriminator. Video support is architecture-only in the MVP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaType {
    Photo,
    Video,
}

impl MediaType {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaType::Photo => "photo",
            MediaType::Video => "video",
        }
    }
    pub fn from_str_lenient(s: &str) -> Self {
        match s {
            "video" => MediaType::Video,
            _ => MediaType::Photo,
        }
    }
}

/// Thumbnail generation lifecycle for a photo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThumbStatus {
    Pending,
    Ready,
    Failed,
}

impl ThumbStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ThumbStatus::Pending => "pending",
            ThumbStatus::Ready => "ready",
            ThumbStatus::Failed => "failed",
        }
    }
    pub fn from_str_lenient(s: &str) -> Self {
        match s {
            "ready" => ThumbStatus::Ready,
            "failed" => ThumbStatus::Failed,
            _ => ThumbStatus::Pending,
        }
    }
}

/// A user tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    /// Number of live photos carrying this tag (populated by list queries).
    #[serde(default)]
    pub count: i64,
}

/// An album — either a manual collection or a smart, rule-driven view.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub id: String,
    pub name: String,
    pub kind: AlbumKind,
    /// JSON-encoded [`SmartRule`] for smart albums; `None` for manual albums.
    pub rule: Option<serde_json::Value>,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
    /// Parent album id for nesting (`None` for a root album). Manual albums
    /// only; smart albums always keep this `None`.
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub count: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlbumKind {
    Manual,
    Smart,
}

impl AlbumKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AlbumKind::Manual => "manual",
            AlbumKind::Smart => "smart",
        }
    }
    pub fn from_str_lenient(s: &str) -> Self {
        match s {
            "smart" => AlbumKind::Smart,
            _ => AlbumKind::Manual,
        }
    }
}

/// A monitored import root.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolder {
    pub id: String,
    pub path: String,
    pub added_at: i64,
    pub active: bool,
}

/// One day-bucket of the timeline view.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineSection {
    /// ISO date `YYYY-MM-DD` of the day (local time).
    pub date: String,
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub count: i64,
}

/// A lightweight geolocated point for the map view: just enough to plot a
/// marker and render its thumbnail, without the full [`Photo`] payload. Only
/// photos carrying both GPS coordinates are ever projected into this shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPoint {
    pub id: String,
    pub gps_lat: f64,
    pub gps_lon: f64,
    pub filename: String,
    pub taken_at: Option<i64>,
    pub thumb_path: Option<String>,
}

/// Aggregate library statistics for dashboards / empty states.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total: i64,
    pub favorites: i64,
    pub raw: i64,
    pub videos: i64,
    pub pending_thumbs: i64,
    pub tags: i64,
    pub albums: i64,
}
