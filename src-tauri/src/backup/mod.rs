//! Backup module: mirror the photo library onto an external drive, content-first
//! and additive (dedupe by SHA-256, never delete), with durable verified copies.
//!
//! [`BackupManager`] owns the running state, cancel flag and latest progress; the
//! actual copy runs on a dedicated OS thread (fully blocking I/O + hashing) so
//! the async command that starts it returns immediately while progress streams
//! back over events. Mirrors the design of [`crate::scanner::ScanManager`].

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

/// Coordinates background library backups.
pub struct BackupManager {
    db: Database,
    app: AppHandle,
    running: AtomicBool,
    /// Set to request cancellation of the in-flight run; reset when one starts.
    cancel: Arc<AtomicBool>,
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
    pub fn new(db: Database, app: AppHandle) -> Self {
        Self {
            db,
            app,
            running: AtomicBool::new(false),
            cancel: Arc::new(AtomicBool::new(false)),
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

    /// Request cancellation of the running backup. No-op when idle; the loop
    /// stops at the next file boundary and emits a `cancelled` summary.
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Start a background library backup into `dest`. Returns immediately;
    /// progress and completion arrive via events. Ignored if one is already
    /// running.
    pub fn spawn_backup(self: &Arc<Self>, dest: PathBuf) {
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            warn!("backup already running; ignoring request");
            return;
        }
        self.cancel.store(false, Ordering::SeqCst);
        let this = Arc::clone(self);
        let cancel = Arc::clone(&self.cancel);
        std::thread::spawn(move || {
            run::execute(
                this.app.clone(),
                this.db.clone(),
                dest,
                Arc::clone(&this.progress),
                cancel,
            );
            this.running.store(false, Ordering::SeqCst);
        });
    }
}
