//! Backup module: copy media from a connected device onto an external drive,
//! deduping by content hash so nothing is stored twice, and fold the result
//! into the library.
//!
//! [`BackupManager`] owns the running state and latest progress; the actual
//! copy runs on a dedicated OS thread (fully blocking I/O + hashing) so the
//! async command that starts it returns immediately while progress streams back
//! over events. Mirrors the design of [`crate::scanner::ScanManager`].

pub mod device;
pub mod manifest;
pub mod run;
pub mod scan;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::RwLock;
use tauri::AppHandle;
use tracing::warn;

use crate::database::Database;
use crate::events::BackupProgress;
use crate::scanner::ScanManager;

/// Coordinates background device backups.
pub struct BackupManager {
    db: Database,
    scanner: Arc<ScanManager>,
    app: AppHandle,
    running: AtomicBool,
    progress: Arc<RwLock<BackupProgress>>,
}

/// A zeroed progress snapshot (idle state).
fn idle_progress() -> BackupProgress {
    BackupProgress {
        processed: 0,
        total: 0,
        copied: 0,
        skipped: 0,
        bytes_copied: 0,
        current: None,
    }
}

impl BackupManager {
    pub fn new(db: Database, scanner: Arc<ScanManager>, app: AppHandle) -> Self {
        Self {
            db,
            scanner,
            app,
            running: AtomicBool::new(false),
            progress: Arc::new(RwLock::new(idle_progress())),
        }
    }

    /// True while a backup is in progress.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Latest progress snapshot (for late-subscribing UIs).
    pub fn progress(&self) -> BackupProgress {
        self.progress.read().clone()
    }

    /// Start a background backup from `source` into `dest`. Returns immediately;
    /// progress and completion arrive via events. Ignored if one is already
    /// running.
    pub fn spawn_backup(self: &Arc<Self>, source: PathBuf, dest: PathBuf) {
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            warn!("backup already running; ignoring request");
            return;
        }
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            run::execute(
                this.app.clone(),
                this.db.clone(),
                Arc::clone(&this.scanner),
                source,
                dest,
                Arc::clone(&this.progress),
            );
            this.running.store(false, Ordering::SeqCst);
        });
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::backup::manifest::DestIndex;
    use crate::backup::scan;
    use crate::core::hash::hash_file;

    #[test]
    fn enumerate_filters_and_preview_counts() {
        let src = tempfile::tempdir().unwrap();
        fs::create_dir_all(src.path().join("DCIM")).unwrap();
        fs::write(src.path().join("DCIM/IMG_1.jpg"), b"one").unwrap();
        fs::write(src.path().join("DCIM/IMG_2.png"), b"two").unwrap();
        fs::write(src.path().join("readme.txt"), b"ignored").unwrap();

        let files = scan::enumerate_media(src.path());
        assert_eq!(files.len(), 2, "non-media files are skipped");

        let dest = tempfile::tempdir().unwrap();
        let index = DestIndex::load(dest.path());
        let p = scan::preview(&files, dest.path(), &index);
        assert_eq!(p.to_copy, 2);
        assert_eq!(p.to_skip, 0);

        // Mirror one file onto the destination → it becomes a skip.
        fs::create_dir_all(dest.path().join("DCIM")).unwrap();
        fs::copy(src.path().join("DCIM/IMG_1.jpg"), dest.path().join("DCIM/IMG_1.jpg")).unwrap();
        let p2 = scan::preview(&files, dest.path(), &index);
        assert_eq!(p2.to_copy, 1);
        assert_eq!(p2.to_skip, 1);
    }

    #[test]
    fn index_round_trips_and_dedupes_by_content() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path();

        let a = dest.join("a.jpg");
        fs::write(&a, b"identical bytes").unwrap();
        let ha = hash_file(&a).unwrap();

        let mut index = DestIndex::load(dest);
        assert!(!index.contains_hash(&ha));
        index.insert("a.jpg".into(), 15, 0, ha.clone());
        index.flush().unwrap();

        // Reload from the persisted sidecar: the hash is still known.
        let reloaded = DestIndex::load(dest);
        assert!(reloaded.contains_hash(&ha));

        // A renamed copy with identical content hashes the same → deduped.
        let renamed = dir.path().join("copy-under-another-name.jpg");
        fs::write(&renamed, b"identical bytes").unwrap();
        assert_eq!(hash_file(&renamed).unwrap(), ha);
        assert!(reloaded.contains_hash(&hash_file(&renamed).unwrap()));

        // Different content is not falsely deduped.
        let other = dir.path().join("other.jpg");
        fs::write(&other, b"different bytes").unwrap();
        assert!(!reloaded.contains_hash(&hash_file(&other).unwrap()));
    }
}
