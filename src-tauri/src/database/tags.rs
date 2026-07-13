//! Tag repository: create/rename/delete tags and manage photo↔tag links.

use rusqlite::{params, Connection};

use crate::core::error::{Error, Result};
use crate::core::models::Tag;
use crate::search;

/// List all tags with their live-photo counts, alphabetically.
pub fn list(conn: &Connection) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, t.created_at, \
                (SELECT COUNT(*) FROM photo_tags pt \
                 JOIN photos p ON p.id = pt.photo_id \
                 WHERE pt.tag_id = t.id AND p.deleted_at IS NULL) AS cnt \
         FROM tags t ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            created_at: r.get(3)?,
            count: r.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Create a tag (or return the existing one with the same name).
pub fn create(conn: &Connection, name: &str, color: Option<&str>, now: i64) -> Result<Tag> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("tag name must not be empty".into()));
    }
    if let Some(existing) = find_by_name(conn, name)? {
        return Ok(existing);
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, color, now],
    )?;
    Ok(Tag {
        id,
        name: name.to_string(),
        color: color.map(str::to_string),
        created_at: now,
        count: 0,
    })
}

fn find_by_name(conn: &Connection, name: &str) -> Result<Option<Tag>> {
    match conn.query_row(
        "SELECT id, name, color, created_at FROM tags WHERE name = ?1 COLLATE NOCASE",
        params![name],
        |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                created_at: r.get(3)?,
                count: 0,
            })
        },
    ) {
        Ok(t) => Ok(Some(t)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Error::Database(e)),
    }
}

/// Rename and/or recolor a tag.
pub fn update(conn: &Connection, id: &str, name: &str, color: Option<&str>) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("tag name must not be empty".into()));
    }
    let affected = conn.execute(
        "UPDATE tags SET name = ?2, color = ?3 WHERE id = ?1",
        params![id, name, color],
    )?;
    if affected == 0 {
        return Err(Error::NotFound(format!("tag {id}")));
    }
    reindex_photos_for_tag(conn, id)?;
    Ok(())
}

/// Delete a tag (its photo links cascade). FTS rows for affected photos are
/// rebuilt so tag text disappears from search.
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let photo_ids = photo_ids_for_tag(conn, id)?;
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    for pid in photo_ids {
        search::reindex_tags(conn, &pid)?;
    }
    Ok(())
}

/// Attach a tag to many photos (idempotent).
pub fn attach(conn: &Connection, tag_id: &str, photo_ids: &[String], now: i64) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for pid in photo_ids {
        tx.execute(
            "INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?1, ?2)",
            params![pid, tag_id],
        )?;
        let _ = now; // reserved for future audit columns
        search::reindex_tags(&tx, pid)?;
    }
    tx.commit()?;
    Ok(())
}

/// Detach a tag from many photos.
pub fn detach(conn: &Connection, tag_id: &str, photo_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for pid in photo_ids {
        tx.execute(
            "DELETE FROM photo_tags WHERE photo_id = ?1 AND tag_id = ?2",
            params![pid, tag_id],
        )?;
        search::reindex_tags(&tx, pid)?;
    }
    tx.commit()?;
    Ok(())
}

fn photo_ids_for_tag(conn: &Connection, tag_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT photo_id FROM photo_tags WHERE tag_id = ?1")?;
    let rows = stmt.query_map(params![tag_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn reindex_photos_for_tag(conn: &Connection, tag_id: &str) -> Result<()> {
    for pid in photo_ids_for_tag(conn, tag_id)? {
        search::reindex_tags(conn, &pid)?;
    }
    Ok(())
}
