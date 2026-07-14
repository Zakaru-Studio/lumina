//! Watched-folder repository: the set of import roots monitored in real time.

use rusqlite::{params, Connection};

use crate::core::error::{Error, Result};
use crate::core::models::WatchedFolder;

/// List all watched folders (most recently added first).
pub fn list(conn: &Connection) -> Result<Vec<WatchedFolder>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, added_at, active, mirror FROM watched_folders ORDER BY added_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_folder)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Map a `watched_folders` row (id, path, added_at, active, mirror) to a model.
fn row_to_folder(r: &rusqlite::Row) -> rusqlite::Result<WatchedFolder> {
    Ok(WatchedFolder {
        id: r.get(0)?,
        path: r.get(1)?,
        added_at: r.get(2)?,
        active: r.get::<_, i64>(3)? != 0,
        mirror: r.get::<_, i64>(4)? != 0,
    })
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
        mirror: false,
    })
}

/// Remove a watched folder by id. Photos already imported are retained.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM watched_folders WHERE id = ?1", params![id])?;
    Ok(())
}

/// Mark (or unmark) a watched folder as a bidirectional mirror root, keyed by
/// its path. Idempotent; a no-op if the path isn't registered.
pub fn set_mirror(conn: &Connection, path: &str, mirror: bool) -> Result<()> {
    conn.execute(
        "UPDATE watched_folders SET mirror = ?2 WHERE path = ?1",
        params![path, mirror as i64],
    )?;
    Ok(())
}

/// List the paths of all active mirror roots.
pub fn mirror_roots(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT path FROM watched_folders WHERE mirror = 1 AND active = 1")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn find_by_path(conn: &Connection, path: &str) -> Result<Option<WatchedFolder>> {
    match conn.query_row(
        "SELECT id, path, added_at, active, mirror FROM watched_folders WHERE path = ?1",
        params![path],
        row_to_folder,
    ) {
        Ok(f) => Ok(Some(f)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Error::Database(e)),
    }
}
