//! Full-text search: owns the `photos_fts` FTS5 index and the translation of
//! user text into a safe `MATCH` expression.
//!
//! The index is a denormalized text projection of each photo (filename,
//! folder, camera, lens, tags, color). It is maintained transactionally from
//! the photo/tag repositories so edits never leave search stale.

use rusqlite::{params, Connection};

use crate::core::error::Result;
use crate::core::models::{ColorLabel, Photo};

/// Combine make + model into a single searchable "camera" string.
fn camera_text(make: Option<&str>, model: Option<&str>) -> String {
    match (make, model) {
        (Some(mk), Some(md)) => format!("{mk} {md}"),
        (Some(mk), None) => mk.to_string(),
        (None, Some(md)) => md.to_string(),
        (None, None) => String::new(),
    }
}

/// Replace the FTS row for `photo_id` with the given projection.
fn upsert_row(
    conn: &Connection,
    photo_id: &str,
    filename: &str,
    folder: &str,
    camera: &str,
    lens: &str,
    tags: &str,
    color: &str,
) -> Result<()> {
    conn.execute(
        "DELETE FROM photos_fts WHERE photo_id = ?1",
        params![photo_id],
    )?;
    conn.execute(
        "INSERT INTO photos_fts (photo_id, filename, folder, camera, lens, tags, color) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![photo_id, filename, folder, camera, lens, tags, color],
    )?;
    Ok(())
}

/// Index a freshly upserted photo (called by the photo repository).
pub fn index_photo(conn: &Connection, id: &str, p: &Photo, tags: &[String]) -> Result<()> {
    upsert_row(
        conn,
        id,
        &p.filename,
        &p.folder,
        &camera_text(p.camera_make.as_deref(), p.camera_model.as_deref()),
        p.lens.as_deref().unwrap_or(""),
        &tags.join(" "),
        p.color_label.as_str(),
    )
}

/// Rebuild the FTS row for a photo from current database state.
pub fn reindex(conn: &Connection, id: &str) -> Result<()> {
    let row = conn.query_row(
        "SELECT filename, folder, camera_make, camera_model, lens, color_label \
         FROM photos WHERE id = ?1",
        params![id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
            ))
        },
    );
    let (filename, folder, make, model, lens, color) = match row {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    let tags = crate::database::photos::load_tags(conn, id)?;
    upsert_row(
        conn,
        id,
        &filename,
        &folder,
        &camera_text(make.as_deref(), model.as_deref()),
        lens.as_deref().unwrap_or(""),
        &tags.join(" "),
        &color,
    )
}

/// Convenience alias used after tag edits.
pub fn reindex_tags(conn: &Connection, id: &str) -> Result<()> {
    reindex(conn, id)
}

/// Convenience alias used after a color-label change (value already persisted).
pub fn reindex_color(conn: &Connection, id: &str, _color: ColorLabel) -> Result<()> {
    reindex(conn, id)
}

/// Drop a photo from the search index (on soft delete).
pub fn remove_photo(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM photos_fts WHERE photo_id = ?1", params![id])?;
    Ok(())
}

/// Convert free-text user input into a safe FTS5 `MATCH` expression, using
/// prefix matching on each token so search feels instant while typing. Returns
/// `None` when there is nothing meaningful to match.
pub fn to_match_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| {
            // Quote the token (escaping embedded quotes) and add a prefix `*`.
            let escaped = t.replace('"', "\"\"");
            format!("\"{escaped}\"*")
        })
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_yields_none() {
        assert!(to_match_query("   ").is_none());
    }

    #[test]
    fn builds_prefix_terms() {
        assert_eq!(to_match_query("nikon 50"), Some("\"nikon\"* \"50\"*".to_string()));
    }

    #[test]
    fn escapes_quotes() {
        assert_eq!(to_match_query("a\"b"), Some("\"a\"\"b\"*".to_string()));
    }
}
