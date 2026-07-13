//! Photo-related Tauri commands: listing, detail, timeline, stats and
//! non-destructive mutations.

use std::sync::Arc;

use tauri::State;

use crate::api::{blocking, now};
use crate::core::error::Result;
use crate::core::models::{ColorLabel, LibraryStats, Photo, TimelineSection};
use crate::core::query::{Page, PhotoFilter, PhotoQuery};
use crate::core::state::SharedState;
use crate::database::photos;

/// List a page of photos matching a structured query.
#[tauri::command]
pub async fn list_photos(state: State<'_, SharedState>, query: PhotoQuery) -> Result<Page<Photo>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::list(&conn, &query)
    })
    .await
}

/// Fetch a single photo (with tags) by id.
#[tauri::command]
pub async fn get_photo(state: State<'_, SharedState>, id: String) -> Result<Photo> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::get(&conn, &id)
    })
    .await
}

/// Count photos matching a filter.
#[tauri::command]
pub async fn count_photos(state: State<'_, SharedState>, filter: PhotoFilter) -> Result<i64> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::count(&conn, &filter)
    })
    .await
}

/// Aggregate per-day timeline sections for a filter.
#[tauri::command]
pub async fn photo_timeline(
    state: State<'_, SharedState>,
    filter: PhotoFilter,
) -> Result<Vec<TimelineSection>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::timeline(&conn, &filter)
    })
    .await
}

/// Library-wide statistics.
#[tauri::command]
pub async fn library_stats(state: State<'_, SharedState>) -> Result<LibraryStats> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::stats(&conn)
    })
    .await
}

/// Set the star rating (0..5) for one or more photos.
#[tauri::command]
pub async fn set_rating(state: State<'_, SharedState>, ids: Vec<String>, rating: u8) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::set_rating(&conn, &ids, rating)
    })
    .await
}

/// Set the color label for one or more photos.
#[tauri::command]
pub async fn set_color(
    state: State<'_, SharedState>,
    ids: Vec<String>,
    color: String,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::set_color(&conn, &ids, ColorLabel::from_str_lenient(&color))
    })
    .await
}

/// Toggle/set the favorite flag for one or more photos.
#[tauri::command]
pub async fn set_favorite(
    state: State<'_, SharedState>,
    ids: Vec<String>,
    favorite: bool,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::set_favorite(&conn, &ids, favorite)
    })
    .await
}

/// Remove photos from the catalog only (never deletes files on disk).
#[tauri::command]
pub async fn remove_photos(state: State<'_, SharedState>, ids: Vec<String>) -> Result<u64> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let removed = photos::soft_delete(&conn, &ids, now())?;
        for id in &ids {
            state.thumbnails.invalidate(id);
        }
        Ok(removed)
    })
    .await
}

/// Restore previously removed photos to the catalog (Undo of `remove_photos`).
#[tauri::command]
pub async fn restore_photos(state: State<'_, SharedState>, ids: Vec<String>) -> Result<u64> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::restore(&conn, &ids)
    })
    .await
}

/// List catalog duplicates (photos sharing an identical content hash).
#[tauri::command]
pub async fn list_duplicates(
    state: State<'_, SharedState>,
    query: PhotoQuery,
) -> Result<Page<Photo>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let q = query.sanitized();
        photos::duplicates(&conn, q.offset, q.limit)
    })
    .await
}

/// Full ordered id list for a query — the backbone for windowed browsing.
#[tauri::command]
pub async fn list_photo_ids(
    state: State<'_, SharedState>,
    query: PhotoQuery,
) -> Result<Vec<String>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::list_ids(&conn, &query)
    })
    .await
}

/// Save an edited image (base64-encoded PNG/JPEG/WebP bytes) as a NEW file at
/// `dest_path`. The original is never modified — this only ever writes a copy.
#[tauri::command]
pub async fn save_edited_image(dest_path: String, data_base64: String) -> Result<String> {
    use base64::Engine;
    blocking(move || {
        // Accept raw base64 or a full data URL (`data:image/...;base64,....`).
        let payload = data_base64
            .split_once(",")
            .map(|(_, b)| b)
            .unwrap_or(&data_base64);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload.trim())
            .map_err(|e| crate::core::error::Error::Invalid(format!("invalid image data: {e}")))?;
        let path = std::path::Path::new(&dest_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, &bytes)?;
        Ok(dest_path)
    })
    .await
}
