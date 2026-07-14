//! Settings & capability commands.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::api::blocking;
use crate::core::config::{AppConfig, Paths};
use crate::core::error::Result;
use crate::core::state::SharedState;
use crate::database::settings;

/// Read the current application configuration.
#[tauri::command]
pub async fn get_config(state: State<'_, SharedState>) -> Result<AppConfig> {
    Ok(state.config_snapshot())
}

/// Persist a new configuration and apply side effects (recompute paths and
/// ensure the thumbnail cache directory exists). Returns the applied config.
#[tauri::command]
pub async fn update_config(
    state: State<'_, SharedState>,
    config: AppConfig,
) -> Result<AppConfig> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        settings::save_config(&conn, &config)?;

        // Recompute resolved paths from the (possibly new) cache directory.
        let data_dir = state.paths_snapshot().data_dir;
        let new_paths = Paths::resolve(data_dir, config.cache_dir.as_deref());
        std::fs::create_dir_all(&new_paths.thumbnails)?;

        *state.paths.write() = new_paths;
        *state.config.write() = config.clone();
        Ok(config)
    })
    .await
}

/// AI capability status (architecture-only in the MVP).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub enabled: bool,
    pub embedders: usize,
    pub detectors: usize,
}

/// Report AI availability so the UI can conditionally surface features. Now
/// backed by the on-device face engine: "enabled" once the user has turned on
/// face recognition and the models are installed locally.
#[tauri::command]
pub async fn ai_status(state: State<'_, SharedState>) -> Result<AiStatus> {
    let enabled =
        state.config_snapshot().face_recognition_enabled && state.faces.models_installed();
    Ok(AiStatus {
        enabled,
        embedders: 0,
        detectors: if enabled { 1 } else { 0 },
    })
}
