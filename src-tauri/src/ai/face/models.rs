//! Face-model provisioning: where the two ONNX files live and how to fetch them.
//!
//! Both models are permissively licensed and safe to redistribute commercially:
//!   * **YuNet** (detection) — MIT license.
//!   * **SFace** (recognition/embedding) — Apache-2.0 license.
//!
//! They are downloaded on first enable from a configurable host and cached in
//! the app data dir. Downloading model *weights* is the only network activity
//! the face feature performs; user photos and embeddings never leave the
//! machine.

use std::path::{Path, PathBuf};

use tracing::info;

use crate::core::error::{Error, Result};

/// Detector weights filename (kept identical to the upstream OpenCV Zoo name so
/// a self-hosted mirror can drop the file in unchanged).
pub const DETECTOR_FILE: &str = "face_detection_yunet_2023mar.onnx";
/// Embedder weights filename.
pub const EMBEDDER_FILE: &str = "face_recognition_sface_2021dec.onnx";

/// Stable identifier of the detector+embedder pair AND the pre/post-processing
/// pipeline, stored with every indexed photo. Bump the suffix whenever the
/// preprocessing changes so stored faces are recognized as stale and rebuilt.
/// `-v2`: SFace fed RGB (was BGR) + landmark-space + nearest-neighbour clustering.
pub const MODEL_ID: &str = "yunet2023mar+sface2021dec-v2";

/// Base URL the models are fetched from when missing. Both files are
/// permissively licensed (YuNet: MIT, SFace: Apache-2.0), so you may mirror
/// them next to your updater assets and point this at your own host for a
/// fully self-hosted, offline-after-first-run experience. Defaults to the
/// upstream OpenCV Zoo (served via GitHub's Git-LFS media endpoint).
pub const MODEL_BASE_URL: &str =
    "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models";

const DETECTOR_URL_PATH: &str = "face_detection_yunet/face_detection_yunet_2023mar.onnx";
const EMBEDDER_URL_PATH: &str = "face_recognition_sface/face_recognition_sface_2021dec.onnx";

/// Sanity floor per file (bytes) — guards against a truncated body or an HTML
/// error page being cached as a "model". Real sizes: YuNet ~340 KB, SFace ~37 MB.
const DETECTOR_MIN_BYTES: u64 = 200_000;
const EMBEDDER_MIN_BYTES: u64 = 30_000_000;

/// Resolved on-disk locations of the two model files.
#[derive(Debug, Clone)]
pub struct ModelPaths {
    pub detector: PathBuf,
    pub embedder: PathBuf,
}

impl ModelPaths {
    /// Expected locations inside a models directory.
    pub fn in_dir(dir: &Path) -> Self {
        Self {
            detector: dir.join(DETECTOR_FILE),
            embedder: dir.join(EMBEDDER_FILE),
        }
    }

    /// Whether both files are present and plausibly complete.
    pub fn both_present(&self) -> bool {
        file_ok(&self.detector, DETECTOR_MIN_BYTES) && file_ok(&self.embedder, EMBEDDER_MIN_BYTES)
    }
}

fn file_ok(path: &Path, min: u64) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.len() >= min)
        .unwrap_or(false)
}

/// Report whether both models are already installed in `dir` (no network).
pub fn models_present(dir: &Path) -> bool {
    ModelPaths::in_dir(dir).both_present()
}

/// Ensure both model files exist in `dir`, downloading any that are missing.
/// The only place in the codebase that touches the network — and it strictly
/// *downloads* weights, never uploads anything.
pub fn ensure_models(dir: &Path) -> Result<ModelPaths> {
    std::fs::create_dir_all(dir)?;
    let paths = ModelPaths::in_dir(dir);
    if !file_ok(&paths.detector, DETECTOR_MIN_BYTES) {
        download(
            &format!("{MODEL_BASE_URL}/{DETECTOR_URL_PATH}"),
            &paths.detector,
            DETECTOR_MIN_BYTES,
        )?;
    }
    if !file_ok(&paths.embedder, EMBEDDER_MIN_BYTES) {
        download(
            &format!("{MODEL_BASE_URL}/{EMBEDDER_URL_PATH}"),
            &paths.embedder,
            EMBEDDER_MIN_BYTES,
        )?;
    }
    Ok(paths)
}

fn download(url: &str, dest: &Path, min: u64) -> Result<()> {
    info!(url, dest = %dest.display(), "downloading face model");
    let resp = ureq::get(url)
        .call()
        .map_err(|e| Error::Other(format!("model download failed ({url}): {e}")))?;
    // Stream to a temp file, then atomically rename so a crash mid-download
    // never leaves a half-written model that passes the size check.
    let tmp = dest.with_extension("part");
    {
        let mut reader = resp.into_reader();
        let mut file = std::fs::File::create(&tmp)?;
        std::io::copy(&mut reader, &mut file)?;
    }
    let size = std::fs::metadata(&tmp)?.len();
    if size < min {
        let _ = std::fs::remove_file(&tmp);
        return Err(Error::Other(format!(
            "downloaded model from {url} is too small ({size} bytes) — mirror or connection problem"
        )));
    }
    std::fs::rename(&tmp, dest)?;
    info!(dest = %dest.display(), size, "face model ready");
    Ok(())
}
