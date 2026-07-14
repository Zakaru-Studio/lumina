# Edit capture date — design

**Date:** 2026-07-14
**Status:** Implemented

## Problem

Some photos carry a wrong EXIF capture date (e.g. `2084` instead of `2009`).
Users need to correct the "date taken" of a media so the library — and other
apps — show the right date, and so timeline/sort/filter behave correctly.

## Decisions (from brainstorming)

- **Persistence:** write the corrected date **into the file's EXIF**
  (`DateTimeOriginal` + `DateTimeDigitized`/`CreateDate` + `DateTime`/`ModifyDate`).
  This is permanent, portable across apps, and survives rescans (the reader
  re-reads the corrected value). Rejected DB-only (revertible on rescan, invisible
  to other apps) and hybrid (extra complexity, not needed).
- **Edit mode:** set an **absolute** date/time. A batch applies the *same*
  absolute date to every selected photo.
- **Formats:** JPEG / TIFF / PNG only (safe pure-Rust EXIF writing). RAW / HEIC /
  video are **skipped** (control disabled in the UI, counted as `skipped` in a
  batch) — consistent with the "write EXIF" choice.
- **Library choice:** `little_exif` (pure Rust) over bundling ExifTool — matches
  the project's "no external binaries, fully offline" philosophy (same reason
  ffmpeg isn't bundled).

## Backend

- `metadata/exif_write.rs`
  - `supports_date_write(Format) -> bool` (JPEG/TIFF/PNG).
  - `is_editable(&Path) -> bool` (classify by extension).
  - `set_capture_date(&Path, NaiveDateTime) -> Result<()>`: loads existing EXIF
    via `Metadata::new_from_path` (preserving camera/GPS/etc.), sets the three
    date tags formatted `YYYY:MM:DD HH:MM:SS`, writes to a hidden temp sibling,
    then **atomically renames** over the original (no corruption on crash).
    Unsupported formats return `Error::Unsupported`.
- `database/photos.rs::set_taken_at(conn, id, taken_at, file_size, file_modified)`
  — updates the row and refreshes the file size/mtime markers (the EXIF write
  changed them, so a later rescan sees the file as unchanged) + rebuilds FTS.
- `api/photos.rs::set_capture_date(ids, timestamp) -> SetDateSummary`
  — `timestamp` is Unix seconds interpreted in **local** time (mirrors the EXIF
  reader). Per id: write EXIF → refresh size/mtime → `set_taken_at` → invalidate
  the thumbnail LRU. Returns `{ updated, skipped, failed }`. Registered in
  `lib.rs`.

## Frontend

- `lib/api.ts`: `setCaptureDate(ids, timestamp)` + `SetDateSummary`.
- `hooks/usePhotoMutations.ts`: `useSetCaptureDate()` — invalidates the affected
  photo details + shared lists/stats, surfaces a summary toast.
- `lib/format.ts`: `canEditDate(photo)` mirrors `supports_date_write`.
- `components/common/DateTimeEditor.tsx`: shared modal around a native
  `datetime-local` input (local time = the Unix-seconds contract). Reused by
  both entry points — one source of truth for the input.
- `Lightbox`: the "Taken" metadata row becomes clickable (opens the editor) for
  editable formats; a tooltip explains when it isn't editable.
- `SelectionToolbar`: a "Set date…" (calendar) action applies one absolute date
  to the whole selection.
- i18n: `dateEditor.*`, `lightbox.editDate*`, `selection.setDate` in en/fr.

## Timezone

EXIF stores naive local time; the reader already interprets it in the machine's
local zone. The picker is local, we store the exact Unix timestamp in the DB and
write the matching naive local string to EXIF — read/write are symmetric.

## Out of scope (YAGNI)

- Offset/relative shifting of dates.
- RAW/HEIC/video date editing.
- Editing other EXIF fields.
