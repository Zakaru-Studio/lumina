//! Watched-folder repository: the set of import roots monitored in real time.

use rusqlite::{params, Connection};

use crate::core::error::{Error, Result};
use crate::core::models::WatchedFolder;

/// List all watched folders (most recently added first).
pub fn list(conn: &Connection) -> Result<Vec<WatchedFolder>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, added_at, active FROM watched_folders ORDER BY added_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(WatchedFolder {
            id: r.get(0)?,
            path: r.get(1)?,
            added_at: r.get(2)?,
            active: r.get::<_, i64>(3)? != 0,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Add a watched folder (idempotent on path). Returns the stored row.
pub fn add(conn: &Connection, path: &str, now: i64) -> Result<WatchedFolder> {
    if path.trim().is_empty() {
        return Err(Error::Invalid("folder path must not be empty".into()));
    }
    if let Some(existing) = find_by_path(conn, path)? {
        return Ok(existing);
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO watched_folders (id, path, added_at, active) VALUES (?1, ?2, ?3, 1)",
        params![id, path, now],
    )?;
    Ok(WatchedFolder {
        id,
        path: path.to_string(),
        added_at: now,
        active: true,
    })
}

/// Remove a watched folder by id. Photos already imported are retained.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM watched_folders WHERE id = ?1", params![id])?;
    Ok(())
}

fn find_by_path(conn: &Connection, path: &str) -> Result<Option<WatchedFolder>> {
    match conn.query_row(
        "SELECT id, path, added_at, active FROM watched_folders WHERE path = ?1",
        params![path],
        |r| {
            Ok(WatchedFolder {
                id: r.get(0)?,
                path: r.get(1)?,
                added_at: r.get(2)?,
                active: r.get::<_, i64>(3)? != 0,
            })
        },
    ) {
        Ok(f) => Ok(Some(f)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Error::Database(e)),
    }
}
