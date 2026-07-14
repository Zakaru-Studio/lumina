//! Photo-related Tauri commands: listing, detail, timeline, stats and
//! non-destructive mutations.

use std::sync::Arc;

use tauri::State;

use crate::api::{blocking, now};
use crate::core::error::Result;
use crate::core::models::{
    DedupePlan, LibraryStats, MapPoint, Photo, ThumbStatus, TimelineSection,
};
use crate::core::query::{Page, PhotoFilter, PhotoQuery};
use crate::core::state::SharedState;
use crate::database::{folders, photos};
use crate::thumbnail::ThumbnailService;

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

/// All geolocated photos as lightweight points for the map view.
#[tauri::command]
pub async fn photos_with_gps(state: State<'_, SharedState>) -> Result<Vec<MapPoint>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::with_gps(&conn)
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

/// Set (or clear, when `lat`/`lon` are `null`) the GPS coordinates of one or more
/// photos. Catalog-only: drives the map and the metadata panel; the original
/// files are left untouched.
#[tauri::command]
pub async fn set_location(
    state: State<'_, SharedState>,
    ids: Vec<String>,
    lat: Option<f64>,
    lon: Option<f64>,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::set_location(&conn, &ids, lat, lon)
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

/// Delete photos from BOTH disk and catalog: sends the original files to the OS
/// trash / Recycle Bin, purges their thumbnails, and drops the catalog rows
/// (cascading to tag/album/AI links). The originals stay recoverable from the
/// system trash, but the catalog rows are dropped and are not restored by this
/// app. Missing files are ignored; the catalog rows are dropped regardless.
/// Returns the count removed.
#[tauri::command]
pub async fn delete_photos_from_disk(
    state: State<'_, SharedState>,
    ids: Vec<String>,
) -> Result<u64> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let root = state.paths_snapshot().thumbnails;
        for id in &ids {
            // Best-effort: move the original to the OS trash. A missing/locked
            // file (or a platform without a trash) must not abort the catalog
            // cleanup for the rest of the batch.
            if let Ok(photo) = photos::get(&conn, id) {
                if let Err(err) = trash::delete(&photo.path) {
                    tracing::warn!(path = %photo.path, %err, "could not move file to trash");
                }
            }
            // Purge the thumbnail on disk and its in-memory cache entry.
            let _ = std::fs::remove_file(ThumbnailService::path_for(&root, id));
            state.thumbnails.invalidate(id);
        }
        photos::hard_delete(&conn, &ids)
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
        photos::duplicates(&conn, &query)
    })
    .await
}

/// Compute a "smart dedupe" proposal: which copy of each duplicate set to keep
/// and which to remove. Advisory only — the UI previews this and the user
/// confirms before anything is removed. `ids` scopes it to a selection (test a
/// subset); omitted, it spans the whole catalog.
#[tauri::command]
pub async fn dedupe_plan(
    state: State<'_, SharedState>,
    ids: Option<Vec<String>>,
) -> Result<DedupePlan> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        photos::dedupe_plan(&conn, ids.as_deref())
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

/// Outcome of a batch capture-date edit, reported back to the UI.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDateSummary {
    /// Files whose capture date was set (catalog override applied). Every format
    /// counts here — the override always takes effect in Lumina.
    pub updated: u32,
    /// Subset of `updated` whose date was also written into the file's EXIF
    /// (JPEG/TIFF/PNG). RAW/HEIC/video get the catalog override only.
    pub exif_written: u32,
    /// Files that errored (missing photo, DB failure).
    pub failed: u32,
}

/// Set the capture date/time for one or more photos. The date is always recorded
/// as a catalog override (marked so rescans preserve it) — this covers every
/// format including RAW and video. Additionally, for formats we can safely
/// rewrite (JPEG/TIFF/PNG) the date is baked into the file's EXIF
/// (`DateTimeOriginal`/`CreateDate`/`ModifyDate`) so other apps see it too; an
/// EXIF-write failure is non-fatal (the catalog override still applies).
/// `timestamp` is Unix seconds, interpreted in LOCAL time to mirror EXIF reads.
#[tauri::command]
pub async fn set_capture_date(
    state: State<'_, SharedState>,
    ids: Vec<String>,
    timestamp: i64,
) -> Result<SetDateSummary> {
    use chrono::TimeZone;
    use crate::metadata::exif_write;

    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        // Interpret the instant in the machine's local zone, matching the EXIF
        // reader, then hand the naive local date-time to the writer.
        let naive = chrono::Local
            .timestamp_opt(timestamp, 0)
            .single()
            .ok_or_else(|| crate::core::error::Error::Invalid("invalid timestamp".into()))?
            .naive_local();

        let mut summary = SetDateSummary { updated: 0, exif_written: 0, failed: 0 };
        for id in &ids {
            let Ok(photo) = photos::get(&conn, id) else {
                summary.failed += 1;
                continue;
            };
            let path = std::path::PathBuf::from(&photo.path);

            // Best-effort: bake the date into the file's EXIF where supported. A
            // failure here must not prevent the catalog override below.
            let mut wrote_exif = false;
            if exif_write::is_editable(&path) {
                match exif_write::set_capture_date(&path, naive) {
                    Ok(()) => wrote_exif = true,
                    Err(e) => tracing::warn!(
                        path = %photo.path, error = %e,
                        "EXIF date write failed; applying catalog override only"
                    ),
                }
            }

            // Always apply the catalog override (survives rescans; covers all
            // formats). Refresh size/mtime from the file (changed iff EXIF written).
            let size = std::fs::metadata(&path)
                .map(|m| m.len() as i64)
                .unwrap_or(photo.file_size);
            let modified = crate::scanner::discovery::modified_secs(&path).or(photo.file_modified);
            match photos::set_taken_at(&conn, id, timestamp, size, modified) {
                Ok(()) => {
                    state.thumbnails.invalidate(id);
                    summary.updated += 1;
                    if wrote_exif {
                        summary.exif_written += 1;
                    }
                }
                Err(_) => summary.failed += 1,
            }
        }
        Ok(summary)
    })
    .await
}

/// Rename a photo. The original file extension is always preserved (appended if
/// the user omitted or changed it), so the name stays stable.
///
/// Under a MIRROR root the file itself is renamed on disk (`parent/new_name`)
/// and the catalog row is relocated in place (id/rating/tags/album links kept;
/// the thumbnail is keyed by id, so it is unaffected). Rejects an existing
/// target. For a VIRTUAL (non-mirror) photo it is a catalog-only relabel: only
/// the `filename` column changes and the file on disk is untouched.
#[tauri::command]
pub async fn rename_photo(
    state: State<'_, SharedState>,
    id: String,
    new_name: String,
) -> Result<()> {
    use crate::core::error::Error;
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let photo = photos::get(&conn, &id)?;

        // Validate the requested name.
        let requested = new_name.trim();
        if requested.is_empty() {
            return Err(Error::Invalid("name must not be empty".into()));
        }
        if requested.contains('/') || requested.contains('\\') {
            return Err(Error::Invalid("name must not contain path separators".into()));
        }

        // Preserve the original extension: keep the requested name only if it
        // already ends with the exact original extension; otherwise append it.
        let old_path = std::path::PathBuf::from(&photo.path);
        let final_name = match old_path.extension().and_then(|e| e.to_str()) {
            Some(ext) => {
                let has_ext = std::path::Path::new(requested)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case(ext))
                    .unwrap_or(false);
                if has_ext {
                    requested.to_string()
                } else {
                    format!("{requested}.{ext}")
                }
            }
            None => requested.to_string(),
        };

        // Mirror root? Compare the photo's path against the active mirror roots.
        let roots = folders::mirror_roots(&conn)?;
        let under_mirror = crate::mirror::root_of(&photo.path, &roots).is_some();

        if under_mirror {
            let parent = old_path
                .parent()
                .ok_or_else(|| Error::Invalid("photo has no parent folder".into()))?;
            let new_path = parent.join(&final_name);
            if new_path == old_path {
                return Ok(());
            }
            if new_path.exists() {
                return Err(Error::Invalid(format!(
                    "a file named '{final_name}' already exists here"
                )));
            }
            let new_path_str = new_path.to_string_lossy().to_string();
            // Filesystem first, then relocate the (single) catalog row in place.
            std::fs::rename(&old_path, &new_path)?;
            if let Err(e) = photos::relocate_prefix(&conn, &photo.path, &new_path_str) {
                // Best-effort rollback so disk and catalog never diverge.
                let _ = std::fs::rename(&new_path, &old_path);
                return Err(e);
            }
        } else {
            photos::set_filename(&conn, &id, &final_name)?;
        }
        crate::events::emit(&state.app, crate::events::names::LIBRARY_CHANGED, ());
        Ok(())
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

/// Encode edited image bytes (a base64 PNG produced by the editor) to AVIF at the
/// given `quality` (1..=100) and write a NEW file at `dest_path`. Browsers can't
/// encode AVIF from a canvas, so the editor hands us a lossless PNG to re-encode.
#[tauri::command]
pub async fn save_avif(dest_path: String, data_base64: String, quality: u8) -> Result<String> {
    use base64::Engine;
    blocking(move || {
        let payload = data_base64
            .split_once(',')
            .map(|(_, b)| b)
            .unwrap_or(&data_base64);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload.trim())
            .map_err(|e| crate::core::error::Error::Invalid(format!("invalid image data: {e}")))?;
        let img = image::load_from_memory(&bytes)
            .map_err(|e| crate::core::error::Error::Invalid(format!("cannot decode image: {e}")))?;
        let path = std::path::Path::new(&dest_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::io::BufWriter::new(std::fs::File::create(path)?);
        // Speed 6 balances encode latency against size for an interactive export.
        let encoder =
            image::codecs::avif::AvifEncoder::new_with_speed_quality(&mut out, 6, quality.clamp(1, 100));
        img.write_with_encoder(encoder)
            .map_err(|e| crate::core::error::Error::Other(format!("avif encode failed: {e}")))?;
        Ok(dest_path)
    })
    .await
}

/// Overwrite a photo's ORIGINAL file in place with edited image bytes
/// (base64/data-URL), then refresh its derived metadata (dimensions,
/// orientation, size) and regenerate its thumbnail. Unlike [`save_edited_image`]
/// this REPLACES the source file — a destructive, irreversible action. Catalog
/// fields (rating, color, favorite, tags, album membership) are preserved.
#[tauri::command]
pub async fn overwrite_original(
    state: State<'_, SharedState>,
    id: String,
    data_base64: String,
) -> Result<()> {
    use base64::Engine;
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let mut photo = photos::get(&conn, &id)?;

        // Accept raw base64 or a full data URL (`data:image/...;base64,....`).
        let payload = data_base64
            .split_once(",")
            .map(|(_, b)| b)
            .unwrap_or(&data_base64);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload.trim())
            .map_err(|e| crate::core::error::Error::Invalid(format!("invalid image data: {e}")))?;

        // Replace the original in place.
        let path = std::path::PathBuf::from(&photo.path);
        std::fs::write(&path, &bytes)?;

        // Refresh derived metadata from the new bytes. The editor bakes any EXIF
        // orientation into the pixels and the canvas export carries no EXIF, so
        // orientation resets to 1.
        if let Ok((w, h)) = image::image_dimensions(&path) {
            photo.width = w;
            photo.height = h;
        }
        photo.orientation = 1;
        photo.file_size = std::fs::metadata(&path)
            .map(|m| m.len() as i64)
            .unwrap_or(photo.file_size);
        // Bump the mtime marker so cache-busted thumbnail/original URLs refresh.
        photo.file_modified = Some(now());

        // Regenerate the thumbnail from the edited file.
        let cfg = state.config_snapshot();
        let root = state.paths_snapshot().thumbnails;
        let dst = ThumbnailService::path_for(&root, &id);
        let _ = std::fs::remove_file(&dst);
        let (status, thumb_path) =
            match state.thumbnails.ensure(&path, &root, &id, cfg.thumbnail_size, 1) {
                Ok(p) => (ThumbStatus::Ready, Some(p.to_string_lossy().to_string())),
                Err(e) => {
                    tracing::warn!(error = %e, "thumbnail regeneration after overwrite failed");
                    (ThumbStatus::Failed, None)
                }
            };
        photo.thumb_status = status;
        photo.thumb_path = thumb_path.clone();

        // Persist. `upsert` refreshes dimensions/orientation/size while
        // preserving catalog fields (ON CONFLICT skips them); it does not touch
        // the thumbnail columns, so `set_thumb` records those separately.
        photos::upsert(&conn, &photo)?;
        photos::set_thumb(&conn, &id, photo.thumb_status, thumb_path.as_deref())?;
        Ok(())
    })
    .await
}
