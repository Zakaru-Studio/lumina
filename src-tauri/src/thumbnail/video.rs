//! Video frame extraction for poster thumbnails.
//!
//! We shell out to a system `ffmpeg` binary (found on `PATH`) to grab a single
//! representative frame. This keeps the app dependency-light and fully offline —
//! no bundled codecs, no network. When `ffmpeg` is not installed the call fails
//! gracefully and the caller records a `failed` thumbnail (the UI then shows the
//! video placeholder), so video cataloguing never depends on it.

use std::path::Path;
use std::process::Command;

use image::DynamicImage;

use crate::core::error::{Error, Result};

/// Build an ffmpeg command, suppressing the console window that would otherwise
/// flash on Windows when a GUI app spawns a console subprocess.
fn ffmpeg_command() -> Command {
    let cmd = Command::new("ffmpeg");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = cmd;
        cmd.creation_flags(CREATE_NO_WINDOW);
        return cmd;
    }
    #[cfg(not(windows))]
    cmd
}

/// Longest edge (px) of the extracted frame handed back to the resizer. Kept
/// modest — the frame only feeds a grid thumbnail.
const FRAME_MAX_EDGE: u32 = 640;

/// Extract a poster frame from `src` as a decoded image. Tries a seek to ~1s
/// (skips black lead-in frames) and falls back to the very first frame for
/// clips shorter than that. Returns [`Error::Unsupported`] when `ffmpeg` is
/// missing or cannot decode the container.
pub fn extract_frame(src: &Path) -> Result<DynamicImage> {
    for seek in ["1", "0"] {
        match run_ffmpeg(src, seek) {
            Ok(bytes) if !bytes.is_empty() => {
                return image::load_from_memory(&bytes)
                    .map_err(|e| Error::Unsupported(format!("decode video frame: {e}")));
            }
            Ok(_) => continue, // empty output — try the next seek position
            Err(e) => return Err(e),
        }
    }
    Err(Error::Unsupported(format!(
        "no extractable frame in {}",
        src.display()
    )))
}

/// Invoke ffmpeg to emit one PNG frame (fitted within `FRAME_MAX_EDGE`) to
/// stdout. A non-zero exit with no output is treated as "no frame here" (empty
/// Ok), while a spawn failure (ffmpeg absent) is a hard [`Error::Unsupported`].
fn run_ffmpeg(src: &Path, seek: &str) -> Result<Vec<u8>> {
    let scale = format!("scale={FRAME_MAX_EDGE}:{FRAME_MAX_EDGE}:force_original_aspect_ratio=decrease");
    let output = ffmpeg_command()
        // `-ss` before `-i` = fast keyframe seek (input seeking).
        .args(["-v", "error", "-nostdin", "-ss", seek, "-i"])
        .arg(src)
        .args([
            "-frames:v", "1",
            "-vf", &scale,
            "-f", "image2pipe",
            "-vcodec", "png",
            "-",
        ])
        .output()
        .map_err(|e| Error::Unsupported(format!("ffmpeg not available: {e}")))?;

    Ok(output.stdout)
}
