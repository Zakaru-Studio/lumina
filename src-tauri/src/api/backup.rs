//! Library-backup commands. Long-running work runs in the background and reports
//! via events; these handlers only validate input and hand off.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::api::blocking;
use crate::backup::device;
use crate::backup::manifest::{DestIndex, DriveMarker};
use crate::backup::scan::{self, BackupPreview};
use crate::core::error::{Error, Result};
use crate::core::state::SharedState;
use crate::database::{photos, settings};
use crate::events::{BackupProgress, DeviceInfo};

/// List removable devices currently connected that hold media (diagnostic /
/// legacy helper; the library backup targets the configured destination).
#[tauri::command]
pub async fn list_removable_devices() -> Result<Vec<DeviceInfo>> {
    blocking(|| Ok(device::list_devices())).await
}

/// Preview a library backup into `dest`: how many live photos are new (not yet
/// archived on the drive) vs already present. Fast — a set-difference over
/// stored content hashes, no copying or hashing.
#[tauri::command]
pub async fn preview_backup(state: State<'_, SharedState>, dest: String) -> Result<BackupPreview> {
    if dest.trim().is_empty() {
        return Err(Error::Invalid("a backup destination is required".into()));
    }
    let state = Arc::clone(&state);
    blocking(move || {
        let dest_root = PathBuf::from(&dest);
        let conn = state.db.get()?;
        let items = photos::list_for_backup(&conn)?;
        let index = DestIndex::load(&dest_root);
        Ok(scan::preview(&items, &index))
    })
    .await
}

/// Start backing up the library into `dest`. Returns immediately; progress and
/// completion arrive via `backup://progress` / `backup://done` events. Records
/// the drive's stable identity so it can be recognised on reconnection.
#[tauri::command]
pub async fn start_backup(state: State<'_, SharedState>, dest: String) -> Result<()> {
    if dest.trim().is_empty() {
        return Err(Error::Invalid("a backup destination is required".into()));
    }
    if state.backup.is_running() {
        return Err(Error::Invalid("a backup is already running".into()));
    }
    let dest_path = PathBuf::from(&dest);

    // Ensure the drive-identity marker exists and remember it (+ the destination)
    // in config so the device watcher can recognise this drive next time.
    let st = Arc::clone(&state);
    let marker_dest = dest_path.clone();
    blocking(move || {
        let id = DriveMarker::ensure(&marker_dest, crate::api::now())?;
        let dest_str = marker_dest.to_string_lossy().to_string();
        let mut cfg = st.config_snapshot();
        let changed = cfg.backup_drive_id.as_deref() != Some(&id)
            || cfg.backup_destination.as_deref() != Some(dest_str.as_str());
        if changed {
            cfg.backup_drive_id = Some(id);
            cfg.backup_destination = Some(dest_str);
            let conn = st.db.get()?;
            settings::save_config(&conn, &cfg)?;
            *st.config.write() = cfg;
        }
        Ok(())
    })
    .await?;

    state.backup.spawn_backup(dest_path);
    Ok(())
}

/// Request cancellation of the running backup (no-op if idle). The run stops at
/// the next file boundary and emits a `cancelled` summary.
#[tauri::command]
pub async fn cancel_backup(state: State<'_, SharedState>) -> Result<()> {
    state.backup.cancel();
    Ok(())
}

/// Current backup progress (for late-subscribing UIs / initial render).
#[tauri::command]
pub async fn backup_progress(state: State<'_, SharedState>) -> Result<BackupProgress> {
    let state = Arc::clone(&state);
    Ok(state.backup.progress())
}
