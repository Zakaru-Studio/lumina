//! Shared application state, injected into every Tauri command via `State<'_>`.
//!
//! `AppState` owns the long-lived services: the database handle, the live
//! configuration, resolved paths, the background scan manager and the
//! thumbnail service. It is cheap to clone-share because every field is either
//! `Clone` (pool handle) or wrapped in an `Arc`.

use std::sync::Arc;

use parking_lot::RwLock;
use tauri::AppHandle;

use crate::ai::face::FaceManager;
use crate::backup::BackupManager;
use crate::core::config::{AppConfig, Paths};
use crate::database::Database;
use crate::scanner::ScanManager;
use crate::thumbnail::ThumbnailService;

/// Root state container shared across all commands and background tasks.
pub struct AppState {
    /// Tauri handle used to emit events to the frontend.
    pub app: AppHandle,
    /// Database access (r2d2 pool + query modules).
    pub db: Database,
    /// Live, user-tunable configuration.
    pub config: Arc<RwLock<AppConfig>>,
    /// Resolved absolute paths (recomputed when the cache dir changes).
    pub paths: Arc<RwLock<Paths>>,
    /// Background scan/index pipeline manager.
    pub scanner: Arc<ScanManager>,
    /// Thumbnail generation + LRU byte cache.
    pub thumbnails: Arc<ThumbnailService>,
    /// Background device-backup manager.
    pub backup: Arc<BackupManager>,
    /// On-device face recognition ("People") manager.
    pub faces: Arc<FaceManager>,
}

impl AppState {
    pub fn new(
        app: AppHandle,
        db: Database,
        config: Arc<RwLock<AppConfig>>,
        paths: Arc<RwLock<Paths>>,
        scanner: Arc<ScanManager>,
        thumbnails: Arc<ThumbnailService>,
        backup: Arc<BackupManager>,
        faces: Arc<FaceManager>,
    ) -> Self {
        Self {
            app,
            db,
            config,
            paths,
            scanner,
            thumbnails,
            backup,
            faces,
        }
    }

    /// Snapshot the current configuration.
    pub fn config_snapshot(&self) -> AppConfig {
        self.config.read().clone()
    }

    /// Snapshot the current resolved paths.
    pub fn paths_snapshot(&self) -> Paths {
        self.paths.read().clone()
    }
}

/// Convenience alias for the managed, shared state as seen by commands.
pub type SharedState = Arc<AppState>;
