//! Album commands, including smart-album resolution.

use std::sync::Arc;

use tauri::State;

use crate::api::{blocking, now};
use crate::core::error::Result;
use crate::core::models::{Album, AlbumKind, Photo};
use crate::core::query::{Page, PhotoQuery};
use crate::core::state::SharedState;
use crate::database::{albums, photos};

#[tauri::command]
pub async fn list_albums(state: State<'_, SharedState>) -> Result<Vec<Album>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        albums::list(&conn, now())
    })
    .await
}

#[tauri::command]
pub async fn get_album(state: State<'_, SharedState>, id: String) -> Result<Album> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        albums::get(&conn, &id, now())
    })
    .await
}

#[tauri::command]
pub async fn create_album(
    state: State<'_, SharedState>,
    name: String,
    parent_id: Option<String>,
) -> Result<Album> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        albums::create(&conn, &name, parent_id.as_deref(), now())
    })
    .await
}

/// Move a manual album under a new parent (`None` = root) and position it at
/// `new_index` among its siblings. Handles reparenting and reordering together.
/// For folder-backed (mirror) albums this ALSO moves the folder on disk.
#[tauri::command]
pub async fn move_album(
    state: State<'_, SharedState>,
    id: String,
    parent_id: Option<String>,
    new_index: usize,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let album = albums::get(&conn, &id, now())?;
        if album.folder_path.is_some() {
            crate::mirror::move_album(&conn, &id, parent_id.as_deref(), new_index)?;
            crate::events::emit(&state.app, crate::events::names::LIBRARY_CHANGED, ());
            Ok(())
        } else {
            albums::reparent(&conn, &id, parent_id.as_deref(), new_index)
        }
    })
    .await
}

/// Rename an album. For folder-backed (mirror) albums this ALSO renames the
/// folder on disk; virtual albums are a pure catalog rename.
#[tauri::command]
pub async fn rename_album(state: State<'_, SharedState>, id: String, name: String) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let album = albums::get(&conn, &id, now())?;
        if album.folder_path.is_some() {
            crate::mirror::rename_album(&conn, &id, &name)?;
            crate::events::emit(&state.app, crate::events::names::LIBRARY_CHANGED, ());
            Ok(())
        } else {
            albums::rename(&conn, &id, &name)
        }
    })
    .await
}

/// Delete an album. For folder-backed (mirror) albums this ALSO sends the folder
/// to the OS trash and soft-deletes its photos; virtual albums are catalog-only.
#[tauri::command]
pub async fn delete_album(state: State<'_, SharedState>, id: String) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let album = albums::get(&conn, &id, now())?;
        if album.folder_path.is_some() {
            crate::mirror::delete_album(&conn, &id)?;
            crate::events::emit(&state.app, crate::events::names::LIBRARY_CHANGED, ());
            Ok(())
        } else {
            albums::delete(&conn, &id)
        }
    })
    .await
}

#[tauri::command]
pub async fn add_to_album(
    state: State<'_, SharedState>,
    album_id: String,
    photo_ids: Vec<String>,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        albums::add_photos(&conn, &album_id, &photo_ids, now())
    })
    .await
}

#[tauri::command]
pub async fn remove_from_album(
    state: State<'_, SharedState>,
    album_id: String,
    photo_ids: Vec<String>,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        albums::remove_photos(&conn, &album_id, &photo_ids)
    })
    .await
}

/// List the photos of an album. Smart albums resolve their rule to a filter;
/// manual albums filter by membership. The incoming query's sort/pagination is
/// respected; its filter is augmented (not replaced) for manual albums.
#[tauri::command]
pub async fn album_photos(
    state: State<'_, SharedState>,
    album_id: String,
    query: PhotoQuery,
) -> Result<Page<Photo>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let album = albums::get(&conn, &album_id, now())?;
        let mut q = query;
        match album.kind {
            AlbumKind::Smart => {
                // The "Duplicates" smart album needs a dedicated hash-grouped
                // query rather than a simple filter.
                if albums::preset_of(&album) == Some("duplicates") {
                    return photos::duplicates(&conn, &q);
                }
                if let Some(rule) = &album.rule {
                    q.filter = albums::resolve_smart_filter(rule, now());
                }
            }
            AlbumKind::Manual => {
                q.filter.album_id = Some(album_id.clone());
            }
        }
        photos::list(&conn, &q)
    })
    .await
}
