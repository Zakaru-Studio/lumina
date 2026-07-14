//! On-device face recognition ("People").
//!
//! A dedicated, self-contained subsystem that detects faces, computes a
//! descriptor per face and groups descriptors into people — **entirely on the
//! user's machine**. The only network access is a one-time download of the two
//! permissively-licensed model files (see [`models`]); photos and embeddings
//! never leave the device.
//!
//! Layout:
//!   * [`engine`] — the ML (YuNet detection + SFace embedding via `tract`).
//!   * [`store`]  — the `persons`/`faces`/`face_index_state` tables + UI queries.
//!   * [`models`] — model-file provisioning (paths + download).
//!   * this file  — [`FaceManager`]: the resumable background indexing job and
//!     the incremental clusterer, mirroring [`crate::scanner::ScanManager`].

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;

use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use tauri::AppHandle;
use tracing::{info, warn};

use crate::ai::cosine_similarity;
use crate::core::config::{AppConfig, Paths};
use crate::core::error::{Error, Result};
use crate::database::{photos, Database};
use crate::events::{self, FaceProgress, FaceSummary};
use crate::thumbnail::decode;

pub mod engine;
pub mod models;
pub mod store;

use engine::{AnalyzedFace, FaceEngine};

/// Cosine-similarity floor for adding a face to an existing cluster. Compared
/// against a cluster's *nearest exemplar* (not a diluted centroid), so it sits a
/// bit above SFace's 0.363 verification threshold: high enough to bias toward
/// *over*-splitting (two clusters for one person is a one-click merge in the UI;
/// merging two different people is the painful mistake to avoid) yet low enough
/// to group varied poses of the same person.
const CLUSTER_THRESHOLD: f32 = 0.45;
/// Max member descriptors kept in memory per cluster for nearest-neighbour
/// matching. Bounds the cost of assignment while covering pose/lighting variety.
const MAX_EXEMPLARS: usize = 16;

/// How often (in processed photos) to emit a progress event.
const PROGRESS_EVERY: u64 = 20;

// ---------------------------------------------------------------------------
// Frontend-facing types
// ---------------------------------------------------------------------------

/// A face crop reference the UI renders (via CSS crop over the photo thumbnail).
/// `photo_w`/`photo_h` are the photo's *display-oriented* pixel dimensions, so
/// the UI can carve a square-in-pixels crop and avoid distorting the face.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceThumb {
    pub face_id: String,
    pub photo_id: String,
    pub thumb_path: Option<String>,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub photo_w: u32,
    pub photo_h: u32,
}

/// A person (cluster) as shown in the People list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonSummary {
    pub id: String,
    pub name: Option<String>,
    pub face_count: i64,
    pub is_hidden: bool,
    pub cover: Option<FaceThumb>,
}

/// A single detected face within a photo (for overlays / corrections).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceBox {
    pub id: String,
    pub person_id: Option<String>,
    pub person_name: Option<String>,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub score: Option<f32>,
}

/// Aggregate face-index counters.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FaceStats {
    pub people: i64,
    pub named_people: i64,
    pub faces: i64,
    pub indexed_photos: i64,
    pub pending_photos: i64,
}

/// Full capability + progress status for the settings panel and feature gating.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceStatus {
    /// User setting: face recognition turned on.
    pub enabled: bool,
    /// Both model files are installed locally.
    pub models_installed: bool,
    /// A background indexing pass is currently running.
    pub running: bool,
    /// Denormalized counts.
    pub stats: FaceStats,
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

/// Owns the (lazily-loaded) ML engine and the background indexing job.
pub struct FaceManager {
    db: Database,
    config: Arc<RwLock<AppConfig>>,
    paths: Arc<RwLock<Paths>>,
    app: AppHandle,
    running: AtomicBool,
    engine: Mutex<Option<Arc<FaceEngine>>>,
}

impl FaceManager {
    pub fn new(
        db: Database,
        config: Arc<RwLock<AppConfig>>,
        paths: Arc<RwLock<Paths>>,
        app: AppHandle,
    ) -> Self {
        Self {
            db,
            config,
            paths,
            app,
            running: AtomicBool::new(false),
            engine: Mutex::new(None),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    fn models_dir(&self) -> std::path::PathBuf {
        self.paths.read().models.clone()
    }

    /// Whether both model files are present on disk (no network).
    pub fn models_installed(&self) -> bool {
        models::models_present(&self.models_dir())
    }

    /// Report status for the UI.
    pub fn status(&self) -> Result<FaceStatus> {
        let conn = self.db.get()?;
        Ok(FaceStatus {
            enabled: self.config.read().face_recognition_enabled,
            models_installed: self.models_installed(),
            running: self.is_running(),
            stats: store::stats(&conn)?,
        })
    }

    /// Ensure the models are downloaded and the engine is loaded (cached).
    /// Blocking; may download ~37 MB on first call.
    pub fn ensure_engine(&self) -> Result<Arc<FaceEngine>> {
        // Hold the lock across the (possibly slow) download + load so two
        // concurrent callers can't both fetch ~37 MB and load the engine twice;
        // the second waits, then observes the cached engine.
        let mut guard = self.engine.lock();
        if let Some(engine) = guard.as_ref() {
            return Ok(Arc::clone(engine));
        }
        let paths = models::ensure_models(&self.models_dir())?;
        info!("loading face models");
        let engine = Arc::new(FaceEngine::load(&paths)?);
        *guard = Some(Arc::clone(&engine));
        Ok(engine)
    }

    /// Ensure models are available (download + load) without indexing — used by
    /// the settings toggle so download failures surface immediately.
    pub fn prepare(&self) -> Result<()> {
        self.ensure_engine().map(|_| ())
    }

    /// Kick off a background indexing pass over all photos still lacking faces.
    /// No-ops if the feature is disabled or a pass is already running.
    pub fn spawn_index(self: &Arc<Self>) {
        if !self.config.read().face_recognition_enabled {
            return;
        }
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            warn!("face indexing already running; ignoring trigger");
            return;
        }
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            let result = this.run_job();
            this.running.store(false, Ordering::SeqCst);
            match result {
                Ok(summary) => {
                    info!(?summary, "face indexing finished");
                    events::emit(&this.app, events::names::FACE_DONE, summary);
                    events::emit(&this.app, events::names::PEOPLE_CHANGED, ());
                }
                Err(e) => {
                    warn!(error = %e, "face indexing failed");
                    // Surface completion (so the UI stops any spinner) *and* the
                    // reason, so the failure isn't silent.
                    events::emit(
                        &this.app,
                        events::names::FACE_DONE,
                        FaceSummary {
                            photos_processed: 0,
                            faces_detected: 0,
                            people: 0,
                            failed: 0,
                            duration_ms: 0,
                            error: Some(e.to_string()),
                        },
                    );
                }
            }
        });
    }

    /// The indexing pass itself: parallel detect+embed → single writer that
    /// stores faces and clusters them incrementally.
    fn run_job(self: &Arc<Self>) -> Result<FaceSummary> {
        let started = std::time::Instant::now();
        let engine = self.ensure_engine()?;

        // If the model / preprocessing version changed since the last run, the
        // stored faces and people are incompatible — wipe them so we rebuild
        // cleanly instead of mixing old (bad) and new descriptors.
        {
            let conn = self.db.get()?;
            if store::model_changed(&conn, models::MODEL_ID)? {
                info!("face pipeline version changed — clearing stale data and rebuilding");
                store::clear_all(&conn)?;
                events::emit(&self.app, events::names::PEOPLE_CHANGED, ());
            }
        }

        let pending = {
            let conn = self.db.get()?;
            store::pending_photo_ids(&conn, i64::MAX)?
        };
        let total = pending.len() as u64;
        if total == 0 {
            return Ok(FaceSummary {
                photos_processed: 0,
                faces_detected: 0,
                people: {
                    let conn = self.db.get()?;
                    store::stats(&conn)?.people as u64
                },
                failed: 0,
                duration_ms: started.elapsed().as_millis(),
                error: None,
            });
        }
        info!(total, "starting face indexing pass");

        // Opening progress event so the UI shows the indicator right away —
        // otherwise the first real update only lands after PROGRESS_EVERY photos,
        // and a run shorter than that would never appear to be running.
        events::emit(
            &self.app,
            events::names::FACE_PROGRESS,
            FaceProgress { processed: 0, total, faces: 0, people: 0, current: None },
        );

        let counters = Arc::new(Counters::default());
        let (tx, rx) = mpsc::channel::<WorkerMsg>();

        // Single writer thread owns clustering state and the write connection.
        let writer = {
            let db = self.db.clone();
            let app = self.app.clone();
            let counters = Arc::clone(&counters);
            std::thread::spawn(move || writer_loop(db, app, rx, total, counters))
        };

        let threads = self.config.read().effective_threads();
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .thread_name(|i| format!("lumina-face-{i}"))
            .build()
            .map_err(|e| Error::Other(format!("cannot build face thread pool: {e}")))?;

        let engine_ref = &engine;
        let db_ref = &self.db;
        pool.install(|| {
            use rayon::prelude::*;
            pending.par_iter().for_each_with(tx, |tx, id| {
                let msg = process_photo(engine_ref, db_ref, id);
                let _ = tx.send(msg);
            });
        });

        let people = writer
            .join()
            .map_err(|_| Error::Other("face writer thread panicked".into()))??;

        Ok(FaceSummary {
            photos_processed: counters.processed.load(Ordering::Relaxed),
            faces_detected: counters.faces.load(Ordering::Relaxed),
            people,
            failed: counters.failed.load(Ordering::Relaxed),
            duration_ms: started.elapsed().as_millis(),
            error: None,
        })
    }

    /// Erase all face data (faces, people, indexing state). Does not change the
    /// enabled setting.
    pub fn clear_data(&self) -> Result<()> {
        let conn = self.db.get()?;
        store::clear_all(&conn)?;
        events::emit(&self.app, events::names::PEOPLE_CHANGED, ());
        Ok(())
    }
}

/// Message from a worker to the writer.
enum WorkerMsg {
    Faces {
        photo_id: String,
        faces: Vec<AnalyzedFace>,
    },
    Failed {
        photo_id: String,
        error: String,
    },
}

#[derive(Default)]
struct Counters {
    processed: AtomicU64,
    faces: AtomicU64,
    failed: AtomicU64,
}

/// Analyze one photo (decode → orient → detect+embed). Runs on a Rayon worker.
fn process_photo(engine: &FaceEngine, db: &Database, photo_id: &str) -> WorkerMsg {
    match analyze_one(engine, db, photo_id) {
        Ok(faces) => WorkerMsg::Faces {
            photo_id: photo_id.to_string(),
            faces,
        },
        Err(e) => WorkerMsg::Failed {
            photo_id: photo_id.to_string(),
            error: e.to_string(),
        },
    }
}

fn analyze_one(engine: &FaceEngine, db: &Database, photo_id: &str) -> Result<Vec<AnalyzedFace>> {
    let photo = {
        let conn = db.get()?;
        photos::get(&conn, photo_id)?
    };
    let path = std::path::PathBuf::from(&photo.path);
    let img = decode::load_displayable(&path)?;
    let img = apply_orientation(img, photo.orientation);
    let rgb = img.to_rgb8();
    engine.analyze(&rgb)
}

/// Bake EXIF orientation into the pixels before detection (mirrors the private
/// helper in `thumbnail::generator`).
fn apply_orientation(img: image::DynamicImage, orientation: u16) -> image::DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

/// The writer loop: consumes analyzed photos, persists faces, clusters them, and
/// emits progress. Returns the final cluster count.
fn writer_loop(
    db: Database,
    app: AppHandle,
    rx: mpsc::Receiver<WorkerMsg>,
    total: u64,
    counters: Arc<Counters>,
) -> Result<u64> {
    let conn = db.get()?;
    let mut clusterer = Clusterer::load(&conn)?;
    let model = models::MODEL_ID;

    for msg in rx {
        let now = chrono::Utc::now().timestamp();
        let current = match &msg {
            WorkerMsg::Faces { photo_id, .. } => photo_id.clone(),
            WorkerMsg::Failed { photo_id, .. } => photo_id.clone(),
        };
        match msg {
            WorkerMsg::Faces { photo_id, faces } => {
                let n = faces.len();
                let tx = conn.unchecked_transaction()?;
                for f in &faces {
                    let face_id = store::insert_face(
                        &tx, &photo_id, f.x, f.y, f.w, f.h, f.score, &f.embedding, model, now,
                    )?;
                    clusterer.assign(&tx, &face_id, &f.embedding, f.score, now)?;
                    counters.faces.fetch_add(1, Ordering::Relaxed);
                }
                store::mark_indexed(&tx, &photo_id, n as i64, model, now)?;
                tx.commit()?;
                counters.processed.fetch_add(1, Ordering::Relaxed);
            }
            WorkerMsg::Failed { photo_id, error } => {
                warn!(photo = %photo_id, error = %error, "face indexing skipped photo");
                let _ = store::mark_failed(&conn, &photo_id, &error, now);
                counters.processed.fetch_add(1, Ordering::Relaxed);
                counters.failed.fetch_add(1, Ordering::Relaxed);
            }
        }

        let processed = counters.processed.load(Ordering::Relaxed);
        if processed % PROGRESS_EVERY == 0 || processed == total {
            events::emit(
                &app,
                events::names::FACE_PROGRESS,
                FaceProgress {
                    processed,
                    total,
                    faces: counters.faces.load(Ordering::Relaxed),
                    people: clusterer.len() as u64,
                    current: Some(current),
                },
            );
        }
    }
    Ok(clusterer.len() as u64)
}

// ---------------------------------------------------------------------------
// Incremental clusterer
// ---------------------------------------------------------------------------

/// A cluster keeps a bounded set of member descriptors ("exemplars"). A face
/// joins the cluster it is closest to *any* exemplar of (single-linkage style),
/// which groups varied poses/lighting of one person better than a diluted
/// centroid — and avoids the failure mode where a loose centroid swallows
/// everyone into one giant cluster.
struct Cluster {
    person_id: String,
    exemplars: Vec<Vec<f32>>,
    count: u32,
    best_score: f32,
}

/// Greedy online nearest-neighbour clusterer seeded from already-assigned faces.
struct Clusterer {
    clusters: Vec<Cluster>,
}

impl Clusterer {
    fn load(conn: &rusqlite::Connection) -> Result<Self> {
        use std::collections::HashMap;
        let mut acc: HashMap<String, (Vec<Vec<f32>>, u32)> = HashMap::new();
        for (pid, emb) in store::assigned_embeddings(conn)? {
            let entry = acc.entry(pid).or_insert_with(|| (Vec::new(), 0));
            if entry.0.len() < MAX_EXEMPLARS {
                entry.0.push(emb);
            }
            entry.1 += 1;
        }
        let clusters = acc
            .into_iter()
            .map(|(person_id, (exemplars, count))| Cluster {
                person_id,
                exemplars,
                count,
                // Existing clusters keep their chosen cover (don't override on resume).
                best_score: 1.0,
            })
            .collect();
        Ok(Self { clusters })
    }

    fn len(&self) -> usize {
        self.clusters.len()
    }

    /// Assign a face to the cluster whose nearest exemplar is above threshold,
    /// or start a new one.
    fn assign(
        &mut self,
        conn: &rusqlite::Connection,
        face_id: &str,
        emb: &[f32],
        score: f32,
        now: i64,
    ) -> Result<()> {
        let mut best: Option<usize> = None;
        let mut best_sim = CLUSTER_THRESHOLD;
        for (i, c) in self.clusters.iter().enumerate() {
            // Nearest-neighbour: closeness to the most similar exemplar.
            let mut sim = -1.0f32;
            for ex in &c.exemplars {
                let s = cosine_similarity(emb, ex);
                if s > sim {
                    sim = s;
                }
            }
            if sim >= best_sim {
                best_sim = sim;
                best = Some(i);
            }
        }

        match best {
            Some(i) => {
                let (person_id, count, becomes_cover) = {
                    let c = &mut self.clusters[i];
                    store::assign_face(conn, face_id, &c.person_id, "auto")?;
                    if c.exemplars.len() < MAX_EXEMPLARS {
                        c.exemplars.push(emb.to_vec());
                    }
                    c.count += 1;
                    let becomes_cover = score > c.best_score;
                    if becomes_cover {
                        c.best_score = score;
                    }
                    (c.person_id.clone(), c.count as i64, becomes_cover)
                };
                conn.execute(
                    "UPDATE persons SET face_count = ?2, updated_at = ?3 WHERE id = ?1",
                    rusqlite::params![person_id, count, now],
                )?;
                if becomes_cover {
                    store::set_person_cover(conn, &person_id, face_id, now)?;
                }
            }
            None => {
                let person_id = store::create_person(conn, face_id, now)?;
                store::assign_face(conn, face_id, &person_id, "auto")?;
                conn.execute(
                    "UPDATE persons SET face_count = 1, updated_at = ?2 WHERE id = ?1",
                    rusqlite::params![person_id, now],
                )?;
                self.clusters.push(Cluster {
                    person_id,
                    exemplars: vec![emb.to_vec()],
                    count: 1,
                    best_score: score,
                });
            }
        }
        Ok(())
    }
}
