//! Import folders as a nested album hierarchy mirroring the on-disk tree.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use walkdir::WalkDir;

use crate::api::{blocking, now};
use crate::core::error::Result;
use crate::core::state::SharedState;
use crate::database::{albums, folders};
use crate::metadata::Format;

/// Deepest folder depth (relative to an import root) that gets its own album.
/// 0 = the root album, so 2 yields three levels total.
const MAX_ALBUM_DEPTH: usize = 2;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPreview {
    name: String,
    path: String,
    media_count: i64,
    children: Vec<FolderPreview>,
}

fn depth_of(root: &Path, folder: &Path) -> usize {
    folder
        .strip_prefix(root)
        .map(|r| r.components().count())
        .unwrap_or(0)
}

/// Media-file count per containing folder (parent dir of each media file).
fn media_counts(root: &Path) -> HashMap<PathBuf, i64> {
    let mut counts: HashMap<PathBuf, i64> = HashMap::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if Format::from_extension(ext).is_none() {
            continue;
        }
        if let Some(parent) = path.parent() {
            *counts.entry(parent.to_path_buf()).or_insert(0) += 1;
        }
    }
    counts
}

fn clamp_to_album(root: &Path, folder: &Path) -> PathBuf {
    let mut f = folder.to_path_buf();
    while depth_of(root, &f) > MAX_ALBUM_DEPTH {
        match f.parent() {
            Some(p) => f = p.to_path_buf(),
            None => break,
        }
    }
    f
}

/// album folder -> media assigned to that album. Always includes `root`.
///
/// Every sub-directory down to `MAX_ALBUM_DEPTH` becomes an album so the tree
/// mirrors the on-disk folder structure — even folders that hold no media
/// directly (an empty sub-folder still yields an empty album). Media in folders
/// deeper than the limit folds into its clamped (level-3) ancestor's count.
/// BTreeMap over PathBuf sorts ancestors before descendants (parents first).
fn album_layout(root: &Path, counts: &HashMap<PathBuf, i64>) -> BTreeMap<PathBuf, i64> {
    let mut album_folders: BTreeMap<PathBuf, i64> = BTreeMap::new();
    album_folders.insert(root.to_path_buf(), 0);
    for entry in WalkDir::new(root)
        .follow_links(false)
        .max_depth(MAX_ALBUM_DEPTH)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_dir() && entry.path() != root {
            album_folders.entry(entry.path().to_path_buf()).or_insert(0);
        }
    }
    for (folder, n) in counts {
        let target = clamp_to_album(root, folder);
        *album_folders.entry(target).or_insert(0) += *n;
    }
    album_folders
}

fn build_preview(root: &Path, layout: &BTreeMap<PathBuf, i64>, root_name: &str) -> FolderPreview {
    let mut children_of: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    for folder in layout.keys() {
        if folder == root {
            continue;
        }
        if let Some(parent) = folder.parent() {
            children_of
                .entry(parent.to_path_buf())
                .or_default()
                .push(folder.clone());
        }
    }
    fn node(
        folder: &Path,
        name: String,
        layout: &BTreeMap<PathBuf, i64>,
        kids_of: &HashMap<PathBuf, Vec<PathBuf>>,
    ) -> FolderPreview {
        let mut children: Vec<FolderPreview> = kids_of
            .get(folder)
            .map(|list| {
                list.iter()
                    .map(|c| {
                        let cname = c
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();
                        node(c, cname, layout, kids_of)
                    })
                    .collect()
            })
            .unwrap_or_default();
        children.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        FolderPreview {
            name,
            path: folder.to_string_lossy().to_string(),
            media_count: *layout.get(folder).unwrap_or(&0),
            children,
        }
    }
    node(root, root_name.to_string(), layout, &children_of)
}

/// Preview the album tree that would be created for each import path. Pure
/// filesystem work — no database access.
#[tauri::command]
pub async fn preview_import_tree(paths: Vec<String>) -> Result<Vec<FolderPreview>> {
    blocking(move || {
        let mut out = Vec::new();
        for p in &paths {
            let root = PathBuf::from(p);
            let root_name = root
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(p.as_str())
                .to_string();
            let counts = media_counts(&root);
            let layout = album_layout(&root, &counts);
            out.push(build_preview(&root, &layout, &root_name));
        }
        Ok(out)
    })
    .await
}

/// Import folders, building a nested album hierarchy mirroring the on-disk tree
/// and scheduling a scan that assigns each scanned photo to its folder's album.
#[tauri::command]
pub async fn import_as_albums(
    state: State<'_, SharedState>,
    paths: Vec<String>,
    root_names: Vec<String>,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let mut assign: HashMap<String, String> = HashMap::new();
        for (i, p) in paths.iter().enumerate() {
            let root = PathBuf::from(p);
            let root_name = root_names
                .get(i)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| {
                    root.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(p.as_str())
                        .to_string()
                });
            let counts = media_counts(&root);
            let layout = album_layout(&root, &counts);
            let mut folder_to_album: HashMap<PathBuf, String> = HashMap::new();
            for folder in layout.keys() {
                let name = if folder == &root {
                    root_name.clone()
                } else {
                    folder
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Album")
                        .to_string()
                };
                let parent_id = if folder == &root {
                    None
                } else {
                    folder
                        .parent()
                        .and_then(|pp| folder_to_album.get(pp))
                        .cloned()
                };
                let album = albums::create(&conn, &name, parent_id.as_deref(), now())?;
                folder_to_album.insert(folder.clone(), album.id);
            }
            for folder in counts.keys() {
                let target = clamp_to_album(&root, folder);
                if let Some(album_id) = folder_to_album.get(&target) {
                    assign.insert(folder.to_string_lossy().to_string(), album_id.clone());
                }
            }
            folders::add(&conn, p, now())?;
        }
        let roots: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        state.scanner.spawn_scan_with_albums(roots, assign);
        crate::api::scan::install_watcher(&state, &conn)?;
        Ok(())
    })
    .await
}
