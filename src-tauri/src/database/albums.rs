//! Album repository: manual collections plus built-in smart albums.
//!
//! Smart albums store a small JSON `rule` describing a dynamic filter (e.g.
//! `{"preset":"today"}`). [`resolve_smart_filter`] turns a rule into a concrete
//! [`PhotoFilter`] at query time, so date-relative albums stay correct as the
//! clock advances.

use chrono::{Datelike, Local, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;

use crate::core::error::{Error, Result};
use crate::core::models::{Album, AlbumKind};
use crate::core::query::PhotoFilter;
use crate::database::photos;

/// Ensure the built-in smart albums exist. Idempotent — safe to call at boot.
pub fn seed_smart_albums(conn: &Connection, now: i64) -> Result<()> {
    // Drop the deprecated built-in RAW smart album (superseded by the RAW filter
    // in the library). Harmless when absent; also removes it for existing DBs.
    conn.execute(
        "DELETE FROM albums WHERE kind = 'smart' AND json_extract(rule, '$.preset') = 'raw'",
        [],
    )?;
    // (name, icon, preset, sort_order)
    const DEFAULTS: &[(&str, &str, &str, i64)] = &[
        ("Today", "sun", "today", 0),
        ("This Week", "calendar-days", "week", 1),
        ("This Month", "calendar", "month", 2),
        ("Favorites", "heart", "favorites", 3),
        ("Videos", "video", "videos", 5),
        ("Duplicates", "copy", "duplicates", 6),
    ];
    for (name, icon, preset, order) in DEFAULTS {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM albums WHERE kind = 'smart' AND json_extract(rule, '$.preset') = ?1)",
            params![preset],
            |r| r.get(0),
        )?;
        if !exists {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO albums (id, name, kind, rule, icon, sort_order, created_at) \
                 VALUES (?1, ?2, 'smart', ?3, ?4, ?5, ?6)",
                params![id, name, json!({ "preset": preset }).to_string(), icon, order, now],
            )?;
        }
    }
    Ok(())
}

/// List all albums with counts (manual: membership; smart: evaluated).
pub fn list(conn: &Connection, now: i64) -> Result<Vec<Album>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, kind, rule, icon, sort_order, created_at, parent_id, folder_path FROM albums \
         ORDER BY kind DESC, sort_order ASC, name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        let rule_str: Option<String> = r.get(3)?;
        Ok((
            Album {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: AlbumKind::from_str_lenient(&r.get::<_, String>(2)?),
                rule: None,
                icon: r.get(4)?,
                sort_order: r.get(5)?,
                created_at: r.get(6)?,
                parent_id: r.get(7)?,
                folder_path: r.get(8)?,
                count: 0,
                cover_thumb_path: None,
            },
            rule_str,
        ))
    })?;

    let mut out = Vec::new();
    for r in rows {
        let (mut album, rule_str) = r?;
        album.rule = rule_str
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());
        album.count = count_of(conn, &album, now)?;
        album.cover_thumb_path = cover_of(conn, &album, now)?;
        out.push(album);
    }
    Ok(out)
}

/// Evaluate an album's live photo count: membership for manual albums, the
/// resolved smart filter (or the dedicated hash grouping for Duplicates) for
/// smart albums. Shared by [`list`] and [`get`] so a single album's header
/// count matches the sidebar.
fn count_of(conn: &Connection, album: &Album, now: i64) -> Result<i64> {
    Ok(match album.kind {
        AlbumKind::Manual => conn.query_row(
            "SELECT COUNT(*) FROM album_photos ap JOIN photos p ON p.id = ap.photo_id \
             WHERE ap.album_id = ?1 AND p.deleted_at IS NULL",
            params![album.id],
            |r| r.get(0),
        )?,
        AlbumKind::Smart => {
            if preset_of(album) == Some("duplicates") {
                photos::duplicates_total(conn)?
            } else {
                let filter = album
                    .rule
                    .as_ref()
                    .map(|r| resolve_smart_filter(r, now))
                    .unwrap_or_default();
                photos::count(conn, &filter)?
            }
        }
    })
}

/// Resolve an album's representative cover thumbnail: the newest live photo's
/// thumb for a manual album (by membership) or a smart album (via the resolved
/// filter, or the dedicated hash grouping for Duplicates). Mirrors [`count_of`]
/// so [`list`] and [`get`] surface a consistent cover.
fn cover_of(conn: &Connection, album: &Album, now: i64) -> Result<Option<String>> {
    match album.kind {
        AlbumKind::Manual => photos::cover_thumb(
            conn,
            &PhotoFilter {
                album_id: Some(album.id.clone()),
                ..Default::default()
            },
        ),
        AlbumKind::Smart => {
            if preset_of(album) == Some("duplicates") {
                photos::duplicates_cover_thumb(conn)
            } else {
                let filter = album
                    .rule
                    .as_ref()
                    .map(|r| resolve_smart_filter(r, now))
                    .unwrap_or_default();
                photos::cover_thumb(conn, &filter)
            }
        }
    }
}

/// Fetch a single album by id, with its live photo count.
pub fn get(conn: &Connection, id: &str, now: i64) -> Result<Album> {
    let rule_str: Option<String>;
    let mut album = conn
        .query_row(
            "SELECT id, name, kind, rule, icon, sort_order, created_at, parent_id, folder_path FROM albums WHERE id = ?1",
            params![id],
            |r| {
                Ok(Album {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: AlbumKind::from_str_lenient(&r.get::<_, String>(2)?),
                    rule: None,
                    icon: r.get(4)?,
                    sort_order: r.get(5)?,
                    created_at: r.get(6)?,
                    parent_id: r.get(7)?,
                    folder_path: r.get(8)?,
                    count: 0,
                    cover_thumb_path: None,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Error::NotFound(format!("album {id}")),
            other => Error::Database(other),
        })?;
    rule_str = conn.query_row("SELECT rule FROM albums WHERE id = ?1", params![id], |r| {
        r.get(0)
    })?;
    album.rule = rule_str
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());
    album.count = count_of(conn, &album, now)?;
    album.cover_thumb_path = cover_of(conn, &album, now)?;
    Ok(album)
}

/// Create a manual album, optionally nested under `parent_id`. Virtual album:
/// `folder_path` is left NULL (see [`create_with_folder`] for mirror albums).
pub fn create(
    conn: &Connection,
    name: &str,
    parent_id: Option<&str>,
    now: i64,
) -> Result<Album> {
    create_with_folder(conn, name, parent_id, None, now)
}

/// Create a manual album, optionally nested under `parent_id`, recording the
/// on-disk directory it mirrors in `folder_path` (`None` = a virtual album).
/// Mirror-tree imports and reconciliation use the `Some(..)` form so structural
/// album ops can later propagate to disk.
pub fn create_with_folder(
    conn: &Connection,
    name: &str,
    parent_id: Option<&str>,
    folder_path: Option<&str>,
    now: i64,
) -> Result<Album> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("album name must not be empty".into()));
    }
    // A parent, if given, must be an existing manual album.
    if let Some(pid) = parent_id {
        ensure_manual(conn, pid)?;
    }
    // Append after the current last sibling in the target group.
    let sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM albums \
         WHERE kind = 'manual' AND parent_id IS ?1",
        params![parent_id],
        |r| r.get(0),
    )?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO albums (id, name, kind, rule, icon, sort_order, created_at, parent_id, folder_path) \
         VALUES (?1, ?2, 'manual', NULL, 'folder', ?3, ?4, ?5, ?6)",
        params![id, name, sort_order, now, parent_id, folder_path],
    )?;
    Ok(Album {
        id,
        name: name.to_string(),
        kind: AlbumKind::Manual,
        rule: None,
        icon: Some("folder".into()),
        sort_order,
        created_at: now,
        parent_id: parent_id.map(str::to_string),
        folder_path: folder_path.map(str::to_string),
        count: 0,
        cover_thumb_path: None,
    })
}

/// Confirm `id` refers to an existing manual album, erroring otherwise.
fn ensure_manual(conn: &Connection, id: &str) -> Result<()> {
    let kind: Option<String> = conn
        .query_row("SELECT kind FROM albums WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;
    match kind.as_deref() {
        Some("manual") => Ok(()),
        Some(_) => Err(Error::Invalid("album is not a manual album".into())),
        None => Err(Error::NotFound(format!("manual album {id}"))),
    }
}

/// Move a manual album under a new parent (`None` = root) and place it at
/// `new_index` among its new siblings. Reparenting and reordering happen
/// atomically. Rejects cycles (an album cannot become its own descendant).
pub fn reparent(
    conn: &Connection,
    id: &str,
    new_parent_id: Option<&str>,
    new_index: usize,
) -> Result<()> {
    ensure_manual(conn, id)?;
    if let Some(pid) = new_parent_id {
        if pid == id {
            return Err(Error::Invalid("an album cannot be its own parent".into()));
        }
        ensure_manual(conn, pid)?;
        // Walk up from the target parent; hitting `id` would create a cycle.
        let mut cursor = Some(pid.to_string());
        while let Some(current) = cursor {
            if current == id {
                return Err(Error::Invalid(
                    "cannot move an album into its own subtree".into(),
                ));
            }
            cursor = conn
                .query_row(
                    "SELECT parent_id FROM albums WHERE id = ?1",
                    params![current],
                    |r| r.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten();
        }
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE albums SET parent_id = ?2 WHERE id = ?1 AND kind = 'manual'",
        params![id, new_parent_id],
    )?;
    // Renumber the destination sibling group with `id` inserted at `new_index`.
    let mut siblings: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT id FROM albums \
             WHERE kind = 'manual' AND parent_id IS ?1 AND id != ?2 \
             ORDER BY sort_order ASC, name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map(params![new_parent_id, id], |r| r.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let idx = new_index.min(siblings.len());
    siblings.insert(idx, id.to_string());
    for (order, sib) in siblings.iter().enumerate() {
        tx.execute(
            "UPDATE albums SET sort_order = ?2 WHERE id = ?1",
            params![sib, order as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Rename a manual album.
pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("album name must not be empty".into()));
    }
    let n = conn.execute(
        "UPDATE albums SET name = ?2 WHERE id = ?1 AND kind = 'manual'",
        params![id, name],
    )?;
    if n == 0 {
        return Err(Error::NotFound(format!("manual album {id}")));
    }
    Ok(())
}

/// Delete a manual album (smart albums are protected).
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let n = conn.execute(
        "DELETE FROM albums WHERE id = ?1 AND kind = 'manual'",
        params![id],
    )?;
    if n == 0 {
        return Err(Error::Invalid(
            "album not found or is a protected smart album".into(),
        ));
    }
    Ok(())
}

/// Row-mapper for a fully-projected album row (see the shared column list).
fn map_album(r: &rusqlite::Row) -> rusqlite::Result<Album> {
    Ok(Album {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: AlbumKind::from_str_lenient(&r.get::<_, String>(2)?),
        rule: None,
        icon: r.get(4)?,
        sort_order: r.get(5)?,
        created_at: r.get(6)?,
        parent_id: r.get(7)?,
        folder_path: r.get(8)?,
        count: 0,
        cover_thumb_path: None,
    })
}

/// All mirror albums whose `folder_path` is exactly `root` or nested under it.
/// Ordered by path so ancestors precede descendants. Uses a byte-range over the
/// `folder_path` index (mirrors [`crate::database::photos::by_path_prefix`]) so
/// `_`/`%`/separators in folder names can't cause false matches.
pub fn mirror_albums_under(conn: &Connection, root: &str) -> Result<Vec<Album>> {
    let sep = std::path::MAIN_SEPARATOR;
    let low = format!("{root}{sep}");
    let high = format!("{root}{}", ((sep as u8) + 1) as char);
    let sql =
        "SELECT id, name, kind, rule, icon, sort_order, created_at, parent_id, folder_path \
         FROM albums \
         WHERE folder_path IS NOT NULL AND (folder_path = ?1 OR (folder_path >= ?2 AND folder_path < ?3)) \
         ORDER BY folder_path";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![root, low, high], map_album)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Rename a mirror album's own name and rewrite the `folder_path` of the album
/// at exactly `old_prefix` plus every descendant mirror album whose
/// `folder_path` is nested under it (`old_prefix` → `new_prefix`). Keeps the
/// album tree's stored paths in lock-step with a folder rename/move on disk.
pub fn relocate_folder_prefix(conn: &Connection, old_prefix: &str, new_prefix: &str) -> Result<()> {
    let affected = mirror_albums_under(conn, old_prefix)?;
    let tx = conn.unchecked_transaction()?;
    for a in &affected {
        let Some(fp) = a.folder_path.as_deref() else {
            continue;
        };
        // `old_prefix` is a byte-prefix of `fp` (guaranteed by the range query).
        let rest = &fp[old_prefix.len()..];
        let new_fp = format!("{new_prefix}{rest}");
        tx.execute(
            "UPDATE albums SET folder_path = ?2 WHERE id = ?1",
            params![a.id, new_fp],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Collect an album id and every descendant (via `parent_id`), breadth-first.
pub fn subtree_ids(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut out = vec![id.to_string()];
    let mut frontier = vec![id.to_string()];
    while let Some(cur) = frontier.pop() {
        let mut stmt =
            conn.prepare("SELECT id FROM albums WHERE parent_id = ?1 AND kind = 'manual'")?;
        let kids = stmt
            .query_map(params![cur], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for k in kids {
            out.push(k.clone());
            frontier.push(k);
        }
    }
    Ok(out)
}

/// Delete a manual album and its entire subtree (children are deleted rather
/// than promoted to root — the parent FK is `ON DELETE SET NULL`). Membership
/// links cascade. Returns the number of album rows removed.
pub fn delete_with_descendants(conn: &Connection, id: &str) -> Result<usize> {
    let ids = subtree_ids(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    // Delete leaves first (reverse of the BFS order) to avoid transient promotion.
    for aid in ids.iter().rev() {
        n += tx.execute(
            "DELETE FROM albums WHERE id = ?1 AND kind = 'manual'",
            params![aid],
        )?;
    }
    tx.commit()?;
    Ok(n)
}

/// Add photos to a manual album (idempotent).
pub fn add_photos(conn: &Connection, album_id: &str, photo_ids: &[String], now: i64) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for pid in photo_ids {
        tx.execute(
            "INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_at) VALUES (?1, ?2, ?3)",
            params![album_id, pid, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Bulk-assign photos to albums by exact folder match. `map` is folder path ->
/// album id. Idempotent. Used by the "import as albums" flow after a scan.
pub fn assign_by_folder(
    conn: &Connection,
    map: &std::collections::HashMap<String, String>,
    now: i64,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (folder, album_id) in map {
        tx.execute(
            "INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_at) \
             SELECT ?1, id, ?3 FROM photos WHERE folder = ?2 AND deleted_at IS NULL",
            params![album_id, folder, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Make a folder-backed (mirror) album's membership EXACTLY the live photos whose
/// `folder` equals `folder_path` — authoritative, unlike the additive
/// [`assign_by_folder`]. Used by reconciliation so a photo moved between folders
/// in Explorer ends up in its new folder's album and is dropped from the old one.
pub fn resync_folder_album(
    conn: &Connection,
    album_id: &str,
    folder_path: &str,
    now: i64,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    // Drop members that are no longer live photos directly in this folder.
    tx.execute(
        "DELETE FROM album_photos WHERE album_id = ?1 AND photo_id NOT IN \
         (SELECT id FROM photos WHERE folder = ?2 AND deleted_at IS NULL)",
        params![album_id, folder_path],
    )?;
    // Add every live photo now in this folder.
    tx.execute(
        "INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_at) \
         SELECT ?1, id, ?3 FROM photos WHERE folder = ?2 AND deleted_at IS NULL",
        params![album_id, folder_path, now],
    )?;
    tx.commit()?;
    Ok(())
}

/// Remove photos from a manual album.
pub fn remove_photos(conn: &Connection, album_id: &str, photo_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for pid in photo_ids {
        tx.execute(
            "DELETE FROM album_photos WHERE album_id = ?1 AND photo_id = ?2",
            params![album_id, pid],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Extract the `preset` string from a smart album's rule, if any.
pub fn preset_of(album: &Album) -> Option<&str> {
    album
        .rule
        .as_ref()
        .and_then(|r| r.get("preset"))
        .and_then(|v| v.as_str())
}

/// Translate a smart-album rule into a concrete filter for the given `now`
/// (Unix seconds). Unknown presets yield an empty filter (all photos).
pub fn resolve_smart_filter(rule: &serde_json::Value, now: i64) -> PhotoFilter {
    let preset = rule.get("preset").and_then(|v| v.as_str()).unwrap_or("");
    let mut filter = PhotoFilter::default();
    let now_local = Local.timestamp_opt(now, 0).single();
    match preset {
        "today" => {
            if let Some(start) = now_local.and_then(|dt| {
                Local
                    .with_ymd_and_hms(dt.year(), dt.month(), dt.day(), 0, 0, 0)
                    .single()
            }) {
                filter.date_from = Some(start.timestamp());
            }
        }
        "week" => {
            if let Some(dt) = now_local {
                let weekday = dt.weekday().num_days_from_monday() as i64;
                let midnight = Local
                    .with_ymd_and_hms(dt.year(), dt.month(), dt.day(), 0, 0, 0)
                    .single();
                if let Some(m) = midnight {
                    filter.date_from = Some(m.timestamp() - weekday * 86_400);
                }
            }
        }
        "month" => {
            if let Some(start) = now_local.and_then(|dt| {
                Local
                    .with_ymd_and_hms(dt.year(), dt.month(), 1, 0, 0, 0)
                    .single()
            }) {
                filter.date_from = Some(start.timestamp());
            }
        }
        "favorites" => filter.is_favorite = Some(true),
        "raw" => filter.is_raw = Some(true),
        "videos" => filter.media_type = Some("video".to_string()),
        _ => {}
    }
    filter
}
