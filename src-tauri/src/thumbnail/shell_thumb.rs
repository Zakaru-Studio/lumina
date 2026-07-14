//! Windows Shell thumbnail extraction.
//!
//! Uses `IShellItemImageFactory::GetImage` to obtain the exact thumbnail the OS
//! (and File Explorer) already generate for a file — driven by the installed
//! media/codec stack. This gives us video poster frames with **no bundled
//! ffmpeg**, and a fallback for RAW/HEIC when a camera codec is present. The
//! returned image feeds the normal downscale → WebP pipeline.
//!
//! All failures (no provider, unsupported format, COM error) surface as
//! [`Error::Unsupported`], which the caller records as a failed thumbnail.

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use image::{DynamicImage, RgbaImage};
use windows::core::PCWSTR;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{DeleteObject, GetObjectW, DIBSECTION, HBITMAP, HGDIOBJ};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
};

use crate::core::error::{Error, Result};

/// Requested thumbnail box (px). The provider returns up to this size; the
/// pipeline downscales further as needed.
const REQUEST_PX: i32 = 1024;

/// Extract the OS-generated thumbnail for `path` as a decoded image.
pub fn thumbnail(path: &Path) -> Result<DynamicImage> {
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        // COM must be initialised per calling thread. A benign non-first init
        // (RPC_E_CHANGED_MODE) is fine; we balance every call with CoUninitialize.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let out = extract(&wide);
        CoUninitialize();
        out
    }
}

unsafe fn extract(wide: &[u16]) -> Result<DynamicImage> {
    let factory: IShellItemImageFactory =
        SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)
            .map_err(|e| Error::Unsupported(format!("shell item: {e}")))?;
    let hbitmap = factory
        .GetImage(
            SIZE {
                cx: REQUEST_PX,
                cy: REQUEST_PX,
            },
            SIIGBF_BIGGERSIZEOK,
        )
        .map_err(|e| Error::Unsupported(format!("shell thumbnail: {e}")))?;

    let result = dib_to_image(hbitmap);
    let _ = DeleteObject(HGDIOBJ(hbitmap.0));
    result
}

/// Copy a 32-bit DIB-section HBITMAP into an `RgbaImage`. `GetImage` returns a
/// top-down 32bpp DIB section, so its pixels are directly addressable via the
/// `BITMAP::bmBits` pointer (no device context needed).
unsafe fn dib_to_image(hbitmap: HBITMAP) -> Result<DynamicImage> {
    let mut ds = DIBSECTION::default();
    let written = GetObjectW(
        HGDIOBJ(hbitmap.0),
        std::mem::size_of::<DIBSECTION>() as i32,
        Some(&mut ds as *mut _ as *mut c_void),
    );
    if written as usize != std::mem::size_of::<DIBSECTION>() {
        return Err(Error::Unsupported("shell bitmap is not a DIB section".into()));
    }

    let bm = ds.dsBm;
    if bm.bmWidth <= 0 || bm.bmHeight <= 0 || bm.bmBits.is_null() || bm.bmBitsPixel != 32 {
        return Err(Error::Unsupported("unexpected shell bitmap format".into()));
    }

    let w = bm.bmWidth as usize;
    let h = bm.bmHeight as usize;
    let stride = bm.bmWidthBytes as usize;
    let src = std::slice::from_raw_parts(bm.bmBits as *const u8, stride * h);

    // `IShellItemImageFactory::GetImage` always hands back a **top-down** 32bpp
    // DIB (premultiplied BGRA), so memory row 0 is the visual top row. The
    // DIBSECTION header (`dsBmih.biHeight`) reports a positive, bottom-up-looking
    // height even though the pixels are top-down; trusting that sign flips the
    // image vertically (upside-down RAW/video posters). Read rows directly.
    let mut rgba = vec![0u8; w * h * 4];
    for y in 0..h {
        let row = &src[y * stride..y * stride + w * 4];
        let dst = &mut rgba[y * w * 4..(y + 1) * w * 4];
        for x in 0..w {
            let s = &row[x * 4..x * 4 + 4];
            let d = &mut dst[x * 4..x * 4 + 4];
            // Source is BGRA; force opaque alpha (video/RAW posters are opaque,
            // and some providers leave alpha at 0 which would render invisible).
            d[0] = s[2];
            d[1] = s[1];
            d[2] = s[0];
            d[3] = 255;
        }
    }

    RgbaImage::from_raw(w as u32, h as u32, rgba)
        .map(DynamicImage::ImageRgba8)
        .ok_or_else(|| Error::Unsupported("failed to build shell image".into()))
}
