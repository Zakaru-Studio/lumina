//! Thumbnail commands.
//!
//! The frontend renders thumbnails directly from disk via the Tauri asset
//! protocol (`convertFileSrc(photo.thumbPath)`) for zero-copy performance.
//! These commands cover the fallback cases: resolving a path when the stored
//! one is stale, and forcing (re)generation on demand.

use std::sync::Arc;

use tauri::State;

use crate::api::blocking;
use crate::core::error::{Error, Result};
use crate::core::models::ThumbStatus;
use crate::core::state::SharedState;
use crate::database::photos;
use crate::thumbnail::ThumbnailService;

/// Return the absolute path of an existing thumbnail, if present on disk.
#[tauri::command]
pub async fn thumbnail_path(state: State<'_, SharedState>, id: String) -> Result<Option<String>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let root = state.paths_snapshot().thumbnails;
        let path = ThumbnailService::path_for(&root, &id);
        Ok(if path.is_file() {
            Some(path.to_string_lossy().to_string())
        } else {
            None
        })
    })
    .await
}

/// Ensure a thumbnail exists for a photo, generating it if needed, and return
/// its absolute path.
#[tauri::command]
pub async fn ensure_thumbnail(state: State<'_, SharedState>, id: String) -> Result<String> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let photo = photos::get(&conn, &id)?;
        let cfg = state.config_snapshot();
        let root = state.paths_snapshot().thumbnails;
        let path = state.thumbnails.ensure(
            std::path::Path::new(&photo.path),
            &root,
            &id,
            cfg.thumbnail_size,
            photo.orientation,
        )?;
        let path_str = path.to_string_lossy().to_string();
        photos::set_thumb(&conn, &id, ThumbStatus::Ready, Some(&path_str))?;
        Ok(path_str)
    })
    .await
    .map_err(|e| match e {
        Error::NotFound(m) => Error::NotFound(m),
        other => other,
    })
}
