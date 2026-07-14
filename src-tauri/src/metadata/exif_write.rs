//! Writing a corrected capture date/time back into a file's EXIF.
//!
//! `kamadak-exif` (used for reading) is read-only, so writing goes through the
//! pure-Rust `little_exif` crate. We set the three date tags photo apps look at
//! — `DateTimeOriginal`, `DateTimeDigitized` and `DateTime` — so every tool
//! agrees on the capture time. Existing EXIF (camera, GPS, exposure…) is loaded
//! first and preserved.
//!
//! Only JPEG/TIFF/PNG are supported; RAW/HEIC/video containers are rejected with
//! [`Error::Unsupported`] so the caller can skip them cleanly.

use std::path::{Path, PathBuf};

use chrono::NaiveDateTime;
use little_exif::exif_tag::ExifTag;
use little_exif::metadata::Metadata;

use crate::core::error::{Error, Result};
use crate::metadata::Format;

/// Whether an in-place EXIF capture-date write is supported for `format`.
pub fn supports_date_write(format: Format) -> bool {
    matches!(format, Format::Jpeg | Format::Tiff | Format::Png)
}

/// Whether the file at `path` (classified by extension) can have its capture
/// date edited.
pub fn is_editable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .and_then(Format::from_extension)
        .map(supports_date_write)
        .unwrap_or(false)
}

/// Bake `dt` (a naive local date-time, mirroring how EXIF is read) into `path`'s
/// EXIF as the three standard date tags. Other EXIF fields are preserved.
///
/// The write is done on a temporary sibling copy and then atomically renamed
/// over the original, so a crash mid-write can never leave a corrupted file.
pub fn set_capture_date(path: &Path, dt: NaiveDateTime) -> Result<()> {
    if !is_editable(path) {
        return Err(Error::Unsupported(format!(
            "capture-date editing is not supported for {}",
            path.display()
        )));
    }

    // EXIF date-time format: "YYYY:MM:DD HH:MM:SS".
    let stamp = dt.format("%Y:%m:%d %H:%M:%S").to_string();

    let tmp = temp_sibling(path)?;
    std::fs::copy(path, &tmp)?;

    // Load existing EXIF from the copy so we only overwrite the date tags and
    // keep everything else; fall back to fresh metadata if the file has none.
    let write = (|| -> Result<()> {
        let mut md = Metadata::new_from_path(&tmp).unwrap_or_else(|_| Metadata::new());
        // ExifTool tag names: DateTimeOriginal (0x9003), CreateDate = EXIF
        // DateTimeDigitized (0x9004), ModifyDate = TIFF/IFD0 DateTime (0x0132).
        md.set_tag(ExifTag::DateTimeOriginal(stamp.clone()));
        md.set_tag(ExifTag::CreateDate(stamp.clone()));
        md.set_tag(ExifTag::ModifyDate(stamp.clone()));
        md.write_to_file(&tmp)?;
        Ok(())
    })();

    let result = write.and_then(|()| {
        std::fs::rename(&tmp, path)?;
        Ok(())
    });

    if result.is_err() {
        // Never leave the temp copy behind on failure.
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// A hidden temp path beside `path`, on the same volume so the rename is atomic.
///
/// The original **extension is preserved** — `little_exif` classifies the file
/// type by extension, so a generic `.tmp` suffix would make it reject the file.
fn temp_sibling(path: &Path) -> Result<PathBuf> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::Invalid(format!("no parent directory for {}", path.display())))?;
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let name = match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!(".{stem}.lumina-date-tmp.{ext}"),
        None => format!(".{stem}.lumina-date-tmp"),
    };
    Ok(parent.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, NaiveDate, TimeZone};
    use image::{Rgb, RgbImage};

    /// Write a capture date into a real JPEG, then read it back through the same
    /// EXIF reader the scanner uses — the value must survive the round trip.
    #[test]
    fn writes_and_reads_back_capture_date() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("probe.jpg");
        RgbImage::from_pixel(16, 16, Rgb([120, 130, 140]))
            .save(&path)
            .unwrap();

        let dt = NaiveDate::from_ymd_opt(2009, 6, 15)
            .unwrap()
            .and_hms_opt(14, 30, 0)
            .unwrap();
        set_capture_date(&path, dt).unwrap();

        let exif = crate::metadata::read_exif(&path).unwrap();
        let expected = Local.from_local_datetime(&dt).single().unwrap().timestamp();
        assert_eq!(exif.taken_at, Some(expected));
    }

    /// Non-photo containers are rejected cleanly (so the caller counts them as
    /// skipped rather than failing the batch).
    #[test]
    fn rejects_unsupported_format() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clip.mp4");
        std::fs::write(&path, b"not really a video").unwrap();
        let dt = NaiveDate::from_ymd_opt(2009, 6, 15)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        assert!(matches!(
            set_capture_date(&path, dt),
            Err(Error::Unsupported(_))
        ));
    }
}
