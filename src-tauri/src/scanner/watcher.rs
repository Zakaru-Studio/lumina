//! Real-time folder watching via `notify` + debouncing.
//!
//! Filesystem events are coalesced over a short window, then translated into
//! incremental scans (for created/modified files) or non-destructive catalog
//! removals (for deleted files). The physical files are never modified.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use tracing::{debug, info, warn};

use crate::core::error::{Error, Result};
use crate::database::{folders, photos};
use crate::events;
use crate::metadata::Format;
use crate::scanner::ScanManager;

/// Opaque handle that keeps the OS watcher alive; dropping it stops watching.
pub struct WatchHandle {
    _debouncer: Debouncer<notify::RecommendedWatcher, FileIdMap>,
}

/// Debounce window for coalescing bursts of filesystem events.
const DEBOUNCE: Duration = Duration::from_secs(2);

/// Start watching `roots` recursively. Returns a handle that must be retained.
pub fn spawn(manager: &Arc<ScanManager>, roots: Vec<PathBuf>) -> Result<WatchHandle> {
    let handler_manager = Arc::clone(manager);
    let mut debouncer = new_debouncer(
        DEBOUNCE,
        None,
        move |result: DebounceEventResult| match result {
            Ok(events) => handle_events(&handler_manager, events),
            Err(errors) => {
                for e in errors {
                    warn!(error = %e, "watch error");
                }
            }
        },
    )
    .map_err(Error::Watch)?;

    for root in &roots {
        if let Err(e) = debouncer
            .watcher()
            .watch(root, RecursiveMode::Recursive)
        {
            warn!(path = %root.display(), error = %e, "failed to watch folder");
        } else {
            info!(path = %root.display(), "watching folder");
        }
    }

    Ok(WatchHandle {
        _debouncer: debouncer,
    })
}

/// Translate a debounced batch of events into scans/removals.
///
/// Events under a MIRROR root are routed to a (debounced-by-notify) full
/// [`reconcile`](crate::mirror::reconcile) of that root — this folds moves,
/// renames and folder-level changes back into the catalog by content hash,
/// rather than the naive per-path soft-delete/scan used for non-mirror roots.
fn handle_events(manager: &Arc<ScanManager>, events: Vec<notify_debouncer_full::DebouncedEvent>) {
    let mirror_roots: Vec<String> = manager
        .db()
        .get()
        .ok()
        .and_then(|c| folders::mirror_roots(&c).ok())
        .unwrap_or_default();

    let mut to_scan: Vec<PathBuf> = Vec::new();
    let mut affected_mirror: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut removed = false;

    for event in events {
        match event.kind {
            EventKind::Remove(_) => {
                for path in &event.event.paths {
                    if let Some(root) = mirror_root_of(path, &mirror_roots) {
                        affected_mirror.insert(root);
                    } else if is_supported(path) {
                        removed |= soft_delete_path(manager, path);
                    }
                }
            }
            EventKind::Create(_) | EventKind::Modify(_) => {
                for path in &event.event.paths {
                    if let Some(root) = mirror_root_of(path, &mirror_roots) {
                        affected_mirror.insert(root);
                    } else if path.is_file() && is_supported(path) {
                        to_scan.push(path.clone());
                    }
                }
            }
            _ => {}
        }
    }

    if removed {
        events::emit(manager.app(), events::names::LIBRARY_CHANGED, ());
    }
    if !to_scan.is_empty() {
        debug!(count = to_scan.len(), "watcher triggering incremental scan");
        manager.spawn_scan(to_scan);
    }
    for root in affected_mirror {
        debug!(path = %root.display(), "watcher triggering mirror reconcile");
        let manager = Arc::clone(manager);
        std::thread::spawn(move || {
            if let Err(e) = crate::mirror::reconcile(&manager, &root) {
                warn!(error = %e, root = %root.display(), "mirror reconcile failed");
            }
        });
    }
}

/// The mirror root (as a `PathBuf`) containing `path`, if any.
fn mirror_root_of(path: &std::path::Path, roots: &[String]) -> Option<PathBuf> {
    let p = path.to_string_lossy();
    crate::mirror::root_of(&p, roots).map(PathBuf::from)
}

/// True when a path has a supported image/RAW extension.
fn is_supported(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .and_then(Format::from_extension)
        .is_some()
}

/// Soft-delete a photo by its path (catalog-only). Returns true if a row was
/// affected.
fn soft_delete_path(manager: &Arc<ScanManager>, path: &std::path::Path) -> bool {
    let path_str = path.to_string_lossy().to_string();
    let conn = match manager.db().get() {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "watcher: cannot get db connection");
            return false;
        }
    };
    match photos::get_by_path(&conn, &path_str) {
        Ok(Some(p)) => {
            let now = chrono::Utc::now().timestamp();
            match photos::soft_delete(&conn, &[p.id.clone()], now) {
                Ok(n) => {
                    manager.thumbnails().invalidate(&p.id);
                    n > 0
                }
                Err(e) => {
                    warn!(error = %e, "watcher: soft delete failed");
                    false
                }
            }
        }
        _ => false,
    }
}
