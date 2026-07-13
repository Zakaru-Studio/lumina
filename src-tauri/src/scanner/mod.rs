//! Scanner module: background discovery → index → thumbnail → database
//! pipeline, plus real-time folder watching.
//!
//! The [`ScanManager`] owns the shared services needed to run scans off the UI
//! thread. Scans run on a dedicated OS thread (the work is fully blocking:
//! Rayon CPU parallelism + SQLite), so the async command that starts one
//! returns immediately while progress streams back over events.

pub mod discovery;
pub mod pipeline;
pub mod watcher;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::AppHandle;
use tracing::{info, warn};

use crate::core::config::{AppConfig, Paths};
use crate::database::Database;
use crate::events::{self, ScanPhase, ScanProgress};
use crate::thumbnail::ThumbnailService;

/// Atomic progress counters shared between the worker pool and the emitter.
#[derive(Default)]
pub struct ScanCounters {
    pub discovered: AtomicU64,
    pub indexed: AtomicU64,
    pub thumbnailed: AtomicU64,
    pub total: AtomicU64,
}

impl ScanCounters {
    fn reset(&self) {
        self.discovered.store(0, Ordering::Relaxed);
        self.indexed.store(0, Ordering::Relaxed);
        self.thumbnailed.store(0, Ordering::Relaxed);
        self.total.store(0, Ordering::Relaxed);
    }

    /// Build an event payload for the current phase.
    pub fn snapshot(&self, phase: ScanPhase, current: Option<String>) -> ScanProgress {
        ScanProgress {
            phase,
            discovered: self.discovered.load(Ordering::Relaxed),
            indexed: self.indexed.load(Ordering::Relaxed),
            thumbnailed: self.thumbnailed.load(Ordering::Relaxed),
            total: self.total.load(Ordering::Relaxed),
            current,
        }
    }
}

/// Coordinates background scans and folder watching.
pub struct ScanManager {
    db: Database,
    thumbnails: Arc<ThumbnailService>,
    config: Arc<parking_lot::RwLock<AppConfig>>,
    paths: Arc<parking_lot::RwLock<Paths>>,
    app: AppHandle,
    running: AtomicBool,
    counters: Arc<ScanCounters>,
    /// Keeps the active filesystem watcher alive.
    watcher: Mutex<Option<watcher::WatchHandle>>,
}

impl ScanManager {
    pub fn new(
        db: Database,
        thumbnails: Arc<ThumbnailService>,
        config: Arc<parking_lot::RwLock<AppConfig>>,
        paths: Arc<parking_lot::RwLock<Paths>>,
        app: AppHandle,
    ) -> Self {
        Self {
            db,
            thumbnails,
            config,
            paths,
            app,
            running: AtomicBool::new(false),
            counters: Arc::new(ScanCounters::default()),
            watcher: Mutex::new(None),
        }
    }

    /// True while a scan is in progress.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Current progress snapshot (for late-subscribing UIs).
    pub fn progress(&self) -> ScanProgress {
        let phase = if self.is_running() {
            ScanPhase::Indexing
        } else {
            ScanPhase::Idle
        };
        self.counters.snapshot(phase, None)
    }

    /// Start a background scan of `roots`. Returns immediately; progress and
    /// completion are delivered via events. If a scan is already running the
    /// request is ignored (the watcher will re-trigger later).
    pub fn spawn_scan(self: &Arc<Self>, roots: Vec<PathBuf>) {
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            warn!("scan already running; ignoring request");
            return;
        }
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            this.counters.reset();
            let result = pipeline::run(&this, roots);
            match &result {
                Ok(summary) => info!(?summary, "scan complete"),
                Err(e) => warn!(error = %e, "scan failed"),
            }
            this.running.store(false, Ordering::SeqCst);
            if let Ok(summary) = result {
                events::emit(&this.app, events::names::SCAN_DONE, summary);
            }
            events::emit(&this.app, events::names::LIBRARY_CHANGED, ());
        });
    }

    /// Begin watching the given roots for real-time changes, replacing any
    /// previously installed watcher.
    pub fn start_watching(self: &Arc<Self>, roots: Vec<PathBuf>) {
        match watcher::spawn(self, roots) {
            Ok(handle) => {
                *self.watcher.lock() = Some(handle);
            }
            Err(e) => warn!(error = %e, "failed to start folder watcher"),
        }
    }

    // ---- Accessors used by the pipeline/watcher submodules ----
    pub(crate) fn db(&self) -> &Database {
        &self.db
    }
    pub(crate) fn thumbnails(&self) -> &Arc<ThumbnailService> {
        &self.thumbnails
    }
    pub(crate) fn app(&self) -> &AppHandle {
        &self.app
    }
    pub(crate) fn counters(&self) -> &Arc<ScanCounters> {
        &self.counters
    }
    pub(crate) fn config_snapshot(&self) -> AppConfig {
        self.config.read().clone()
    }
    pub(crate) fn thumb_root(&self) -> PathBuf {
        self.paths.read().thumbnails.clone()
    }
}
