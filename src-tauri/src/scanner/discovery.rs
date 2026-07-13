//! Stage 1 — discovery. Recursively walks import roots, classifies files by
//! format and diffs them against the catalog to produce a minimal work list.
//!
//! Unchanged, already-thumbnailed photos produce no task, so re-scanning a
//! large library on startup is cheap.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use walkdir::WalkDir;

use crate::core::error::Result;
use crate::database::{photos, Database};
use crate::metadata::Format;
use crate::thumbnail::ThumbnailService;

/// A unit of work emitted by discovery and consumed by the pipeline.
#[derive(Debug, Clone)]
pub enum Task {
    /// Full (re)index: read metadata + generate thumbnail + upsert.
    Index {
        path: PathBuf,
        format: Format,
        id: String,
        is_update: bool,
    },
    /// Thumbnail-only: metadata already current, just (re)build the WebP.
    Thumb {
        path: PathBuf,
        id: String,
        orientation: u16,
    },
}

/// File modified time as Unix seconds, if available.
pub fn modified_secs(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
}

/// File creation time as Unix seconds, if available.
pub fn created_secs(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .and_then(|m| m.created())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
}

/// File size in bytes, or 0 if unavailable.
pub fn size_bytes(path: &Path) -> i64 {
    std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0)
}

/// Diff a single file against the catalog and produce a task, if any work is
/// required.
pub fn plan_file(
    db: &Database,
    thumb_root: &Path,
    path: &Path,
    format: Format,
) -> Result<Option<Task>> {
    let conn = db.get()?;
    let path_str = path.to_string_lossy().to_string();
    let existing = photos::get_by_path(&conn, &path_str)?;

    match existing {
        None => Ok(Some(Task::Index {
            path: path.to_path_buf(),
            format,
            id: uuid::Uuid::new_v4().to_string(),
            is_update: false,
        })),
        Some(p) => {
            let changed = p.file_size != size_bytes(path) || p.file_modified != modified_secs(path);
            if changed {
                return Ok(Some(Task::Index {
                    path: path.to_path_buf(),
                    format,
                    id: p.id,
                    is_update: true,
                }));
            }
            // Metadata current — ensure a thumbnail exists for decodable formats.
            let thumb_ok = matches!(p.thumb_status, crate::core::models::ThumbStatus::Ready)
                && ThumbnailService::exists(thumb_root, &p.id);
            if !thumb_ok && format.is_thumbnailable() {
                Ok(Some(Task::Thumb {
                    path: path.to_path_buf(),
                    id: p.id,
                    orientation: p.orientation,
                }))
            } else {
                Ok(None)
            }
        }
    }
}

/// Walk `roots` recursively and build the full task list.
pub fn discover(db: &Database, thumb_root: &Path, roots: &[PathBuf]) -> Result<Vec<Task>> {
    let mut tasks = Vec::new();
    for root in roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            let Some(format) = Format::from_extension(ext) else {
                continue;
            };
            if let Some(task) = plan_file(db, thumb_root, path, format)? {
                tasks.push(task);
            }
        }
    }
    Ok(tasks)
}
