//! Removable-device detection.
//!
//! A lightweight background poller that notices when a removable volume holding
//! media is connected and emits [`events::names::DEVICE_CONNECTED`] so the UI can
//! offer to back it up. Windows-first: `GetLogicalDrives` + `GetDriveTypeW`.
//! Other platforms get a no-op (the manual backup commands still work).

use std::sync::Arc;

use parking_lot::RwLock;
use tauri::AppHandle;

use crate::core::config::AppConfig;
use crate::events::DeviceInfo;

/// Start the device watcher. On non-Windows this is a no-op.
pub fn start(app: AppHandle, config: Arc<RwLock<AppConfig>>) {
    #[cfg(windows)]
    windows_impl::start(app, config);
    #[cfg(not(windows))]
    {
        let _ = (app, config);
    }
}

/// Enumerate currently-connected removable devices that hold media. Empty on
/// non-Windows platforms.
pub fn list_devices() -> Vec<DeviceInfo> {
    #[cfg(windows)]
    {
        windows_impl::list_devices()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(windows)]
mod windows_impl {
    use std::collections::HashSet;
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    use parking_lot::RwLock;
    use tauri::AppHandle;
    use tracing::info;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    };

    use crate::backup::scan;
    use crate::core::config::AppConfig;
    use crate::events::{self, DeviceInfo};

    /// `GetDriveTypeW` return values (mirrored from `winbase.h` — not re-exported
    /// by this `windows` version). `REMOVABLE` covers SD cards / USB mass storage;
    /// `FIXED` covers many USB SSDs and card readers that report as fixed disks.
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;

    /// Poll interval for drive-arrival detection.
    const POLL: Duration = Duration::from_secs(2);
    /// Cap on the per-device media probe so a large card stays cheap to count.
    const PROBE_CAP: u64 = 100_000;

    /// Bitmask of present drives → set of drive letters (`A`..=`Z`).
    fn present_letters(mask: u32) -> HashSet<char> {
        (0..26u32)
            .filter(|i| mask & (1 << i) != 0)
            .map(|i| (b'A' + i as u8) as char)
            .collect()
    }

    /// Null-terminated UTF-16 for a `"X:\\"` root path.
    fn root_wide(letter: char) -> Vec<u16> {
        OsStr::new(&format!("{letter}:\\"))
            .encode_wide()
            .chain(once(0))
            .collect()
    }

    /// Volume label for a drive letter, falling back to `"X:"`.
    fn volume_label(letter: char) -> String {
        let root = root_wide(letter);
        let mut name = [0u16; 256];
        let ok = unsafe {
            GetVolumeInformationW(
                PCWSTR(root.as_ptr()),
                Some(&mut name),
                None,
                None,
                None,
                None,
            )
        };
        if ok.is_ok() {
            let end = name.iter().position(|&c| c == 0).unwrap_or(name.len());
            let label = String::from_utf16_lossy(&name[..end]);
            if !label.trim().is_empty() {
                return label;
            }
        }
        format!("{letter}:")
    }

    /// Drive letter (uppercase) of a configured destination path, if any.
    fn dest_drive_letter(config: &Arc<RwLock<AppConfig>>) -> Option<char> {
        config
            .read()
            .backup_destination
            .as_ref()
            .and_then(|d| d.chars().next())
            .map(|c| c.to_ascii_uppercase())
    }

    /// The Windows drive type for a letter.
    fn drive_type(letter: char) -> u32 {
        let root = root_wide(letter);
        unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) }
    }

    /// Whether a drive holds a top-level `DCIM` folder — a strong "camera / card"
    /// signal used to auto-offer backups even for fixed-type USB readers.
    fn has_dcim(letter: char) -> bool {
        PathBuf::from(format!("{letter}:\\DCIM")).is_dir()
    }

    /// Build a [`DeviceInfo`] for a drive if it holds at least one media file.
    fn media_info(letter: char) -> Option<DeviceInfo> {
        let root_path = PathBuf::from(format!("{letter}:\\"));
        let media_count = scan::count_media_capped(&root_path, PROBE_CAP);
        if media_count == 0 {
            return None;
        }
        Some(DeviceInfo {
            path: root_path.to_string_lossy().to_string(),
            label: volume_label(letter),
            media_count,
        })
    }

    /// The system drive (heuristic: the drive Windows booted from, usually `C`).
    /// Never offered as a backup *source* — it's the internal disk.
    fn is_system_drive(letter: char) -> bool {
        std::env::var("SystemDrive")
            .ok()
            .and_then(|s| s.chars().next())
            .map(|c| c.to_ascii_uppercase())
            .unwrap_or('C')
            == letter.to_ascii_uppercase()
    }

    /// All currently-connected drives that could be a backup source: any
    /// removable or fixed (USB) volume holding media, excluding the system disk.
    /// Permissive on purpose so the manual "back up a device" action always finds
    /// the card even when auto-detection's stricter rules skip it.
    pub fn list_devices() -> Vec<DeviceInfo> {
        present_letters(unsafe { GetLogicalDrives() })
            .into_iter()
            .filter(|&l| !is_system_drive(l))
            .filter(|&l| matches!(drive_type(l), DRIVE_REMOVABLE | DRIVE_FIXED))
            .filter_map(media_info)
            .collect()
    }

    /// Inspect a newly-arrived drive; emit a connection event when it looks like a
    /// media source (removable, or a fixed USB drive with a `DCIM` folder) that
    /// holds media and isn't the configured backup destination.
    fn handle_new_drive(app: &AppHandle, config: &Arc<RwLock<AppConfig>>, letter: char) {
        if is_system_drive(letter) || dest_drive_letter(config) == Some(letter) {
            return;
        }
        let dtype = drive_type(letter);
        let looks_like_source = dtype == DRIVE_REMOVABLE || (dtype == DRIVE_FIXED && has_dcim(letter));
        if !looks_like_source {
            return;
        }
        if let Some(info) = media_info(letter) {
            info!(drive = %letter, kind = dtype, media_count = info.media_count, "media device connected");
            events::emit(app, events::names::DEVICE_CONNECTED, info);
        }
    }

    pub fn start(app: AppHandle, config: Arc<RwLock<AppConfig>>) {
        std::thread::Builder::new()
            .name("lumina-device-watch".into())
            .spawn(move || {
                // Seed with drives already present so launching the app doesn't
                // prompt for a card that was inserted beforehand.
                let mut known = present_letters(unsafe { GetLogicalDrives() });
                loop {
                    std::thread::sleep(POLL);
                    let current = present_letters(unsafe { GetLogicalDrives() });
                    for &letter in current.difference(&known) {
                        handle_new_drive(&app, &config, letter);
                    }
                    known = current;
                }
            })
            .ok();
    }
}
