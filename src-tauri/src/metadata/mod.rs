//! Metadata module: EXIF extraction and format classification.

pub mod exif;
pub mod exif_write;

pub use exif::{read as read_exif, ExifData};

use crate::core::models::MediaType;

/// Supported input formats. `Raw`/`Heic` are read minimally (dimensions +
/// whatever EXIF is available). Video formats are catalogued (metadata only) —
/// decoding/thumbnailing them is out of scope for the MVP but the architecture
/// is in place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Jpeg,
    Png,
    Webp,
    Gif,
    Tiff,
    Bmp,
    Heic,
    Raw,
    // Video containers (media_type = video).
    Mp4,
    Mov,
    Mkv,
    Avi,
    WebmVideo,
    M4v,
}

impl Format {
    /// Canonical lowercase label stored in the database.
    pub fn as_str(self) -> &'static str {
        match self {
            Format::Jpeg => "jpeg",
            Format::Png => "png",
            Format::Webp => "webp",
            Format::Gif => "gif",
            Format::Tiff => "tiff",
            Format::Bmp => "bmp",
            Format::Heic => "heic",
            Format::Raw => "raw",
            Format::Mp4 => "mp4",
            Format::Mov => "mov",
            Format::Mkv => "mkv",
            Format::Avi => "avi",
            Format::WebmVideo => "webm",
            Format::M4v => "m4v",
        }
    }

    /// True for RAW/HEIC formats the image crate cannot generally decode.
    pub fn is_raw_family(self) -> bool {
        matches!(self, Format::Raw | Format::Heic)
    }

    /// True for video containers.
    pub fn is_video(self) -> bool {
        matches!(
            self,
            Format::Mp4 | Format::Mov | Format::Mkv | Format::Avi | Format::WebmVideo | Format::M4v
        )
    }

    /// The media type this format maps to.
    pub fn media_type(self) -> MediaType {
        if self.is_video() {
            MediaType::Video
        } else {
            MediaType::Photo
        }
    }

    /// Whether the MVP can currently produce a raster thumbnail for this format.
    pub fn is_thumbnailable(self) -> bool {
        !self.is_raw_family() && !self.is_video()
    }

    /// Classify by file extension (case-insensitive). Returns `None` for
    /// unsupported/unknown extensions so the scanner can skip them.
    pub fn from_extension(ext: &str) -> Option<Format> {
        let e = ext.to_ascii_lowercase();
        let f = match e.as_str() {
            "jpg" | "jpeg" | "jpe" | "jfif" => Format::Jpeg,
            "png" => Format::Png,
            "webp" => Format::Webp,
            "gif" => Format::Gif,
            "tif" | "tiff" => Format::Tiff,
            "bmp" => Format::Bmp,
            "heic" | "heif" => Format::Heic,
            // Common RAW families — minimal read only.
            "raw" | "arw" | "cr2" | "cr3" | "nef" | "nrw" | "orf" | "raf" | "rw2" | "dng"
            | "pef" | "srw" | "sr2" => Format::Raw,
            // Video containers — catalogued, not thumbnailed.
            "mp4" => Format::Mp4,
            "mov" | "qt" => Format::Mov,
            "mkv" => Format::Mkv,
            "avi" => Format::Avi,
            "webm" => Format::WebmVideo,
            "m4v" => Format::M4v,
            _ => return None,
        };
        Some(f)
    }
}
