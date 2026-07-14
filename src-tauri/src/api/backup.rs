//! Device-backup commands. Long-running work runs in the background and reports
//! via events; these handlers only validate input and hand off.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::api::blocking;
use crate::backup::manifest::DestIndex;
use crate::backup::scan::{self, BackupPreview};
use crate::backup::device;
use crate::core::error::{Error, Result};
use crate::core::state::SharedState;
use crate::events::{BackupProgress, DeviceInfo};

/// List removable devices currently connected that hold media.
#[tauri::command]
pub async fn list_removable_devices() -> Result<Vec<DeviceInfo>> {
    blocking(|| Ok(device::list_devices())).await
}

/// Preview a backup: how many files are new vs already present on the
/// destination (fast, path+size based — the run does the authoritative
/// content-hash dedupe).
#[tauri::command]
pub async fn preview_backup(source: String, dest: String) -> Result<BackupPreview> {
    if source.trim().is_empty() || dest.trim().is_empty() {
        return Err(Error::Invalid("source and destination are required".into()));
    }
    blocking(move || {
        let source_root = PathBuf::from(&source);
        let dest_root = PathBuf::from(&dest);
        let files = scan::enumerate_media(&source_root);
        let index = DestIndex::load(&dest_root);
        Ok(scan::preview(&files, &dest_root, &index))
    })
    .await
}

/// Start backing up `source` into `dest`. Returns immediately; progress and
/// completion arrive via `backup://progress` / `backup://done` events.
#[tauri::command]
pub async fn start_backup(
    state: State<'_, SharedState>,
    source: String,
    dest: String,
) -> Result<()> {
    if source.trim().is_empty() || dest.trim().is_empty() {
        return Err(Error::Invalid("source and destination are required".into()));
    }
    if state.backup.is_running() {
        return Err(Error::Invalid("a backup is already running".into()));
    }
    state
        .backup
        .spawn_backup(PathBuf::from(source), PathBuf::from(dest));
    Ok(())
}

/// Current backup progress (for late-subscribing UIs / initial render).
#[tauri::command]
pub async fn backup_progress(state: State<'_, SharedState>) -> Result<BackupProgress> {
    let state = Arc::clone(&state);
    Ok(state.backup.progress())
}
