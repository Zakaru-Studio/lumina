//! EXIF extraction built on `kamadak-exif`.
//!
//! All fields are best-effort and optional; a missing or malformed tag never
//! fails the whole read. The scanner merges this with filesystem/image-derived
//! data before persisting a [`crate::core::models::Photo`].

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use chrono::{Datelike, Local, NaiveDateTime, TimeZone};
use exif::{In, Tag, Value};

use crate::core::error::Result;

/// Camera/optics/geo metadata parsed from an image's EXIF block.
#[derive(Debug, Clone, Default)]
pub struct ExifData {
    pub taken_at: Option<i64>,
    pub orientation: Option<u16>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<i64>,
    pub aperture: Option<f64>,
    pub shutter_speed: Option<String>,
    pub focal_length: Option<f64>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
}

/// Read EXIF metadata from `path`. Returns an all-`None` [`ExifData`] when the
/// file carries no EXIF (e.g. most PNGs) rather than erroring.
pub fn read(path: &Path) -> Result<ExifData> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let exif = match exif::Reader::new().read_from_container(&mut reader) {
        Ok(e) => e,
        // No/invalid EXIF is a normal, non-fatal condition.
        Err(_) => return Ok(ExifData::default()),
    };

    let mut data = ExifData::default();

    data.taken_at = read_datetime(&exif);
    data.orientation = exif
        .get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .map(|v| v as u16);
    data.camera_make = string_field(&exif, Tag::Make);
    data.camera_model = string_field(&exif, Tag::Model);
    data.lens = string_field(&exif, Tag::LensModel);
    data.iso = exif
        .get_field(Tag::PhotographicSensitivity, In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .map(|v| v as i64);
    data.aperture = rational_field(&exif, Tag::FNumber);
    data.focal_length = rational_field(&exif, Tag::FocalLength);
    data.shutter_speed = shutter(&exif);
    let (lat, lon) = gps(&exif);
    data.gps_lat = lat;
    data.gps_lon = lon;

    Ok(data)
}

fn string_field(exif: &exif::Exif, tag: Tag) -> Option<String> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    let s = field.display_value().to_string();
    let trimmed = s.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn rational_field(exif: &exif::Exif, tag: Tag) -> Option<f64> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    match &field.value {
        Value::Rational(v) => v.first().map(|r| r.to_f64()),
        _ => None,
    }
}

/// Extract the raw ASCII string of a field (not its "display" rendering, which
/// can reformat dates and break parsing).
fn ascii_value(field: &exif::Field) -> Option<String> {
    match &field.value {
        Value::Ascii(vals) => vals.first().map(|bytes| {
            String::from_utf8_lossy(bytes)
                .trim_end_matches('\0')
                .trim()
                .to_string()
        }),
        _ => Some(field.display_value().to_string()),
    }
}

/// Parse an EXIF date-time string ("YYYY:MM:DD HH:MM:SS", occasionally with a
/// dash date or a trailing sub-second/offset) into a Unix timestamp. The camera
/// records local time with no zone, so it is interpreted in the machine's local
/// zone — which round-trips to the same calendar day the timeline groups by.
fn parse_exif_datetime(raw: &str) -> Option<i64> {
    let s = raw.trim();
    // Keep just the "date time" prefix; drop any sub-second / offset suffix.
    let candidate = s.get(..19).unwrap_or(s);
    for fmt in ["%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(candidate, fmt) {
            // Reject the "unset" sentinel EXIF writes ("0000:00:00 00:00:00").
            if naive.year() >= 1900 {
                return Local
                    .from_local_datetime(&naive)
                    .single()
                    .map(|dt| dt.timestamp());
            }
        }
    }
    None
}

/// Best capture instant: prefer the original taken time, then the digitized
/// time, then the generic file DateTime — each read from its raw value.
fn read_datetime(exif: &exif::Exif) -> Option<i64> {
    for tag in [Tag::DateTimeOriginal, Tag::DateTimeDigitized, Tag::DateTime] {
        if let Some(field) = exif.get_field(tag, In::PRIMARY) {
            if let Some(ts) = ascii_value(field).and_then(|s| parse_exif_datetime(&s)) {
                return Some(ts);
            }
        }
    }
    None
}

fn shutter(exif: &exif::Exif) -> Option<String> {
    let field = exif.get_field(Tag::ExposureTime, In::PRIMARY)?;
    match &field.value {
        Value::Rational(v) => v.first().map(|r| {
            if r.num == 0 {
                "0".to_string()
            } else if r.denom >= r.num {
                // Present as 1/x for typical fast shutter speeds.
                format!("1/{}", (r.denom as f64 / r.num as f64).round() as i64)
            } else {
                format!("{:.1}s", r.to_f64())
            }
        }),
        _ => None,
    }
}

/// Decode GPS latitude/longitude to signed decimal degrees.
fn gps(exif: &exif::Exif) -> (Option<f64>, Option<f64>) {
    let lat = dms_to_deg(exif, Tag::GPSLatitude, Tag::GPSLatitudeRef, 'S');
    let lon = dms_to_deg(exif, Tag::GPSLongitude, Tag::GPSLongitudeRef, 'W');
    (lat, lon)
}

fn dms_to_deg(exif: &exif::Exif, coord: Tag, reference: Tag, negative_ref: char) -> Option<f64> {
    let field = exif.get_field(coord, In::PRIMARY)?;
    let deg = match &field.value {
        Value::Rational(v) if v.len() >= 3 => {
            v[0].to_f64() + v[1].to_f64() / 60.0 + v[2].to_f64() / 3600.0
        }
        _ => return None,
    };
    let sign = exif
        .get_field(reference, In::PRIMARY)
        .map(|f| f.display_value().to_string())
        .and_then(|r| r.trim().chars().next())
        .map(|c| if c.eq_ignore_ascii_case(&negative_ref) { -1.0 } else { 1.0 })
        .unwrap_or(1.0);
    Some(deg * sign)
}
