//! Persistent hash index of a backup destination.
//!
//! Stored as a small JSON sidecar at `<dest>/.lumina-backup/index.json` so it
//! travels with the external drive itself — the content dedupe stays correct
//! even if the Lumina library database is reset or the drive is used on another
//! machine. The index maps each backed-up file (by its path relative to the
//! destination root) to its size, mtime and SHA-256, and keeps a set of known
//! hashes so a source file whose content is already present is never re-copied.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::core::error::Result;

/// Directory (under the destination root) that holds the index sidecar.
const INDEX_DIR: &str = ".lumina-backup";
/// Index filename within [`INDEX_DIR`].
const INDEX_FILE: &str = "index.json";

/// One recorded destination file.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    size: u64,
    mtime: i64,
    hash: String,
}

/// On-disk shape of the sidecar.
#[derive(Debug, Default, Serialize, Deserialize)]
struct ManifestFile {
    /// Schema version, for forward compatibility.
    #[serde(default)]
    version: u32,
    /// relative-path -> entry.
    #[serde(default)]
    entries: HashMap<String, Entry>,
}

/// In-memory destination index used during a backup: fast hash-membership plus
/// the per-path metadata needed to skip re-hashing unchanged files.
pub struct DestIndex {
    dest_root: PathBuf,
    by_path: HashMap<String, Entry>,
    hashes: HashSet<String>,
    dirty: bool,
}

impl DestIndex {
    /// Absolute path of the sidecar for a given destination root.
    fn index_path(dest_root: &Path) -> PathBuf {
        dest_root.join(INDEX_DIR).join(INDEX_FILE)
    }

    /// Load the index for `dest_root`, returning an empty index when the sidecar
    /// is missing or unreadable (a corrupt/absent manifest must never abort a
    /// backup — at worst some already-present files get re-copied once).
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

    /// True if some already-backed-up file has this exact content hash.
    pub fn contains_hash(&self, hash: &str) -> bool {
        self.hashes.contains(hash)
    }

    /// Metadata recorded for a destination-relative path, if any.
    pub fn entry_matches(&self, rel: &str, size: u64) -> bool {
        self.by_path.get(rel).map(|e| e.size == size).unwrap_or(false)
    }

    /// Record a freshly-copied file. Marks the index dirty for the next flush.
    pub fn insert(&mut self, rel: String, size: u64, mtime: i64, hash: String) {
        self.hashes.insert(hash.clone());
        self.by_path.insert(rel, Entry { size, mtime, hash });
        self.dirty = true;
    }

    /// Persist the index to its sidecar if it has unsaved changes.
    pub fn flush(&mut self) -> Result<()> {
        if !self.dirty {
            return Ok(());
        }
        let dir = self.dest_root.join(INDEX_DIR);
        std::fs::create_dir_all(&dir)?;
        let file = ManifestFile {
            version: 1,
            entries: self.by_path.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&file)?;
        std::fs::write(dir.join(INDEX_FILE), bytes)?;
        self.dirty = false;
        Ok(())
    }
}
