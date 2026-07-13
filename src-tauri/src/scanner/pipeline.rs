//! Stages 2-4 — the parallel index/thumbnail/persist pipeline.
//!
//! Discovery yields a task list; a Rayon pool processes tasks in parallel
//! (EXIF read, image decode, downscale, WebP encode), streaming results over a
//! channel to a single database-writer thread that batches upserts in
//! transactions. Progress is emitted continuously so the UI shows a real
//! progress bar rather than a spinner.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::Instant;

use rayon::prelude::*;
use tracing::warn;

use crate::core::error::{Error, Result};
use crate::core::models::{ColorLabel, Photo, ThumbStatus};
use crate::database::photos;
use crate::events::{self, ScanPhase, ScanSummary};
use crate::metadata::{self, Format};
use crate::scanner::discovery::{self, Task};
use crate::scanner::ScanManager;
use crate::thumbnail::ThumbnailService;

/// Result of processing one task, sent to the DB writer.
enum WorkerResult {
    Indexed {
        photo: Photo,
        is_update: bool,
    },
    Thumbed {
        id: String,
        status: ThumbStatus,
        path: Option<String>,
    },
    Failed,
}

/// Flush granularity for the DB writer (rows per transaction).
const BATCH: usize = 128;

/// Run a full scan of `roots`, returning a summary. Emits progress/`done`
/// events as it goes.
pub fn run(manager: &ScanManager, roots: Vec<PathBuf>) -> Result<ScanSummary> {
    let started = Instant::now();
    let app = manager.app().clone();
    let counters = manager.counters().clone();
    let cfg = manager.config_snapshot();
    let thumb_root = manager.thumb_root();
    let max_edge = cfg.thumbnail_size;
    let now = chrono::Utc::now().timestamp();

    // --- Stage 1: discovery ---
    events::emit(
        &app,
        events::names::SCAN_PROGRESS,
        counters.snapshot(ScanPhase::Discovering, None),
    );
    let tasks = discovery::discover(manager.db(), &thumb_root, &roots)?;
    let total = tasks.len() as u64;
    counters.total.store(total, Ordering::Relaxed);
    counters.discovered.store(total, Ordering::Relaxed);
    events::emit(
        &app,
        events::names::SCAN_PROGRESS,
        counters.snapshot(ScanPhase::Indexing, None),
    );
    if tasks.is_empty() {
        return Ok(ScanSummary {
            added: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            duration_ms: started.elapsed().as_millis(),
        });
    }

    // --- Stages 2-3: parallel processing → channel ---
    let (tx, rx) = mpsc::channel::<WorkerResult>();
    let threads = cfg.effective_threads();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(|i| format!("lumina-scan-{i}"))
        .build()
        .map_err(|e| Error::Other(format!("thread pool: {e}")))?;

    // --- Stage 4: single DB writer thread ---
    let db = manager.db().clone();
    let thumbs = manager.thumbnails().clone();
    let writer_app = app.clone();
    let writer_counters = counters.clone();
    let writer_root = thumb_root.clone();
    let writer = std::thread::spawn(move || -> ScanSummary {
        db_writer(db, thumbs, writer_app, writer_counters, writer_root, rx)
    });

    let thumbs_ref = manager.thumbnails().clone();
    pool.install(|| {
        tasks.par_iter().for_each_with(tx, |tx, task| {
            let result = process_task(task, &thumbs_ref, &thumb_root, max_edge, now);
            let _ = tx.send(result);
        });
    });

    // `tx` is dropped by for_each_with when the pool finishes; join the writer.
    let mut summary = writer
        .join()
        .map_err(|_| Error::Other("db writer panicked".into()))?;
    summary.duration_ms = started.elapsed().as_millis();
    Ok(summary)
}

/// Process a single task off the DB thread (CPU/IO heavy).
fn process_task(
    task: &Task,
    thumbs: &ThumbnailService,
    thumb_root: &Path,
    max_edge: u32,
    now: i64,
) -> WorkerResult {
    match task {
        Task::Index {
            path,
            format,
            id,
            is_update,
        } => match index_one(path, *format, id, thumbs, thumb_root, max_edge, now) {
            Ok(photo) => WorkerResult::Indexed {
                photo,
                is_update: *is_update,
            },
            Err(e) => {
                warn!(path = %path.display(), error = %e, "failed to index file");
                WorkerResult::Failed
            }
        },
        Task::Thumb {
            path,
            id,
            orientation,
        } => {
            match thumbs.ensure(path, thumb_root, id, max_edge, *orientation) {
                Ok(p) => WorkerResult::Thumbed {
                    id: id.clone(),
                    status: ThumbStatus::Ready,
                    path: Some(p.to_string_lossy().to_string()),
                },
                Err(e) => {
                    warn!(path = %path.display(), error = %e, "failed to thumbnail");
                    WorkerResult::Thumbed {
                        id: id.clone(),
                        status: ThumbStatus::Failed,
                        path: None,
                    }
                }
            }
        }
    }
}

/// Build a fully-populated [`Photo`] and (best-effort) its thumbnail.
fn index_one(
    path: &Path,
    format: Format,
    id: &str,
    thumbs: &ThumbnailService,
    thumb_root: &Path,
    max_edge: u32,
    now: i64,
) -> Result<Photo> {
    let path_str = path.to_string_lossy().to_string();
    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let folder = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let file_size = discovery::size_bytes(path);
    let file_created = discovery::created_secs(path);
    let file_modified = discovery::modified_secs(path);

    // Dimensions: cheap header read for decodable image formats only.
    let (width, height) = if format.is_thumbnailable() {
        image::image_dimensions(path).unwrap_or((0, 0))
    } else {
        (0, 0)
    };

    let exif = metadata::read_exif(path).unwrap_or_default();
    let orientation = exif.orientation.unwrap_or(1);
    let taken_at = exif.taken_at.or(file_created);
    let hash = hash_file(path).ok();

    // Thumbnail (skipped for RAW/HEIC/video in the MVP — minimal read only).
    let (thumb_status, thumb_path) = if !format.is_thumbnailable() {
        (ThumbStatus::Failed, None)
    } else {
        // Force regeneration so updated files get fresh thumbnails.
        let dst = ThumbnailService::path_for(thumb_root, id);
        let _ = std::fs::remove_file(&dst);
        match thumbs.ensure(path, thumb_root, id, max_edge, orientation) {
            Ok(p) => (ThumbStatus::Ready, Some(p.to_string_lossy().to_string())),
            Err(e) => {
                warn!(path = %path.display(), error = %e, "thumbnail generation failed");
                (ThumbStatus::Failed, None)
            }
        }
    };

    Ok(Photo {
        id: id.to_string(),
        path: path_str,
        filename,
        folder,
        format: format.as_str().to_string(),
        media_type: format.media_type(),
        taken_at,
        file_created,
        file_modified,
        imported_at: now,
        width,
        height,
        orientation,
        file_size,
        camera_make: exif.camera_make,
        camera_model: exif.camera_model,
        lens: exif.lens,
        iso: exif.iso,
        focal_length: exif.focal_length,
        aperture: exif.aperture,
        shutter_speed: exif.shutter_speed,
        gps_lat: exif.gps_lat,
        gps_lon: exif.gps_lon,
        hash,
        rating: 0,
        color_label: ColorLabel::None,
        is_favorite: false,
        is_raw: format.is_raw_family(),
        thumb_status,
        thumb_path,
        tags: Vec::new(),
    })
}

/// Stream a file through SHA-256 for integrity/dedupe.
fn hash_file(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// The single writer: batches results into transactions and streams progress.
fn db_writer(
    db: crate::database::Database,
    _thumbs: std::sync::Arc<ThumbnailService>,
    app: tauri::AppHandle,
    counters: std::sync::Arc<crate::scanner::ScanCounters>,
    _thumb_root: PathBuf,
    rx: mpsc::Receiver<WorkerResult>,
) -> ScanSummary {
    let mut summary = ScanSummary {
        added: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        duration_ms: 0,
    };
    let mut buffer: Vec<WorkerResult> = Vec::with_capacity(BATCH);

    let flush = |buffer: &mut Vec<WorkerResult>, summary: &mut ScanSummary| {
        if buffer.is_empty() {
            return;
        }
        let conn = match db.get() {
            Ok(c) => c,
            Err(e) => {
                warn!(error = %e, "db writer: cannot get connection");
                buffer.clear();
                return;
            }
        };
        let tx = match conn.unchecked_transaction() {
            Ok(t) => t,
            Err(e) => {
                warn!(error = %e, "db writer: cannot start transaction");
                buffer.clear();
                return;
            }
        };
        for item in buffer.drain(..) {
            match item {
                WorkerResult::Indexed { photo, is_update } => {
                    let ready = matches!(photo.thumb_status, ThumbStatus::Ready);
                    if let Err(e) = photos::upsert(&tx, &photo) {
                        warn!(error = %e, "db writer: upsert failed");
                        summary.failed += 1;
                        continue;
                    }
                    if is_update {
                        summary.updated += 1;
                    } else {
                        summary.added += 1;
                    }
                    counters.indexed.fetch_add(1, Ordering::Relaxed);
                    if ready {
                        counters.thumbnailed.fetch_add(1, Ordering::Relaxed);
                    }
                }
                WorkerResult::Thumbed { id, status, path } => {
                    if let Err(e) = photos::set_thumb(&tx, &id, status, path.as_deref()) {
                        warn!(error = %e, "db writer: set_thumb failed");
                    }
                    if matches!(status, ThumbStatus::Ready) {
                        counters.thumbnailed.fetch_add(1, Ordering::Relaxed);
                    } else {
                        summary.failed += 1;
                    }
                }
                WorkerResult::Failed => summary.failed += 1,
            }
        }
        if let Err(e) = tx.commit() {
            warn!(error = %e, "db writer: commit failed");
        }
        events::emit(
            &app,
            events::names::SCAN_PROGRESS,
            counters.snapshot(ScanPhase::Thumbnailing, None),
        );
        // Progressive refresh so new photos appear as they land.
        events::emit(&app, events::names::LIBRARY_CHANGED, ());
    };

    while let Ok(item) = rx.recv() {
        buffer.push(item);
        if buffer.len() >= BATCH {
            flush(&mut buffer, &mut summary);
        }
    }
    flush(&mut buffer, &mut summary);
    summary
}
