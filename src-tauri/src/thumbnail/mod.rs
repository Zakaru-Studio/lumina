//! Thumbnail module: on-disk WebP cache with a sharded layout, an in-memory
//! LRU, and idempotent generation (an existing thumbnail is never recomputed).

pub mod cache;
pub mod decode;
pub mod generator;
pub mod raw;
#[cfg(windows)]
pub mod shell_thumb;
pub mod video;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tracing::debug;

use crate::core::error::Result;
use cache::ThumbCache;

/// Thumbnail service shared via application state.
pub struct ThumbnailService {
    cache: ThumbCache,
}

impl ThumbnailService {
    pub fn new(lru_capacity: usize) -> Self {
        Self {
            cache: ThumbCache::new(lru_capacity),
        }
    }

    /// Absolute path of the cached thumbnail for `id`, sharded by the first two
    /// id characters to keep directories small (important at 300k+ photos).
    pub fn path_for(root: &Path, id: &str) -> PathBuf {
        let shard = id.get(0..2).unwrap_or("00");
        root.join(shard).join(format!("{id}.webp"))
    }

    /// Absolute path of the cached full-size *preview* for `id` (used to display
    /// RAW originals, which the webview cannot decode). Lives beside the grid
    /// thumbnail in the same sharded cache, distinguished by a `.preview` infix.
    pub fn preview_path_for(root: &Path, id: &str) -> PathBuf {
        let shard = id.get(0..2).unwrap_or("00");
        root.join(shard).join(format!("{id}.preview.webp"))
    }

    /// Ensure a large display preview exists for a photo, generating it only if
    /// missing. Returns the absolute path to the WebP file.
    pub fn ensure_preview(
        &self,
        src: &Path,
        root: &Path,
        id: &str,
        max_edge: u32,
        orientation: u16,
    ) -> Result<PathBuf> {
        let dst = Self::preview_path_for(root, id);
        if dst.is_file() {
            return Ok(dst);
        }
        generator::generate(src, &dst, max_edge, orientation)?;
        Ok(dst)
    }

    /// True when a ready thumbnail already exists on disk.
    pub fn exists(root: &Path, id: &str) -> bool {
        Self::path_for(root, id).is_file()
    }

    /// Ensure a thumbnail exists for a photo, generating it only if missing.
    /// Returns the absolute path to the WebP file.
    pub fn ensure(
        &self,
        src: &Path,
        root: &Path,
        id: &str,
        max_edge: u32,
        orientation: u16,
    ) -> Result<PathBuf> {
        let dst = Self::path_for(root, id);
        if dst.is_file() {
            debug!(id, "thumbnail already cached");
            return Ok(dst);
        }
        generator::generate(src, &dst, max_edge, orientation)?;
        Ok(dst)
    }

    /// Read encoded thumbnail bytes for `id`, using the LRU then disk. Returns
    /// `None` if no thumbnail exists yet.
    pub fn read_bytes(&self, root: &Path, id: &str) -> Result<Option<Arc<Vec<u8>>>> {
        if let Some(bytes) = self.cache.get(id) {
            return Ok(Some(bytes));
        }
        let path = Self::path_for(root, id);
        if !path.is_file() {
            return Ok(None);
        }
        let bytes = Arc::new(std::fs::read(&path)?);
        self.cache.put(id.to_string(), bytes.clone());
        Ok(Some(bytes))
    }

    /// Drop cached bytes for `id`.
    pub fn invalidate(&self, id: &str) {
        self.cache.invalidate(id);
    }

    /// Delete every grid thumbnail under `root` (keeping full-size `.preview.webp`
    /// previews) and empty the in-memory LRU. The next scan then rebuilds each
    /// thumbnail at the currently configured size. Best-effort: unreadable
    /// entries are skipped rather than aborting the sweep.
    pub fn clear_grid_thumbnails(&self, root: &Path) -> Result<()> {
        self.cache.clear();
        if !root.is_dir() {
            return Ok(());
        }
        for entry in walkdir::WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.ends_with(".webp") && !name.ends_with(".preview.webp") {
                let _ = std::fs::remove_file(path);
            }
        }
        Ok(())
    }
}
