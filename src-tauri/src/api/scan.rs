//! Scanning & watched-folder commands. These start background work and return
//! immediately; progress and completion arrive via events.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::api::{blocking, now};
use crate::core::error::Result;
use crate::core::models::WatchedFolder;
use crate::core::state::SharedState;
use crate::database::folders;
use crate::events::ScanProgress;

/// Import one or more folders: register them, kick off a background scan and
/// (re)install the real-time watcher over all active roots.
#[tauri::command]
pub async fn scan_folders(state: State<'_, SharedState>, paths: Vec<String>) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        for p in &paths {
            folders::add(&conn, p, now())?;
        }
        let roots: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        state.scanner.spawn_scan(roots);
        install_watcher(&state, &conn)?;
        Ok(())
    })
    .await
}

/// Re-scan every registered folder (e.g. after changing thumbnail settings).
#[tauri::command]
pub async fn rescan_library(state: State<'_, SharedState>) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let roots: Vec<PathBuf> = folders::list(&conn)?
            .into_iter()
            .filter(|f| f.active)
            .map(|f| PathBuf::from(f.path))
            .collect();
        if !roots.is_empty() {
            state.scanner.spawn_scan(roots);
        }
        install_watcher(&state, &conn)?;
        Ok(())
    })
    .await
}

/// Regenerate every thumbnail at the current configured size. Clears the grid
/// thumbnail cache, then re-runs the pipeline (which rebuilds the missing
/// thumbnails). Progress is delivered via the usual scan events.
#[tauri::command]
pub async fn regenerate_thumbnails(state: State<'_, SharedState>) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let roots: Vec<PathBuf> = folders::list(&conn)?
            .into_iter()
            .filter(|f| f.active)
            .map(|f| PathBuf::from(f.path))
            .collect();
        if !roots.is_empty() {
            state.scanner.spawn_regenerate_thumbnails(roots);
        }
        Ok(())
    })
    .await
}

/// Current scan progress (for late-subscribing UIs / initial render).
#[tauri::command]
pub async fn scan_progress(state: State<'_, SharedState>) -> Result<ScanProgress> {
    Ok(state.scanner.progress())
}

/// List registered watched folders.
#[tauri::command]
pub async fn list_watched_folders(state: State<'_, SharedState>) -> Result<Vec<WatchedFolder>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        folders::list(&conn)
    })
    .await
}

/// Register a watched folder and scan it.
#[tauri::command]
pub async fn add_watched_folder(
    state: State<'_, SharedState>,
    path: String,
) -> Result<WatchedFolder> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let folder = folders::add(&conn, &path, now())?;
        state.scanner.spawn_scan(vec![PathBuf::from(&folder.path)]);
        install_watcher(&state, &conn)?;
        Ok(folder)
    })
    .await
}

/// Remove a watched folder (imported photos are retained) and refresh watching.
#[tauri::command]
pub async fn remove_watched_folder(state: State<'_, SharedState>, id: String) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        folders::remove(&conn, &id)?;
        install_watcher(&state, &conn)?;
        Ok(())
    })
    .await
}

/// (Re)install the filesystem watcher over all active roots.
pub(crate) fn install_watcher(state: &SharedState, conn: &crate::database::Conn) -> Result<()> {
    let roots: Vec<PathBuf> = folders::list(conn)?
        .into_iter()
        .filter(|f| f.active)
        .map(|f| PathBuf::from(f.path))
        .collect();
    if !roots.is_empty() {
        state.scanner.start_watching(roots);
    }
    Ok(())
}
