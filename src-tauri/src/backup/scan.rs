//! Backup preview + the device media probe.
//!
//! The library backup diffs the **catalog** against the destination's content
//! index, so the "what would this back up?" preview is a cheap set-difference on
//! stored SHA-256 hashes (no filesystem walk, no hashing) — it matches what the
//! authoritative run in [`super::run`] will do, save for the rare file whose
//! stored hash is stale/absent (which the run re-hashes and the preview counts
//! conservatively as "to copy").

use std::path::Path;

use serde::Serialize;
use walkdir::WalkDir;

use crate::backup::manifest::DestIndex;
use crate::database::photos::BackupItem;
use crate::metadata::Format;

/// Preview counts shown before the user commits to a backup.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    /// Live photos whose content isn't on the drive yet (would be copied).
    pub to_copy: u64,
    /// Live photos already archived on the drive (would be skipped).
    pub to_skip: u64,
    /// Total bytes of the files that would be copied.
    pub bytes: u64,
}

/// Fast preview: for each live catalog photo, is its content already on the
/// drive? Uses the stored hash (no hashing); a photo with no stored hash is
/// counted as "to copy" (the run resolves it authoritatively).
pub fn preview(items: &[BackupItem], index: &DestIndex) -> BackupPreview {
    let mut p = BackupPreview::default();
    for it in items {
        let present = it
            .hash
            .as_deref()
            .map(|h| index.contains_hash(h))
            .unwrap_or(false);
        if present {
            p.to_skip += 1;
        } else {
            p.to_copy += 1;
            p.bytes += it.size.max(0) as u64;
        }
    }
    p
}

/// Count media files under a directory (capped) for the device-arrival probe.
/// Stops early once `cap` is reached so probing a large volume stays cheap.
pub fn count_media_capped(source_root: &Path, cap: u64) -> u64 {
    let mut n = 0u64;
    for entry in WalkDir::new(source_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        if let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) {
            if Format::from_extension(ext).is_some() {
                n += 1;
                if n >= cap {
                    break;
                }
            }
        }
    }
    n
}
