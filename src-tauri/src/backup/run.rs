//! The library backup copy job.
//!
//! Mirrors every live catalog photo onto the destination drive, **content-first
//! and additive**: a photo whose SHA-256 is already recorded on the drive is
//! skipped (even under a different name), new content is copied, and nothing is
//! ever deleted from the drive. Copies are durable — streamed through a temp
//! sibling, fsync'd, re-hashed to verify the write landed intact, then atomically
//! renamed into place — so an interrupted run never leaves a partial file at a
//! real path.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use parking_lot::RwLock;
use tauri::AppHandle;
use tracing::{info, warn};

use crate::backup::manifest::DestIndex;
use crate::core::error::{Error, Result};
use crate::core::hash::{copy_and_hash, hash_file};
use crate::database::photos::BackupItem;
use crate::database::{photos, Database};
use crate::events::{self, BackupProgress, BackupSummary};

/// Emit progress roughly every this many processed files (plus once at the end).
const PROGRESS_EVERY: u64 = 16;
/// Persist the destination index every this many copied files, so an interrupted
/// run still records most of its work.
const FLUSH_EVERY: u64 = 200;
/// Suffix for the in-flight temp file (a sibling of the final target, so the
/// final rename stays on the same volume and is atomic).
const TMP_SUFFIX: &str = ".lumina-tmp";

/// Map an absolute catalog path to its destination-relative layout under the
/// backup's `library/` tree, e.g. `D:\Photos\a.jpg` -> `library/D/Photos/a.jpg`.
/// The full source structure is preserved (drive letter included) so two roots
/// can never collide and a restore is a plain copy-back.
fn dest_rel(abs: &str) -> String {
    let norm = abs.replace('\\', "/");
    let stripped = match norm.split_once(":/") {
        Some((vol, rest)) => format!("{vol}/{rest}"),
        None => norm.trim_start_matches('/').to_string(),
    };
    format!("library/{stripped}")
}

/// Modified time of a path as Unix seconds, or `None` when unavailable.
fn mtime_secs(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
}

/// Pick a non-colliding target: `base` if free, else `name-1.ext`, `name-2.ext`,
/// … next to it. Only reached for an edited-in-place original (same relative
/// path, different content) — the archive keeps both versions.
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

/// The temp sibling path for a final target.
fn tmp_path(final_target: &Path) -> PathBuf {
    let mut s = final_target.as_os_str().to_os_string();
    s.push(TMP_SUFFIX);
    PathBuf::from(s)
}

/// Durably copy `src` to `final_target`: stream into a temp sibling while
/// hashing, fsync it, re-hash it from disk to confirm the write landed intact,
/// then atomically rename into place. Returns `(bytes_written, content_hash)`.
/// On any failure the temp file is removed and nothing is left at `final_target`.
fn safe_copy(src: &Path, final_target: &Path) -> Result<(u64, String)> {
    if let Some(parent) = final_target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = tmp_path(final_target);

    // Stream + hash the source into the temp file, then flush to disk. The file
    // handle is scoped so it's closed before the rename.
    let (streamed_hash, bytes) = {
        let mut f = std::fs::File::create(&tmp)?;
        match copy_and_hash(src, &mut f) {
            Ok(v) => match f.sync_all() {
                Ok(()) => v,
                Err(e) => {
                    let _ = std::fs::remove_file(&tmp);
                    return Err(e.into());
                }
            },
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(e);
            }
        }
    };

    // Verify the bytes actually on the destination match what we streamed — this
    // is what catches a flaky-drive / bad-write corruption.
    match hash_file(&tmp) {
        Ok(dest_hash) if dest_hash == streamed_hash => {}
        Ok(_) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(Error::Other(
                "backup copy verification failed (destination hash mismatch)".into(),
            ));
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    }

    if let Err(e) = std::fs::rename(&tmp, final_target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok((bytes, streamed_hash))
}

/// Resolve a catalog photo's current content hash. Trusts the stored hash only
/// when the file on disk still matches the row's size + mtime; otherwise (stale
/// after an in-place edit, or never hashed) re-hashes the file now. `None` when
/// the file is missing/unreadable.
fn resolve_hash(item: &BackupItem, meta_size: u64, meta_mtime: Option<i64>) -> Option<String> {
    if let Some(h) = &item.hash {
        if item.size as u64 == meta_size && item.mtime == meta_mtime {
            return Some(h.clone());
        }
    }
    hash_file(Path::new(&item.path)).ok()
}

/// The Tauri-free heart of a backup: diff `items` against `dest`'s content index
/// and copy what's new, updating `progress` and calling `emit` to publish it.
/// Returns the run summary. Testable without an app handle.
fn backup_into(
    items: &[BackupItem],
    dest: &Path,
    cancel: &AtomicBool,
    progress: &RwLock<BackupProgress>,
    now: i64,
    mut emit: impl FnMut(),
) -> BackupSummary {
    let started = Instant::now();
    let total = items.len() as u64;
    let mut index = DestIndex::load(dest);

    let mut copied = 0u64;
    let mut skipped = 0u64;
    let mut failed = 0u64;
    let mut bytes_copied = 0u64;
    let mut processed = 0u64;
    let mut cancelled = false;

    *progress.write() = BackupProgress {
        processed: 0,
        total,
        copied: 0,
        skipped: 0,
        bytes_copied: 0,
        current: None,
    };
    emit();

    for item in items {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }

        let src = Path::new(&item.path);
        let filename = src.file_name().map(|n| n.to_string_lossy().to_string());

        // Current on-disk metadata (also proves the source still exists).
        match std::fs::metadata(src) {
            Ok(meta) => {
                let meta_size = meta.len();
                let meta_mtime = mtime_secs(src);
                match resolve_hash(item, meta_size, meta_mtime) {
                    Some(hash) if index.contains_hash(&hash) => skipped += 1,
                    Some(_) => {
                        let rel = dest_rel(&item.path);
                        let target = dest.join(&rel);
                        let final_target = unique_target(&target);
                        match safe_copy(src, &final_target) {
                            Ok((bytes, content_hash)) => {
                                copied += 1;
                                bytes_copied += bytes;
                                let rel_target = final_target
                                    .strip_prefix(dest)
                                    .map(|r| r.to_string_lossy().replace('\\', "/"))
                                    .unwrap_or(rel);
                                index.insert(
                                    rel_target,
                                    meta_size,
                                    meta_mtime.unwrap_or(0),
                                    content_hash,
                                    now,
                                );
                            }
                            Err(e) => {
                                warn!(path = %item.path, error = %e, "backup copy failed");
                                failed += 1;
                            }
                        }
                    }
                    None => {
                        warn!(path = %item.path, "backup: source missing or unreadable");
                        failed += 1;
                    }
                }
            }
            Err(e) => {
                warn!(path = %item.path, error = %e, "backup: source unavailable");
                failed += 1;
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
            emit();
        }
        if copied > 0 && copied % FLUSH_EVERY == 0 {
            if let Err(e) = index.flush() {
                warn!(error = %e, "backup index flush failed");
            }
        }
    }

    if let Err(e) = index.flush() {
        warn!(error = %e, "final backup index flush failed");
    }

    emit();
    BackupSummary {
        copied,
        skipped,
        failed,
        bytes_copied,
        duration_ms: started.elapsed().as_millis(),
        cancelled,
        error: None,
    }
}

/// Run one library backup into `dest`. Blocking; intended to run on a dedicated
/// thread. Streams progress and a final summary over events. Never registers the
/// destination as a library folder (it is a backup, not an import source).
pub fn execute(
    app: AppHandle,
    db: Database,
    dest: PathBuf,
    progress: Arc<RwLock<BackupProgress>>,
    cancel: Arc<AtomicBool>,
) -> BackupSummary {
    // Enumerate the live catalog. A DB failure here aborts before any copy.
    let items = match db.get().and_then(|conn| photos::list_for_backup(&conn)) {
        Ok(items) => items,
        Err(e) => {
            warn!(error = %e, "backup: could not enumerate the catalog");
            let summary = BackupSummary {
                copied: 0,
                skipped: 0,
                failed: 0,
                bytes_copied: 0,
                duration_ms: 0,
                cancelled: false,
                error: Some(e.to_string()),
            };
            events::emit(&app, events::names::BACKUP_DONE, summary.clone());
            return summary;
        }
    };

    // Publish the current progress snapshot; `backup_into` decides how often.
    let emit = || {
        let snap = progress.read().clone();
        events::emit(&app, events::names::BACKUP_PROGRESS, snap);
    };

    let summary = backup_into(&items, &dest, &cancel, &progress, crate::api::now(), emit);
    events::emit(&app, events::names::BACKUP_DONE, summary.clone());
    info!(?summary, dest = %dest.display(), "library backup complete");
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::photos::BackupItem;

    /// A `BackupItem` for a real file on disk, with the given (possibly stale)
    /// stored hash/size/mtime.
    fn item(path: &Path, hash: Option<&str>, size: i64, mtime: Option<i64>) -> BackupItem {
        BackupItem {
            path: path.to_string_lossy().to_string(),
            hash: hash.map(str::to_string),
            size,
            mtime,
        }
    }

    /// Run `backup_into` with no throttling/emit and a fresh cancel flag.
    fn run(items: &[BackupItem], dest: &Path) -> BackupSummary {
        let cancel = AtomicBool::new(false);
        let progress = RwLock::new(BackupProgress {
            processed: 0,
            total: 0,
            copied: 0,
            skipped: 0,
            bytes_copied: 0,
            current: None,
        });
        backup_into(items, dest, &cancel, &progress, 0, || {})
    }

    #[test]
    fn dest_rel_preserves_drive_and_structure() {
        assert_eq!(dest_rel("D:\\Photos\\2024\\a.jpg"), "library/D/Photos/2024/a.jpg");
        assert_eq!(dest_rel("/home/u/pics/a.jpg"), "library/home/u/pics/a.jpg");
    }

    #[test]
    fn safe_copy_verifies_and_is_atomic() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.bin");
        std::fs::write(&src, b"some content bytes").unwrap();
        let expect = hash_file(&src).unwrap();

        let target = dir.path().join("out/nested/copy.bin");
        let (bytes, hash) = safe_copy(&src, &target).unwrap();
        assert_eq!(bytes, 18);
        assert_eq!(hash, expect);
        assert!(target.exists());
        assert!(!tmp_path(&target).exists(), "no temp left behind");
        assert_eq!(std::fs::read(&target).unwrap(), b"some content bytes");
    }

    #[test]
    fn copies_new_and_is_idempotent_and_additive() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().join("lib");
        std::fs::create_dir_all(&lib).unwrap();
        let a = lib.join("a.jpg");
        let b = lib.join("b.jpg");
        std::fs::write(&a, b"content-a").unwrap();
        std::fs::write(&b, b"content-b").unwrap();
        let dest = dir.path().join("drive");

        let items = vec![
            item(&a, Some(&hash_file(&a).unwrap()), 9, mtime_secs(&a)),
            item(&b, Some(&hash_file(&b).unwrap()), 9, mtime_secs(&b)),
        ];

        // First run copies both.
        let s1 = run(&items, &dest);
        assert_eq!((s1.copied, s1.skipped, s1.failed), (2, 0, 0));
        assert!(dest.join(dest_rel(&a.to_string_lossy())).exists());

        // Re-run: everything is already archived → 0 copied (idempotent).
        let s2 = run(&items, &dest);
        assert_eq!((s2.copied, s2.skipped, s2.failed), (0, 2, 0));

        // Additive: dropping `b` from the "catalog" never removes it from the drive.
        let s3 = run(&items[..1], &dest);
        assert_eq!((s3.copied, s3.skipped), (0, 1));
        assert!(dest.join(dest_rel(&b.to_string_lossy())).exists(), "backup keeps removed files");
    }

    #[test]
    fn deduplicates_identical_content_under_different_names() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.jpg");
        let b = dir.path().join("copy-of-a.jpg");
        std::fs::write(&a, b"same bytes").unwrap();
        std::fs::write(&b, b"same bytes").unwrap();
        let dest = dir.path().join("drive");
        let h = hash_file(&a).unwrap();

        let s = run(
            &[
                item(&a, Some(&h), 10, mtime_secs(&a)),
                item(&b, Some(&h), 10, mtime_secs(&b)),
            ],
            &dest,
        );
        // Same content → the second is skipped by hash, not re-copied.
        assert_eq!((s.copied, s.skipped), (1, 1));
    }

    #[test]
    fn edited_in_place_is_archived_as_a_new_version() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.jpg");
        std::fs::write(&a, b"v1").unwrap();
        let dest = dir.path().join("drive");

        // v1 backed up.
        run(&[item(&a, Some(&hash_file(&a).unwrap()), 2, mtime_secs(&a))], &dest);

        // Edit in place (new bytes) and back up again with the fresh hash.
        std::fs::write(&a, b"v2-longer").unwrap();
        let s = run(&[item(&a, Some(&hash_file(&a).unwrap()), 9, mtime_secs(&a))], &dest);
        assert_eq!(s.copied, 1, "new content copied");

        // Both versions exist on the drive (original + de-collided sibling).
        let base = dest.join(dest_rel(&a.to_string_lossy()));
        let sibling = base.with_file_name("a-1.jpg");
        assert!(base.exists() && sibling.exists(), "additive keeps both versions");
    }

    #[test]
    fn stale_stored_hash_is_rehashed() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.jpg");
        std::fs::write(&a, b"actual-content").unwrap();
        let dest = dir.path().join("drive");

        // Row claims a wrong hash but a matching size/mtime would be a lie; give a
        // mismatching size so the guard forces a re-hash of the true content.
        let s = run(&[item(&a, Some("deadbeef"), 999, Some(0))], &dest);
        assert_eq!(s.copied, 1);
        // Recorded under the file's real hash → a second run skips it.
        let s2 = run(&[item(&a, Some(&hash_file(&a).unwrap()), 14, mtime_secs(&a))], &dest);
        assert_eq!(s2.skipped, 1);
    }

    #[test]
    fn missing_source_counts_as_failed_not_a_crash() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("drive");
        let ghost = dir.path().join("gone.jpg");
        let s = run(&[item(&ghost, Some("abc"), 3, Some(0))], &dest);
        assert_eq!((s.copied, s.failed), (0, 1));
    }

    #[test]
    fn cancellation_stops_the_loop() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.jpg");
        std::fs::write(&a, b"content-a").unwrap();
        let dest = dir.path().join("drive");
        let cancel = AtomicBool::new(true); // pre-cancelled
        let progress = RwLock::new(BackupProgress {
            processed: 0,
            total: 0,
            copied: 0,
            skipped: 0,
            bytes_copied: 0,
            current: None,
        });
        let s = backup_into(
            &[item(&a, Some(&hash_file(&a).unwrap()), 9, mtime_secs(&a))],
            &dest,
            &cancel,
            &progress,
            0,
            || {},
        );
        assert!(s.cancelled);
        assert_eq!(s.copied, 0);
    }
}
