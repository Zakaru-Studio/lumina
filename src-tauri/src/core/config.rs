//! Application configuration and on-disk paths.
//!
//! User-tunable settings (cache directory, thumbnail size, worker threads,
//! language, theme) are persisted in the `settings` table as a single JSON
//! blob under the key [`SETTINGS_KEY`]. [`AppConfig`] is the typed view.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Settings row key holding the serialized [`AppConfig`].
pub const SETTINGS_KEY: &str = "app_config";

/// UI theme preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    System,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::Dark
    }
}

/// Persisted, user-tunable configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Directory where WebP thumbnails are cached. `None` => platform default.
    pub cache_dir: Option<String>,
    /// Longest edge (px) of generated thumbnails.
    pub thumbnail_size: u32,
    /// WebP quality 1..100 for thumbnails.
    pub thumbnail_quality: u8,
    /// Worker threads for the scan pipeline. `0` => auto (num_cpus).
    pub worker_threads: usize,
    /// UI language code (BCP-47, e.g. `en`, `fr`).
    pub language: String,
    /// UI theme.
    pub theme: Theme,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            cache_dir: None,
            thumbnail_size: 320,
            thumbnail_quality: 82,
            worker_threads: 0,
            language: "en".to_string(),
            theme: Theme::Dark,
        }
    }
}

impl AppConfig {
    /// Effective worker-thread count, resolving `0` to the CPU count.
    pub fn effective_threads(&self) -> usize {
        if self.worker_threads == 0 {
            num_cpus::get().max(1)
        } else {
            self.worker_threads
        }
    }
}

/// Resolved, absolute filesystem paths derived from [`AppConfig`] + platform.
#[derive(Debug, Clone)]
pub struct Paths {
    /// Application data directory (holds the SQLite database).
    pub data_dir: PathBuf,
    /// SQLite database file.
    pub database: PathBuf,
    /// Root directory for the WebP thumbnail cache.
    pub thumbnails: PathBuf,
}

impl Paths {
    /// Resolve paths from a base data directory and the optional cache override.
    pub fn resolve(data_dir: PathBuf, cache_override: Option<&str>) -> Self {
        let thumbnails = match cache_override {
            Some(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
            _ => data_dir.join("thumbnails"),
        };
        Self {
            database: data_dir.join("lumina.db"),
            thumbnails,
            data_dir,
        }
    }
}
