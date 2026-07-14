//! Query, filter, sort and pagination types shared by the database and API
//! layers. Kept free of business logic so both sides agree on the contract.

use serde::{Deserialize, Serialize};

/// Sort field for library/timeline listings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortBy {
    TakenAt,
    ImportedAt,
    Filename,
    Rating,
    FileSize,
    /// Chronological day-bucket order used by the timeline view: sorts by the
    /// same `COALESCE(taken_at, imported_at)` key the day sections are grouped
    /// by, so the id list and the sections partition photos identically (photos
    /// without `taken_at` would otherwise sort to the end and desync the two).
    Timeline,
}

impl Default for SortBy {
    fn default() -> Self {
        SortBy::TakenAt
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDir {
    Asc,
    Desc,
}

impl Default for SortDir {
    fn default() -> Self {
        SortDir::Desc
    }
}

/// Structured filter applied to photo listings. All fields are optional and
/// combined with logical AND.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoFilter {
    /// Full-text query (FTS5). Empty/`None` disables text filtering.
    pub text: Option<String>,
    /// Minimum star rating (inclusive).
    pub min_rating: Option<u8>,
    pub is_favorite: Option<bool>,
    pub is_raw: Option<bool>,
    pub media_type: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    /// Restrict to a folder prefix.
    pub folder: Option<String>,
    /// Inclusive `taken_at` lower bound (Unix seconds).
    pub date_from: Option<i64>,
    /// Inclusive `taken_at` upper bound (Unix seconds).
    pub date_to: Option<i64>,
    /// Restrict to photos carrying ALL of these tag names.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Restrict to members of this album.
    pub album_id: Option<String>,
}

/// A page request: structured filter + sort + window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoQuery {
    #[serde(default)]
    pub filter: PhotoFilter,
    #[serde(default)]
    pub sort_by: SortBy,
    #[serde(default)]
    pub sort_dir: SortDir,
    #[serde(default)]
    pub offset: i64,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    200
}

impl Default for PhotoQuery {
    fn default() -> Self {
        Self {
            filter: PhotoFilter::default(),
            sort_by: SortBy::default(),
            sort_dir: SortDir::default(),
            offset: 0,
            limit: default_limit(),
        }
    }
}

impl PhotoQuery {
    /// Clamp pagination to safe bounds (defensive against hostile input).
    pub fn sanitized(mut self) -> Self {
        self.limit = self.limit.clamp(1, 1000);
        self.offset = self.offset.max(0);
        self
    }
}

/// A page of results plus the total count for the same filter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
}
