//! Persistent index + identity of a backup destination.
//!
//! Both live in a small sidecar directory `<dest>/.lumina-backup/` so they
//! travel with the external drive itself — the content dedupe stays correct even
//! if the Lumina library database is reset or the drive is used on another
//! machine.
//!
//! * `index.json` — every archived file keyed by its destination-relative path,
//!   with its size, mtime and SHA-256, plus a derived set of known hashes. The
//!   backup is **content-addressed and additive**: a source file whose content
//!   hash is already recorded is never re-copied, and nothing is ever removed.
//! * `drive.json` — a stable per-drive UUID (the drive's identity), so the app
//!   recognises "the backup drive" regardless of its current drive letter/label.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::core::error::Result;

/// Directory (under the destination root) that holds the sidecar files.
pub const SIDECAR_DIR: &str = ".lumina-backup";
/// Content-index filename within [`SIDECAR_DIR`].
const INDEX_FILE: &str = "index.json";
/// Drive-identity filename within [`SIDECAR_DIR`].
const DRIVE_FILE: &str = "drive.json";
/// Current on-disk index schema version.
const INDEX_VERSION: u32 = 2;

/// One recorded destination file.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    size: u64,
    mtime: i64,
    hash: String,
    /// When this file was copied (Unix seconds). Optional for back-compat with
    /// the v1 sidecar, which didn't record it.
    #[serde(default)]
    copied_at: i64,
}

/// On-disk shape of `index.json`. The `entries` map (rel-path -> entry) is
/// unchanged from v1, so a v1 sidecar loads without migration; only the version
/// tag is bumped on the next flush.
#[derive(Debug, Default, Serialize, Deserialize)]
struct ManifestFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    entries: HashMap<String, Entry>,
}

/// In-memory destination index used during a backup: O(1) content-membership
/// (`hashes`) plus the per-path metadata needed to detect path collisions.
pub struct DestIndex {
    dest_root: PathBuf,
    by_path: HashMap<String, Entry>,
    hashes: HashSet<String>,
    dirty: bool,
}

impl DestIndex {
    fn index_path(dest_root: &Path) -> PathBuf {
        dest_root.join(SIDECAR_DIR).join(INDEX_FILE)
    }

    /// Load the index for `dest_root`, returning an empty index when the sidecar
    /// is missing or unreadable (a corrupt/absent manifest must never abort a
    /// backup — at worst some already-present files get re-hashed and skipped).
    pub fn load(dest_root: &Path) -> Self {
        let path = Self::index_path(dest_root);
        let file: ManifestFile = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
                warn!(path = %path.display(), error = %e, "backup index corrupt; starting fresh");
                ManifestFile::default()
            }),
            Err(_) => ManifestFile::default(),
        };
        let hashes = file.entries.values().map(|e| e.hash.clone()).collect();
        Self {
            dest_root: dest_root.to_path_buf(),
            by_path: file.entries,
            hashes,
            dirty: false,
        }
    }

    /// True if some already-archived file has this exact content hash. This is
    /// the authoritative "already backed up?" test — additive backups dedupe by
    /// content, not by path.
    pub fn contains_hash(&self, hash: &str) -> bool {
        self.hashes.contains(hash)
    }

    /// Number of recorded files (for tests / diagnostics).
    pub fn len(&self) -> usize {
        self.by_path.len()
    }

    /// True when no files are recorded yet.
    pub fn is_empty(&self) -> bool {
        self.by_path.is_empty()
    }

    /// Record a freshly-copied file. Marks the index dirty for the next flush.
    pub fn insert(&mut self, rel: String, size: u64, mtime: i64, hash: String, now: i64) {
        self.hashes.insert(hash.clone());
        self.by_path.insert(
            rel,
            Entry {
                size,
                mtime,
                hash,
                copied_at: now,
            },
        );
        self.dirty = true;
    }

    /// Persist the index to its sidecar if it has unsaved changes.
    pub fn flush(&mut self) -> Result<()> {
        if !self.dirty {
            return Ok(());
        }
        let dir = self.dest_root.join(SIDECAR_DIR);
        std::fs::create_dir_all(&dir)?;
        let file = ManifestFile {
            version: INDEX_VERSION,
            entries: self.by_path.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&file)?;
        std::fs::write(dir.join(INDEX_FILE), bytes)?;
        self.dirty = false;
        Ok(())
    }
}

/// On-disk shape of `drive.json`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFile {
    id: String,
    created_at: i64,
}

/// The stable identity marker of a backup drive.
pub struct DriveMarker;

impl DriveMarker {
    fn marker_path(dest_root: &Path) -> PathBuf {
        dest_root.join(SIDECAR_DIR).join(DRIVE_FILE)
    }

    /// Read the drive id recorded at `dest_root`, if any.
    pub fn read_id(dest_root: &Path) -> Option<String> {
        let bytes = std::fs::read(Self::marker_path(dest_root)).ok()?;
        serde_json::from_slice::<DriveFile>(&bytes).ok().map(|d| d.id)
    }

    /// Return the drive id at `dest_root`, creating the marker with a fresh UUID
    /// if it doesn't exist yet. Best-effort: a write failure surfaces as an error
    /// so the caller can decide (the backup itself can still proceed).
    pub fn ensure(dest_root: &Path, now: i64) -> Result<String> {
        if let Some(id) = Self::read_id(dest_root) {
            return Ok(id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let dir = dest_root.join(SIDECAR_DIR);
        std::fs::create_dir_all(&dir)?;
        let bytes = serde_json::to_vec_pretty(&DriveFile {
            id: id.clone(),
            created_at: now,
        })?;
        std::fs::write(dir.join(DRIVE_FILE), bytes)?;
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_round_trips_and_dedupes_by_content() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path();

        let mut index = DestIndex::load(dest);
        assert!(index.is_empty());
        index.insert("library/D/a.jpg".into(), 15, 1, "hash-a".into(), 100);
        index.flush().unwrap();

        // Reload from the persisted sidecar: content membership survives.
        let reloaded = DestIndex::load(dest);
        assert_eq!(reloaded.len(), 1);
        assert!(reloaded.contains_hash("hash-a"));
        assert!(!reloaded.contains_hash("hash-b"));
    }

    #[test]
    fn loads_v1_sidecar_without_loss() {
        let dir = tempfile::tempdir().unwrap();
        let sidecar = dir.path().join(SIDECAR_DIR);
        std::fs::create_dir_all(&sidecar).unwrap();
        // A v1 index.json: same entry shape, version 1, no `copiedAt`.
        std::fs::write(
            sidecar.join(INDEX_FILE),
            br#"{"version":1,"entries":{"DCIM/IMG.jpg":{"size":9,"mtime":2,"hash":"deadbeef"}}}"#,
        )
        .unwrap();

        let index = DestIndex::load(dir.path());
        assert_eq!(index.len(), 1);
        assert!(index.contains_hash("deadbeef"), "v1 hashes are honoured");
    }

    #[test]
    fn drive_marker_is_stable() {
        let dir = tempfile::tempdir().unwrap();
        let id1 = DriveMarker::ensure(dir.path(), 1).unwrap();
        let id2 = DriveMarker::ensure(dir.path(), 2).unwrap();
        assert_eq!(id1, id2, "ensure is idempotent");
        assert_eq!(DriveMarker::read_id(dir.path()).as_deref(), Some(id1.as_str()));
    }
}
