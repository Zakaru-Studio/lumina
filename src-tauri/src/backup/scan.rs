//! Source enumeration and the fast backup preview.
//!
//! Enumeration mirrors the scanner's format filter ([`Format::from_extension`]).
//! The preview is intentionally *approximate and fast*: it decides copy-vs-skip
//! by destination path + size only (no source hashing), which is exact for the
//! common "re-insert the same card" case. The authoritative content-hash dedupe
//! (which also catches renamed/moved duplicates) happens during the real run in
//! [`super::run`].

use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

use crate::backup::manifest::DestIndex;
use crate::metadata::Format;

/// A media file found on the source device.
#[derive(Debug, Clone)]
pub struct MediaFile {
    pub path: PathBuf,
    /// Path relative to the source root (drives the mirror layout on the dest).
    pub rel: String,
    pub size: u64,
    pub mtime: i64,
}

/// Preview counts shown before the user commits to a backup.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    /// Files that would be copied (new on the destination).
    pub to_copy: u64,
    /// Files that would be skipped (already present).
    pub to_skip: u64,
    /// Total bytes of the files that would be copied.
    pub bytes: u64,
}

/// Modified time as Unix seconds, or 0 when unavailable.
fn mtime_secs(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Walk `source_root` and return every supported media file with its relative
/// path and basic metadata.
pub fn enumerate_media(source_root: &Path) -> Vec<MediaFile> {
    let mut out = Vec::new();
    for entry in WalkDir::new(source_root)
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
        if Format::from_extension(ext).is_none() {
            continue;
        }
        let Ok(rel) = path.strip_prefix(source_root) else {
            continue;
        };
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        out.push(MediaFile {
            path: path.to_path_buf(),
            rel: rel.to_string_lossy().replace('\\', "/"),
            size,
            mtime: mtime_secs(path),
        });
    }
    out
}

/// Count media files on a device (capped) for the connection prompt. Stops
/// early once `cap` is reached so probing a large card stays cheap.
pub fn count_media_capped(source_root: &Path, cap: u64) -> u64 {
    let mut n = 0u64;
    for entry in WalkDir::new(source_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        if let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) {
            if Format::from_extension(ext).is_some() {
                n += 1;
                if n >= cap {
                    break;
                }
            }
        }
    }
    n
}

/// Whether the mirror target already holds this file (same relative path and
/// size, either on disk or recorded in the index). Fast path — no hashing.
pub fn already_present_fast(file: &MediaFile, dest_root: &Path, index: &DestIndex) -> bool {
    if index.entry_matches(&file.rel, file.size) {
        return true;
    }
    let target = dest_root.join(&file.rel);
    std::fs::metadata(&target)
        .map(|m| m.len() == file.size)
        .unwrap_or(false)
}

/// Fast, path+size-based preview of what a backup would do.
pub fn preview(files: &[MediaFile], dest_root: &Path, index: &DestIndex) -> BackupPreview {
    let mut p = BackupPreview::default();
    for f in files {
        if already_present_fast(f, dest_root, index) {
            p.to_skip += 1;
        } else {
            p.to_copy += 1;
            p.bytes += f.size;
        }
    }
    p
}
