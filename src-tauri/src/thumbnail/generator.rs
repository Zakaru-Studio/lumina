//! Thumbnail generation: decode → orient → high-quality downscale → WebP.
//!
//! Downscaling uses `fast_image_resize` (SIMD Lanczos3) for speed and quality.
//! Output is written as WebP to the cache. RAW/HEIC decoding is not attempted
//! in the MVP; such inputs yield [`Error::Unsupported`] and the caller records
//! a `failed` thumbnail status without dropping the catalog entry.

use std::io::Cursor;
use std::path::Path;

use fast_image_resize::images::Image as FirImage;
use fast_image_resize::{PixelType, ResizeOptions, Resizer};
use image::{DynamicImage, ImageFormat, RgbaImage};

use crate::core::error::{Error, Result};

/// Compute the target size that fits `(w, h)` within `max_edge` without
/// upscaling, preserving aspect ratio (min 1px).
fn fit(w: u32, h: u32, max_edge: u32) -> (u32, u32) {
    let longest = w.max(h);
    if longest <= max_edge || longest == 0 {
        return (w.max(1), h.max(1));
    }
    let scale = max_edge as f64 / longest as f64;
    let nw = ((w as f64 * scale).round() as u32).max(1);
    let nh = ((h as f64 * scale).round() as u32).max(1);
    (nw, nh)
}

/// Apply an EXIF orientation (1..8) to a decoded image.
fn apply_orientation(img: DynamicImage, orientation: u16) -> DynamicImage {
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

/// Generate a WebP thumbnail for `src`, writing it to `dst`. `orientation` is
/// the EXIF orientation to bake in; `max_edge` is the longest output edge.
///
/// Returns the `(width, height)` of the generated thumbnail.
pub fn generate(src: &Path, dst: &Path, max_edge: u32, orientation: u16) -> Result<(u32, u32)> {
    // Decode, guessing the real format from magic bytes rather than trusting
    // the file extension (handles e.g. a PNG saved as `.jpg`). Unsupported
    // formats (RAW/HEIC) surface as a clear error.
    let decoded = image::ImageReader::open(src)?
        .with_guessed_format()?
        .decode()
        .map_err(|e| match e {
            image::ImageError::Unsupported(_) => {
                Error::Unsupported(format!("cannot decode {}", src.display()))
            }
            other => Error::Image(other),
        })?;

    let oriented = apply_orientation(decoded, orientation);
    let (w, h) = (oriented.width(), oriented.height());
    let (nw, nh) = fit(w, h, max_edge);

    // Work in RGBA8 for a single, predictable pixel layout.
    let src_rgba: RgbaImage = oriented.to_rgba8();
    let src_image = FirImage::from_vec_u8(w, h, src_rgba.into_raw(), PixelType::U8x4)
        .map_err(|e| Error::Other(format!("resize source error: {e}")))?;
    let mut dst_image = FirImage::new(nw, nh, PixelType::U8x4);

    let mut resizer = Resizer::new();
    resizer
        .resize(&src_image, &mut dst_image, &ResizeOptions::new())
        .map_err(|e| Error::Other(format!("resize error: {e}")))?;

    let out_buf: RgbaImage = image::ImageBuffer::from_raw(nw, nh, dst_image.buffer().to_vec())
        .ok_or_else(|| Error::Other("failed to build thumbnail buffer".into()))?;

    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Encode to WebP (lossless) and persist atomically-ish via a temp file.
    let mut bytes: Vec<u8> = Vec::new();
    DynamicImage::ImageRgba8(out_buf)
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::WebP)?;

    let tmp = dst.with_extension("webp.tmp");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, dst)?;

    Ok((nw, nh))
}
