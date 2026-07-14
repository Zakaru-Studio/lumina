//! The backup copy job: mirror new files from a source device onto the
//! destination drive, deduping by content hash, then fold the destination into
//! the library.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use parking_lot::RwLock;
use tauri::AppHandle;
use tracing::{info, warn};

use crate::backup::manifest::DestIndex;
use crate::backup::scan;
use crate::core::hash::hash_file;
use crate::database::{folders, Database};
use crate::events::{self, BackupProgress, BackupSummary};
use crate::scanner::ScanManager;

/// Emit progress roughly every this many processed files (plus once at the end).
const PROGRESS_EVERY: u64 = 16;
/// Persist the destination index every this many copied files, so an interrupted
/// run still records most of its work.
const FLUSH_EVERY: u64 = 200;

/// Pick a non-colliding target path: returns `base` if free, else `name-1.ext`,
/// `name-2.ext`, … next to it. Only called when a copy is required.
fn unique_target(base: &Path) -> PathBuf {
    if !base.exists() {
        return base.to_path_buf();
    }
    let parent = base.parent().unwrap_or_else(|| Path::new("."));
    let stem = base
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .to_string();
    let ext = base.extension().and_then(|e| e.to_str()).map(str::to_string);
    for i in 1.. {
        let name = match &ext {
            Some(e) => format!("{stem}-{i}.{e}"),
            None => format!("{stem}-{i}"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("infinite unique-name search")
}

/// Run one backup from `source` into `dest`. Blocking; intended to run on a
/// dedicated thread. Streams progress and a final summary over events, then
/// registers the destination as a watched folder and kicks off a library scan.
pub fn execute(
    app: AppHandle,
    db: Database,
    scanner: Arc<ScanManager>,
    source: PathBuf,
    dest: PathBuf,
    progress: Arc<RwLock<BackupProgress>>,
) -> BackupSummary {
    let started = Instant::now();
    let files = scan::enumerate_media(&source);
    let total = files.len() as u64;
    let mut index = DestIndex::load(&dest);

    let mut copied = 0u64;
    let mut skipped = 0u64;
    let mut failed = 0u64;
    let mut bytes_copied = 0u64;
    let mut processed = 0u64;

    let emit = |progress: &Arc<RwLock<BackupProgress>>| {
        let snap = progress.read().clone();
        events::emit(&app, events::names::BACKUP_PROGRESS, snap);
    };

    *progress.write() = BackupProgress {
        processed: 0,
        total,
        copied: 0,
        skipped: 0,
        bytes_copied: 0,
        current: None,
    };
    emit(&progress);

    for f in files {
        let filename = f
            .path
            .file_name()
            .map(|n| n.to_string_lossy().to_string());

        let target = dest.join(&f.rel);

        // Fast path: same relative path already holds a same-size file → skip
        // without hashing (the common "re-insert the same card" case).
        let fast_present = std::fs::metadata(&target)
            .map(|m| m.len() == f.size)
            .unwrap_or(false)
            || index.entry_matches(&f.rel, f.size);

        let mut did_copy = false;
        if fast_present {
            skipped += 1;
        } else {
            match hash_file(&f.path) {
                Ok(hash) => {
                    if index.contains_hash(&hash) {
                        // Same content already on the drive under another path.
                        skipped += 1;
                    } else {
                        let final_target = unique_target(&target);
                        let copy_result = final_target
                            .parent()
                            .map(std::fs::create_dir_all)
                            .unwrap_or(Ok(()))
                            .and_then(|_| std::fs::copy(&f.path, &final_target));
                        match copy_result {
                            Ok(_) => {
                                copied += 1;
                                bytes_copied += f.size;
                                did_copy = true;
                                let rel_target = final_target
                                    .strip_prefix(&dest)
                                    .map(|r| r.to_string_lossy().replace('\\', "/"))
                                    .unwrap_or_else(|_| f.rel.clone());
                                index.insert(rel_target, f.size, f.mtime, hash);
                            }
                            Err(e) => {
                                warn!(path = %f.path.display(), error = %e, "backup copy failed");
                                failed += 1;
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!(path = %f.path.display(), error = %e, "backup hash failed");
                    failed += 1;
                }
            }
        }

        processed += 1;
        {
            let mut p = progress.write();
            p.processed = processed;
            p.copied = copied;
            p.skipped = skipped;
            p.bytes_copied = bytes_copied;
            p.current = filename;
        }
        if processed % PROGRESS_EVERY == 0 {
            emit(&progress);
        }
        if did_copy && copied % FLUSH_EVERY == 0 {
            if let Err(e) = index.flush() {
                warn!(error = %e, "backup index flush failed");
            }
        }
    }

    if let Err(e) = index.flush() {
        warn!(error = %e, "final backup index flush failed");
    }

    let summary = BackupSummary {
        copied,
        skipped,
        failed,
        bytes_copied,
        duration_ms: started.elapsed().as_millis(),
    };
    emit(&progress);
    events::emit(&app, events::names::BACKUP_DONE, summary.clone());
    info!(?summary, source = %source.display(), dest = %dest.display(), "backup complete");

    // Fold the destination into the library so backed-up photos show up in
    // Lumina. Best-effort: a failure here must not fail the backup itself.
    if copied > 0 {
        match db.get() {
            Ok(conn) => {
                if let Err(e) = folders::add(&conn, &dest.to_string_lossy(), crate::api::now()) {
                    warn!(error = %e, "could not register backup destination as a folder");
                }
            }
            Err(e) => warn!(error = %e, "backup post-scan: db unavailable"),
        }
        scanner.spawn_scan(vec![dest]);
    }

    summary
}
