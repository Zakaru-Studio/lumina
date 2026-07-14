//! Camera RAW preview extraction (pure Rust, via `rawler`).
//!
//! Rather than demosaicing the sensor data (slow, and colour-processing is a
//! project in itself), we pull the camera-embedded JPEG preview that virtually
//! every RAW file carries — the same image the camera shows on its screen, with
//! correct colours. It decodes straight into an `image::DynamicImage`, so the
//! rest of the thumbnail pipeline (orient → downscale → WebP) is unchanged.

use std::path::Path;

use image::DynamicImage;
use rawler::decoders::RawDecodeParams;
use rawler::get_decoder;
use rawler::rawsource::RawSource;

use crate::core::error::{Error, Result};

/// Decode the largest embedded preview of a RAW file, falling back to the small
/// embedded thumbnail. Returns [`Error::Unsupported`] when the file cannot be
/// parsed or carries no embedded image (the caller then records a failed
/// thumbnail, never dropping the catalog entry).
pub fn embedded_preview(src: &Path) -> Result<DynamicImage> {
    let source = RawSource::new(src)
        .map_err(|e| Error::Unsupported(format!("raw open {}: {e}", src.display())))?;
    let decoder = get_decoder(&source)
        .map_err(|e| Error::Unsupported(format!("raw decoder {}: {e}", src.display())))?;
    let params = RawDecodeParams::default();

    if let Some(img) = decoder
        .preview_image(&source, &params)
        .map_err(|e| Error::Unsupported(format!("raw preview {}: {e}", src.display())))?
    {
        return Ok(img);
    }
    if let Some(img) = decoder
        .thumbnail_image(&source, &params)
        .map_err(|e| Error::Unsupported(format!("raw thumbnail {}: {e}", src.display())))?
    {
        return Ok(img);
    }
    Err(Error::Unsupported(format!(
        "no embedded preview in {}",
        src.display()
    )))
}
