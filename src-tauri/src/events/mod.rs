//! Typed event bus over Tauri's `emit`.
//!
//! Backend tasks (scanner pipeline, watcher, thumbnailer) push progress and
//! change notifications to the frontend through these strongly-typed helpers.
//! Event *names* are centralized so the frontend can subscribe without magic
//! strings drifting out of sync.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tracing::warn;

/// Canonical event channel names. Mirrored by `src/lib/events.ts`.
pub mod names {
    /// Scan pipeline progress updates ([`super::ScanProgress`]).
    pub const SCAN_PROGRESS: &str = "scan://progress";
    /// A scan run finished ([`super::ScanSummary`]).
    pub const SCAN_DONE: &str = "scan://done";
    /// One or more photos were added/updated/removed — the UI should refetch.
    pub const LIBRARY_CHANGED: &str = "library://changed";
    /// A thumbnail became available ([`super::ThumbReady`]).
    pub const THUMB_READY: &str = "thumb://ready";
}

/// Phase of the scan pipeline, surfaced for progress UIs.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanPhase {
    Discovering,
    Indexing,
    Thumbnailing,
    Idle,
}

/// Incremental scan progress payload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: ScanPhase,
    /// Files discovered so far.
    pub discovered: u64,
    /// Files indexed (metadata written) so far.
    pub indexed: u64,
    /// Thumbnails generated so far.
    pub thumbnailed: u64,
    /// Total files known to need processing (best estimate; may grow).
    pub total: u64,
    /// Human-readable current item (e.g. filename), for a status line.
    pub current: Option<String>,
}

/// Emitted once a scan run completes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub added: u64,
    pub updated: u64,
    pub skipped: u64,
    pub failed: u64,
    pub duration_ms: u128,
}

/// Emitted when a photo's thumbnail becomes available.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbReady {
    pub photo_id: String,
    pub thumb_path: String,
}

/// Emit an event, logging (but never propagating) transport failures — a
/// dropped UI notification must not abort a background task.
pub fn emit<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Err(e) = app.emit(event, payload) {
        warn!(%event, error = %e, "failed to emit event");
    }
}
