//! Source decoding: turn any supported input path into a `DynamicImage` ready
//! for the shared orient → downscale → WebP thumbnail pipeline.
//!
//! Standard raster formats decode with the `image` crate; camera RAW files go
//! through [`raw`] (embedded preview); videos go through [`video`] (an ffmpeg
//! poster frame). Formats that can't be decoded surface [`Error::Unsupported`],
//! which the pipeline records as a failed thumbnail without dropping the entry.

use std::path::Path;

use image::DynamicImage;

use crate::core::error::{Error, Result};
use crate::metadata::Format;
use crate::thumbnail::{raw, video};

/// Decode `src` into a full-resolution image suitable for thumbnailing. The
/// input kind is classified by extension; unknown extensions fall back to a
/// content-sniffed raster decode.
pub fn load_displayable(src: &Path) -> Result<DynamicImage> {
    let format = src
        .extension()
        .and_then(|e| e.to_str())
        .and_then(Format::from_extension);

    match format {
        Some(f) if f.is_video() => video_frame(src),
        Some(Format::Raw) => raw_preview(src),
        _ => decode_raster(src),
    }
}

/// Video poster frame: prefer the OS thumbnail provider (no external deps), then
/// fall back to an ffmpeg frame grab if one is available.
fn video_frame(src: &Path) -> Result<DynamicImage> {
    match os_thumbnail(src) {
        Ok(img) => Ok(img),
        Err(_) => video::extract_frame(src),
    }
}

/// RAW preview: prefer the pure-Rust embedded-preview decode, then fall back to
/// the OS thumbnail provider (which may use an installed camera codec).
fn raw_preview(src: &Path) -> Result<DynamicImage> {
    match raw::embedded_preview(src) {
        Ok(img) => Ok(img),
        Err(primary) => os_thumbnail(src).map_err(|_| primary),
    }
}

/// The OS-provided thumbnail (Windows Shell). No-op on other platforms.
#[cfg(windows)]
fn os_thumbnail(src: &Path) -> Result<DynamicImage> {
    crate::thumbnail::shell_thumb::thumbnail(src)
}

#[cfg(not(windows))]
fn os_thumbnail(_src: &Path) -> Result<DynamicImage> {
    Err(Error::Unsupported("no OS thumbnail provider".into()))
}

/// Decode a standard raster image, guessing the real format from magic bytes
/// rather than trusting the extension (handles e.g. a PNG saved as `.jpg`).
fn decode_raster(src: &Path) -> Result<DynamicImage> {
    image::ImageReader::open(src)?
        .with_guessed_format()?
        .decode()
        .map_err(|e| match e {
            image::ImageError::Unsupported(_) => {
                Error::Unsupported(format!("cannot decode {}", src.display()))
            }
            other => Error::Image(other),
        })
}
