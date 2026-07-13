//! Album repository: manual collections plus built-in smart albums.
//!
//! Smart albums store a small JSON `rule` describing a dynamic filter (e.g.
//! `{"preset":"today"}`). [`resolve_smart_filter`] turns a rule into a concrete
//! [`PhotoFilter`] at query time, so date-relative albums stay correct as the
//! clock advances.

use chrono::{Datelike, Local, TimeZone};
use rusqlite::{params, Connection};
use serde_json::json;

use crate::core::error::{Error, Result};
use crate::core::models::{Album, AlbumKind};
use crate::core::query::PhotoFilter;
use crate::database::photos;

/// Ensure the built-in smart albums exist. Idempotent — safe to call at boot.
pub fn seed_smart_albums(conn: &Connection, now: i64) -> Result<()> {
    // (name, icon, preset, sort_order)
    const DEFAULTS: &[(&str, &str, &str, i64)] = &[
        ("Today", "sun", "today", 0),
        ("This Week", "calendar-days", "week", 1),
        ("This Month", "calendar", "month", 2),
        ("Favorites", "heart", "favorites", 3),
        ("RAW", "aperture", "raw", 4),
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
        "SELECT id, name, kind, rule, icon, sort_order, created_at FROM albums \
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
                count: 0,
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
        album.count = match album.kind {
            AlbumKind::Manual => conn.query_row(
                "SELECT COUNT(*) FROM album_photos ap JOIN photos p ON p.id = ap.photo_id \
                 WHERE ap.album_id = ?1 AND p.deleted_at IS NULL",
                params![album.id],
                |r| r.get(0),
            )?,
            AlbumKind::Smart => {
                if preset_of(&album) == Some("duplicates") {
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
        };
        out.push(album);
    }
    Ok(out)
}

/// Fetch a single album by id.
pub fn get(conn: &Connection, id: &str) -> Result<Album> {
    let rule_str: Option<String>;
    let mut album = conn
        .query_row(
            "SELECT id, name, kind, rule, icon, sort_order, created_at FROM albums WHERE id = ?1",
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
                    count: 0,
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
    Ok(album)
}

/// Create a manual album.
pub fn create(conn: &Connection, name: &str, now: i64) -> Result<Album> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("album name must not be empty".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO albums (id, name, kind, rule, icon, sort_order, created_at) \
         VALUES (?1, ?2, 'manual', NULL, 'folder', 100, ?3)",
        params![id, name, now],
    )?;
    Ok(Album {
        id,
        name: name.to_string(),
        kind: AlbumKind::Manual,
        rule: None,
        icon: Some("folder".into()),
        sort_order: 100,
        created_at: now,
        count: 0,
    })
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
