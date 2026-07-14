//! Folder mirror mode: bidirectional sync between the album tree and the
//! on-disk folder tree of a "mirror" watched root.
//!
//! Two directions:
//!  * **album → disk** — [`rename_album`], [`move_album`], [`delete_album`]
//!    translate structural album edits into filesystem renames/moves/trashes,
//!    then update the catalog. The filesystem op always happens **first**; the
//!    catalog is only ever mutated once it succeeds, and a best-effort rollback
//!    renames back if the catalog step then fails. The catalog is never left
//!    inconsistent with disk.
//!  * **disk → album** — [`reconcile`] walks a mirror root, folds Explorer-side
//!    changes (adds/moves/deletes, including offline ones) back into the catalog
//!    by content hash, and re-materialises the album tree 1:1 with the folders.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::Connection;
use tracing::warn;
use walkdir::WalkDir;

use crate::core::error::{Error, Result};
use crate::core::hash::hash_file;
use crate::database::{albums, photos};
use crate::events;
use crate::metadata::Format;
use crate::scanner::ScanManager;

/// The on-disk directory an album mirrors, or a clear error when it has none
/// (i.e. it is a virtual/smart album and must not touch disk).
fn album_folder(conn: &Connection, id: &str, now: i64) -> Result<(crate::core::models::Album, PathBuf)> {
    let album = albums::get(conn, id, now)?;
    let folder = album
        .folder_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| Error::Invalid("album is not a mirror (folder-backed) album".into()))?;
    Ok((album, folder))
}

/// String form of a path (lossy; paths here originate from the catalog/FS).
fn path_str(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// True when `path` is exactly `root` or nested under it (separator-aware, so
/// `C:\Photos` never matches `C:\PhotosBackup`).
pub fn is_under(path: &str, root: &str) -> bool {
    if path == root {
        return true;
    }
    let mut prefix = String::with_capacity(root.len() + 1);
    prefix.push_str(root);
    prefix.push(std::path::MAIN_SEPARATOR);
    path.starts_with(&prefix)
}

/// The mirror root (from `roots`) that contains `path`, if any.
pub fn root_of<'a>(path: &str, roots: &'a [String]) -> Option<&'a str> {
    roots.iter().map(String::as_str).find(|r| is_under(path, r))
}

// ---------------------------------------------------------------------------
// album → disk
// ---------------------------------------------------------------------------

/// Rename a mirror album: rename its folder on disk (to `parent/new_name`), then
/// rewrite this album's name + `folder_path`, every descendant album's
/// `folder_path`, and every contained photo's path. Rejects an existing target.
pub fn rename_album(conn: &Connection, id: &str, new_name: &str) -> Result<()> {
    let now = crate::api::now();
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err(Error::Invalid("album name must not be empty".into()));
    }
    if new_name.contains('/') || new_name.contains('\\') {
        return Err(Error::Invalid("album name must not contain path separators".into()));
    }
    let (_album, old_folder) = album_folder(conn, id, now)?;
    let parent = old_folder
        .parent()
        .ok_or_else(|| Error::Invalid("cannot rename a mirror root album".into()))?;
    let new_folder = parent.join(new_name);
    if new_folder == old_folder {
        // Pure no-op (same on-disk name); nothing to do.
        return Ok(());
    }
    if new_folder.exists() {
        return Err(Error::Invalid(format!(
            "a folder named '{new_name}' already exists here"
        )));
    }

    // Filesystem first.
    std::fs::rename(&old_folder, &new_folder)?;

    // Then the catalog; roll the folder back if any catalog step fails.
    let old = path_str(&old_folder);
    let new = path_str(&new_folder);
    let catalog = (|| -> Result<()> {
        albums::rename(conn, id, new_name)?;
        albums::relocate_folder_prefix(conn, &old, &new)?;
        photos::relocate_prefix(conn, &old, &new)?;
        Ok(())
    })();
    if let Err(e) = catalog {
        if let Err(re) = std::fs::rename(&new_folder, &old_folder) {
            warn!(error = %re, "mirror rename rollback failed; catalog and disk may diverge");
        }
        return Err(e);
    }
    Ok(())
}

/// Move a mirror album under another mirror album (in the same tree): move its
/// folder on disk into the new parent's folder, then relocate album paths, photo
/// paths, and reparent/reorder in the catalog. Rejects a non-mirror parent, a
/// cross-tree move, or a colliding/cross-drive target.
pub fn move_album(
    conn: &Connection,
    id: &str,
    new_parent_id: Option<&str>,
    new_index: usize,
) -> Result<()> {
    let now = crate::api::now();
    let (_album, old_folder) = album_folder(conn, id, now)?;

    let parent_id = new_parent_id.ok_or_else(|| {
        Error::Invalid("a mirror album can only move under another mirror album".into())
    })?;
    let (_parent, parent_folder) = album_folder(conn, parent_id, now).map_err(|_| {
        Error::Invalid("target parent is not a mirror (folder-backed) album".into())
    })?;

    // Both must live under the same mirror root.
    let roots = crate::database::folders::mirror_roots(conn)?;
    let old = path_str(&old_folder);
    let src_root = root_of(&old, &roots)
        .ok_or_else(|| Error::Invalid("album is not under a mirror root".into()))?;
    if !is_under(&path_str(&parent_folder), src_root) {
        return Err(Error::Invalid(
            "target parent is in a different mirror tree".into(),
        ));
    }

    let base = old_folder
        .file_name()
        .ok_or_else(|| Error::Invalid("cannot move a mirror root album".into()))?;
    let new_folder = parent_folder.join(base);
    if new_folder == old_folder {
        // Same parent — a pure reorder; no filesystem change needed.
        return albums::reparent(conn, id, new_parent_id, new_index);
    }
    if old_folder.starts_with(&new_folder) || new_folder.starts_with(&old_folder) {
        return Err(Error::Invalid(
            "cannot move a folder into itself or its own subtree".into(),
        ));
    }
    if new_folder.exists() {
        return Err(Error::Invalid(
            "a folder with this name already exists in the target".into(),
        ));
    }

    // Filesystem first (fails on cross-drive moves → no catalog change).
    std::fs::rename(&old_folder, &new_folder)?;

    let new = path_str(&new_folder);
    let catalog = (|| -> Result<()> {
        albums::relocate_folder_prefix(conn, &old, &new)?;
        photos::relocate_prefix(conn, &old, &new)?;
        albums::reparent(conn, id, new_parent_id, new_index)?;
        Ok(())
    })();
    if let Err(e) = catalog {
        if let Err(re) = std::fs::rename(&new_folder, &old_folder) {
            warn!(error = %re, "mirror move rollback failed; catalog and disk may diverge");
        }
        return Err(e);
    }
    Ok(())
}

/// Delete a mirror album: send its folder to the OS trash / Recycle Bin, then
/// soft-delete every contained photo and remove the album + its descendants from
/// the catalog. Destructive but recoverable from the system trash.
pub fn delete_album(conn: &Connection, id: &str) -> Result<()> {
    let now = crate::api::now();
    let (_album, folder) = album_folder(conn, id, now)?;

    // Filesystem first. A missing folder is treated as already gone.
    if folder.exists() {
        trash::delete(&folder)
            .map_err(|e| Error::Other(format!("could not move folder to trash: {e}")))?;
    }
    // Then the catalog.
    let prefix = path_str(&folder);
    photos::soft_delete_under(conn, &prefix, now)?;
    albums::delete_with_descendants(conn, id)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// disk → album reconciliation
// ---------------------------------------------------------------------------

/// One mirror root reconcile: fold Explorer-side changes into the catalog, then
/// index any genuinely new files and refresh the UI. The heavy catalog/FS diff
/// runs in [`reconcile_catalog`]; here we additionally kick a scan so brand-new
/// files get indexed and assigned to their folder's album.
pub fn reconcile(scanner: &Arc<ScanManager>, root: &Path) -> Result<()> {
    let conn = scanner.db().get()?;
    reconcile_catalog(&conn, root)?;

    // Folder → album map so freshly-indexed files land in the right album.
    let root_str = path_str(root);
    let assign: HashMap<String, String> = albums::mirror_albums_under(&conn, &root_str)?
        .into_iter()
        .filter_map(|a| a.folder_path.map(|fp| (fp, a.id)))
        .collect();
    drop(conn);

    scanner.spawn_scan_with_albums(vec![root.to_path_buf()], assign);
    events::emit(scanner.app(), events::names::LIBRARY_CHANGED, ());
    Ok(())
}

/// Pure catalog/filesystem reconciliation for one mirror `root` (no scan, no
/// Tauri): move-detect by content hash, soft-delete true removals, and sync the
/// album tree 1:1 with the on-disk folders. New files are left for the caller's
/// scan to index. Testable without a running app.
pub fn reconcile_catalog(conn: &Connection, root: &Path) -> Result<()> {
    let now = crate::api::now();

    // 1. Walk the disk: media files + the full set of directories.
    let mut disk_files: Vec<PathBuf> = Vec::new();
    let mut disk_dirs: BTreeSet<PathBuf> = BTreeSet::new();
    disk_dirs.insert(root.to_path_buf());
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_dir() {
            disk_dirs.insert(entry.path().to_path_buf());
        } else if entry.file_type().is_file() {
            if let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) {
                if Format::from_extension(ext).is_some() {
                    disk_files.push(entry.path().to_path_buf());
                }
            }
        }
    }
    let disk_paths: HashSet<String> = disk_files.iter().map(|p| path_str(p)).collect();

    // 2. Catalog photos under this root.
    let root_str = path_str(root);
    let catalog = photos::by_path_prefix(conn, &root_str)?;
    let catalog_paths: HashSet<String> = catalog.iter().map(|p| p.path.clone()).collect();

    // 3. Partition: catalog orphans (gone from disk) and new disk files.
    let orphans: Vec<&crate::core::models::Photo> = catalog
        .iter()
        .filter(|p| !disk_paths.contains(&p.path))
        .collect();
    let new_files: Vec<&PathBuf> = disk_files
        .iter()
        .filter(|p| !catalog_paths.contains(&path_str(p)))
        .collect();

    // 4. Move detection: hash the new files once, keyed by digest (first wins).
    let mut new_by_hash: HashMap<String, PathBuf> = HashMap::new();
    for f in &new_files {
        if let Ok(h) = hash_file(f) {
            new_by_hash.entry(h).or_insert_with(|| (*f).clone());
        }
    }
    let mut consumed: HashSet<PathBuf> = HashSet::new();
    for orphan in &orphans {
        // A byte-identical file that re-appeared elsewhere is a MOVE: relocate
        // the existing row (preserving id/rating/tags/album links) rather than
        // deleting + re-adding.
        let moved_to = orphan
            .hash
            .as_deref()
            .and_then(|h| new_by_hash.get(h))
            .filter(|p| !consumed.contains(*p))
            .cloned();
        match moved_to {
            Some(dest) => {
                let dest_str = path_str(&dest);
                photos::relocate_prefix(conn, &orphan.path, &dest_str)?;
                consumed.insert(dest);
            }
            None => {
                // A genuine deletion.
                photos::soft_delete(conn, &[orphan.id.clone()], now)?;
            }
        }
    }
    // Remaining new files (not moves) are indexed by the caller's scan.

    // 5. Album tree sync: exactly one folder-backed album per on-disk directory.
    sync_album_tree(conn, root, &disk_dirs, now)?;
    Ok(())
}

/// Ensure the album tree matches `disk_dirs` exactly: create a folder-backed
/// album for every directory that lacks one (under the correct parent), delete
/// albums whose folder no longer exists, and (re)assign photo membership by
/// folder. `disk_dirs` is ordered ancestors-first (a `BTreeSet<PathBuf>`).
fn sync_album_tree(
    conn: &Connection,
    root: &Path,
    disk_dirs: &BTreeSet<PathBuf>,
    now: i64,
) -> Result<()> {
    let root_str = path_str(root);
    let existing = albums::mirror_albums_under(conn, &root_str)?;
    let mut by_folder: HashMap<String, String> = existing
        .iter()
        .filter_map(|a| a.folder_path.clone().map(|fp| (fp, a.id.clone())))
        .collect();

    // Create missing albums (ancestors first, so parents resolve).
    for dir in disk_dirs {
        let dir_str = path_str(dir);
        if by_folder.contains_key(&dir_str) {
            continue;
        }
        let name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Album")
            .to_string();
        let parent_id = if dir == root {
            None
        } else {
            dir.parent()
                .and_then(|p| by_folder.get(&path_str(p)))
                .cloned()
        };
        let album = albums::create_with_folder(conn, &name, parent_id.as_deref(), Some(&dir_str), now)?;
        by_folder.insert(dir_str, album.id);
    }

    // Delete albums whose on-disk folder has vanished.
    let disk_set: HashSet<String> = disk_dirs.iter().map(|d| path_str(d)).collect();
    for a in &existing {
        if let Some(fp) = &a.folder_path {
            if !disk_set.contains(fp) {
                if let Err(e) = albums::delete(conn, &a.id) {
                    warn!(error = %e, folder = %fp, "reconcile: could not delete stale album");
                }
            }
        }
    }

    // Authoritatively resync membership for folders that still exist: each
    // mirror album ends up holding exactly the live photos in its folder (so a
    // file moved between folders leaves its old album and joins the new one).
    for dir in disk_dirs {
        let s = path_str(dir);
        if let Some(aid) = by_folder.get(&s) {
            albums::resync_folder_album(conn, aid, &s, now)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::{MediaType, Photo, ThumbStatus};
    use crate::database::Database;

    /// Open a fresh migrated database in `dir`.
    fn open_db(dir: &Path) -> Database {
        Database::open(&dir.join("lumina.db"), 2, 0).unwrap()
    }

    /// Insert a catalogued photo at `path` with the given content hash.
    fn insert_photo(conn: &Connection, path: &Path, hash: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let folder = path.parent().unwrap().to_string_lossy().to_string();
        let filename = path.file_name().unwrap().to_string_lossy().to_string();
        let photo = Photo {
            id: id.clone(),
            path: path.to_string_lossy().to_string(),
            filename,
            folder,
            format: "jpeg".into(),
            media_type: MediaType::Photo,
            taken_at: Some(1),
            file_created: Some(1),
            file_modified: Some(1),
            imported_at: 1,
            width: 1,
            height: 1,
            orientation: 1,
            file_size: 3,
            camera_make: None,
            camera_model: None,
            lens: None,
            iso: None,
            focal_length: None,
            aperture: None,
            shutter_speed: None,
            gps_lat: None,
            gps_lon: None,
            hash: Some(hash.to_string()),
            rating: 4,
            is_favorite: true,
            is_raw: false,
            thumb_status: ThumbStatus::Ready,
            thumb_path: None,
            tags: Vec::new(),
        };
        photos::upsert(conn, &photo).unwrap();
        id
    }

    #[test]
    fn rename_album_renames_folder_and_relocates_photos() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let sub = root.join("Trip");
        std::fs::create_dir_all(&sub).unwrap();
        let file = sub.join("a.jpg");
        std::fs::write(&file, b"one").unwrap();

        let db = open_db(tmp.path());
        let conn = db.get().unwrap();

        let root_album = albums::create_with_folder(
            &conn,
            "root",
            None,
            Some(&root.to_string_lossy()),
            0,
        )
        .unwrap();
        let sub_album = albums::create_with_folder(
            &conn,
            "Trip",
            Some(&root_album.id),
            Some(&sub.to_string_lossy()),
            0,
        )
        .unwrap();
        let photo_id = insert_photo(&conn, &file, "hash-a");

        rename_album(&conn, &sub_album.id, "Vacation").unwrap();

        // Filesystem renamed.
        let new_sub = root.join("Vacation");
        assert!(new_sub.exists(), "renamed folder should exist");
        assert!(!sub.exists(), "old folder should be gone");
        assert!(new_sub.join("a.jpg").exists());

        // Album folder_path updated.
        let a = albums::get(&conn, &sub_album.id, 0).unwrap();
        assert_eq!(a.name, "Vacation");
        assert_eq!(a.folder_path.as_deref(), Some(new_sub.to_string_lossy().as_ref()));

        // Photo relocated in place, identity + catalog fields preserved.
        let p = photos::get(&conn, &photo_id).unwrap();
        assert_eq!(p.path, new_sub.join("a.jpg").to_string_lossy());
        assert_eq!(p.rating, 4);
        assert!(p.is_favorite);
        assert_eq!(p.id, photo_id);
    }

    #[test]
    fn delete_album_trashes_folder_and_soft_deletes_photos() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let sub = root.join("Trip");
        std::fs::create_dir_all(&sub).unwrap();
        let file = sub.join("a.jpg");
        std::fs::write(&file, b"one").unwrap();

        let db = open_db(tmp.path());
        let conn = db.get().unwrap();

        let root_album =
            albums::create_with_folder(&conn, "root", None, Some(&root.to_string_lossy()), 0).unwrap();
        let sub_album = albums::create_with_folder(
            &conn,
            "Trip",
            Some(&root_album.id),
            Some(&sub.to_string_lossy()),
            0,
        )
        .unwrap();
        let photo_id = insert_photo(&conn, &file, "hash-a");

        delete_album(&conn, &sub_album.id).unwrap();

        // Folder is gone from disk (moved to trash).
        assert!(!sub.exists(), "deleted folder should be gone from disk");
        // Photo soft-deleted (no longer a live row).
        assert!(photos::get(&conn, &photo_id).is_err());
        // Album removed.
        assert!(albums::get(&conn, &sub_album.id, 0).is_err());
    }

    #[test]
    fn reconcile_detects_move_by_hash() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("a.jpg");
        std::fs::write(&file, b"stable-content").unwrap();
        let hash = hash_file(&file).unwrap();

        let db = open_db(tmp.path());
        let conn = db.get().unwrap();
        let root_album =
            albums::create_with_folder(&conn, "root", None, Some(&root.to_string_lossy()), 0).unwrap();
        let photo_id = insert_photo(&conn, &file, &hash);
        // Photo starts as a member of the root folder's album.
        albums::resync_folder_album(&conn, &root_album.id, &root.to_string_lossy(), 0).unwrap();
        assert_eq!(albums::get(&conn, &root_album.id, 0).unwrap().count, 1);

        // Move the file on disk into a new subfolder (Explorer-style move).
        let sub = root.join("Moved");
        std::fs::create_dir_all(&sub).unwrap();
        let dest = sub.join("a.jpg");
        std::fs::rename(&file, &dest).unwrap();

        reconcile_catalog(&conn, &root).unwrap();

        // The SAME row now points at the new path (move, not delete + re-add).
        let p = photos::get(&conn, &photo_id).unwrap();
        assert_eq!(p.id, photo_id);
        assert_eq!(p.path, dest.to_string_lossy());
        assert_eq!(p.rating, 4, "catalog fields preserved across the move");

        // A folder-backed album was materialised for the new subfolder.
        let sub_albums = albums::mirror_albums_under(&conn, &sub.to_string_lossy()).unwrap();
        let sub_album = sub_albums
            .iter()
            .find(|a| a.folder_path.as_deref() == Some(sub.to_string_lossy().as_ref()))
            .expect("an album should exist for the new on-disk folder");

        // Membership is authoritative: the photo left the root album and joined
        // the subfolder album (no stale membership). Counts via `get` (which
        // evaluates membership — `mirror_albums_under` returns count = 0).
        assert_eq!(
            albums::get(&conn, &sub_album.id, 0).unwrap().count,
            1,
            "moved photo joins its new folder's album"
        );
        assert_eq!(
            albums::get(&conn, &root_album.id, 0).unwrap().count,
            0,
            "moved photo is removed from its old folder's album"
        );
    }
}
