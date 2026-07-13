//! Photo repository: inserts from the scanner, catalog queries, listing with
//! filtering/sorting/pagination, timeline aggregation and non-destructive
//! mutations (rating, color, favorite, soft delete, thumbnail status).

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, Row};

use crate::core::error::{Error, Result};
use crate::core::models::{
    ColorLabel, LibraryStats, MediaType, Photo, ThumbStatus, TimelineSection,
};
use crate::core::query::{Page, PhotoFilter, PhotoQuery, SortBy, SortDir};
use crate::search;

/// Column projection shared by every `SELECT` so [`map_row`] stays valid.
const COLUMNS: &str = "id, path, filename, folder, format, media_type, \
    taken_at, file_created, file_modified, imported_at, \
    width, height, orientation, file_size, \
    camera_make, camera_model, lens, iso, focal_length, aperture, shutter_speed, \
    gps_lat, gps_lon, hash, rating, color_label, is_favorite, is_raw, \
    thumb_status, thumb_path";

/// Map a fully-projected row (see [`COLUMNS`]) to a [`Photo`]. Tags are not
/// included here — call [`load_tags`] when a detail view needs them.
fn map_row(row: &Row<'_>) -> rusqlite::Result<Photo> {
    Ok(Photo {
        id: row.get(0)?,
        path: row.get(1)?,
        filename: row.get(2)?,
        folder: row.get(3)?,
        format: row.get(4)?,
        media_type: MediaType::from_str_lenient(&row.get::<_, String>(5)?),
        taken_at: row.get(6)?,
        file_created: row.get(7)?,
        file_modified: row.get(8)?,
        imported_at: row.get(9)?,
        width: row.get::<_, i64>(10)? as u32,
        height: row.get::<_, i64>(11)? as u32,
        orientation: row.get::<_, i64>(12)? as u16,
        file_size: row.get(13)?,
        camera_make: row.get(14)?,
        camera_model: row.get(15)?,
        lens: row.get(16)?,
        iso: row.get(17)?,
        focal_length: row.get(18)?,
        aperture: row.get(19)?,
        shutter_speed: row.get(20)?,
        gps_lat: row.get(21)?,
        gps_lon: row.get(22)?,
        hash: row.get(23)?,
        rating: row.get::<_, i64>(24)?.clamp(0, 5) as u8,
        color_label: ColorLabel::from_str_lenient(&row.get::<_, String>(25)?),
        is_favorite: row.get::<_, i64>(26)? != 0,
        is_raw: row.get::<_, i64>(27)? != 0,
        thumb_status: ThumbStatus::from_str_lenient(&row.get::<_, String>(28)?),
        thumb_path: row.get(29)?,
        tags: Vec::new(),
    })
}

/// Fetch a single live photo by id, including its tags.
pub fn get(conn: &Connection, id: &str) -> Result<Photo> {
    let sql = format!("SELECT {COLUMNS} FROM photos WHERE id = ?1 AND deleted_at IS NULL");
    let mut photo = conn
        .query_row(&sql, params![id], |r| map_row(r))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Error::NotFound(format!("photo {id}")),
            other => Error::Database(other),
        })?;
    photo.tags = load_tags(conn, id)?;
    Ok(photo)
}

/// Look up a photo by absolute path (used by the scanner for dedupe/update).
pub fn get_by_path(conn: &Connection, path: &str) -> Result<Option<Photo>> {
    let sql = format!("SELECT {COLUMNS} FROM photos WHERE path = ?1");
    match conn.query_row(&sql, params![path], |r| map_row(r)) {
        Ok(p) => Ok(Some(p)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Error::Database(e)),
    }
}

/// Load the tag names attached to a photo (sorted).
pub fn load_tags(conn: &Connection, photo_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tags t \
         JOIN photo_tags pt ON pt.tag_id = t.id \
         WHERE pt.photo_id = ?1 ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![photo_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Insert a new photo or update the mutable metadata of an existing one (keyed
/// by `path`). Catalog-only fields (rating, color, favorite, tags) are
/// preserved on update. Also refreshes the FTS index row.
pub fn upsert(conn: &Connection, p: &Photo) -> Result<()> {
    conn.execute(
        "INSERT INTO photos (\
            id, path, filename, folder, format, media_type, \
            taken_at, file_created, file_modified, imported_at, \
            width, height, orientation, file_size, \
            camera_make, camera_model, lens, iso, focal_length, aperture, shutter_speed, \
            gps_lat, gps_lon, hash, rating, color_label, is_favorite, is_raw, \
            thumb_status, thumb_path, deleted_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,NULL) \
         ON CONFLICT(path) DO UPDATE SET \
            filename=excluded.filename, folder=excluded.folder, format=excluded.format, \
            media_type=excluded.media_type, taken_at=excluded.taken_at, \
            file_created=excluded.file_created, file_modified=excluded.file_modified, \
            width=excluded.width, height=excluded.height, orientation=excluded.orientation, \
            file_size=excluded.file_size, camera_make=excluded.camera_make, \
            camera_model=excluded.camera_model, lens=excluded.lens, iso=excluded.iso, \
            focal_length=excluded.focal_length, aperture=excluded.aperture, \
            shutter_speed=excluded.shutter_speed, gps_lat=excluded.gps_lat, \
            gps_lon=excluded.gps_lon, hash=excluded.hash, is_raw=excluded.is_raw, \
            deleted_at=NULL",
        params![
            p.id, p.path, p.filename, p.folder, p.format, p.media_type.as_str(),
            p.taken_at, p.file_created, p.file_modified, p.imported_at,
            p.width as i64, p.height as i64, p.orientation as i64, p.file_size,
            p.camera_make, p.camera_model, p.lens, p.iso, p.focal_length, p.aperture, p.shutter_speed,
            p.gps_lat, p.gps_lon, p.hash, p.rating as i64, p.color_label.as_str(),
            p.is_favorite as i64, p.is_raw as i64, p.thumb_status.as_str(), p.thumb_path,
        ],
    )?;
    // Resolve the authoritative id (an update keeps the pre-existing id).
    let id: String = conn.query_row(
        "SELECT id FROM photos WHERE path = ?1",
        params![p.path],
        |r| r.get(0),
    )?;
    // Rebuild the FTS row from the persisted state so user-set fields
    // (color label, tags) preserved across updates stay searchable.
    search::reindex(conn, &id)?;
    Ok(())
}

/// Update the thumbnail status/path for a photo.
pub fn set_thumb(conn: &Connection, id: &str, status: ThumbStatus, path: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE photos SET thumb_status = ?2, thumb_path = ?3 WHERE id = ?1",
        params![id, status.as_str(), path],
    )?;
    Ok(())
}

/// Return up to `limit` photos still awaiting a thumbnail.
pub fn pending_thumbnails(conn: &Connection, limit: i64) -> Result<Vec<Photo>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM photos \
         WHERE thumb_status = 'pending' AND deleted_at IS NULL \
         ORDER BY imported_at DESC LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit], |r| map_row(r))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/// Build the shared `WHERE` clause and bound parameters for a filter. The
/// returned SQL always starts with `WHERE` and references the `photos` table.
fn build_where(filter: &PhotoFilter) -> (String, Vec<Value>) {
    let mut clauses: Vec<String> = vec!["photos.deleted_at IS NULL".to_string()];
    let mut params: Vec<Value> = Vec::new();

    if let Some(text) = filter.text.as_ref().and_then(|t| search::to_match_query(t)) {
        clauses.push(
            "photos.id IN (SELECT photo_id FROM photos_fts WHERE photos_fts MATCH ?)".to_string(),
        );
        params.push(Value::Text(text));
    }
    if let Some(min) = filter.min_rating {
        clauses.push("photos.rating >= ?".to_string());
        params.push(Value::Integer(min as i64));
    }
    if let Some(color) = &filter.color_label {
        clauses.push("photos.color_label = ?".to_string());
        params.push(Value::Text(color.clone()));
    }
    if let Some(fav) = filter.is_favorite {
        clauses.push("photos.is_favorite = ?".to_string());
        params.push(Value::Integer(fav as i64));
    }
    if let Some(raw) = filter.is_raw {
        clauses.push("photos.is_raw = ?".to_string());
        params.push(Value::Integer(raw as i64));
    }
    if let Some(mt) = &filter.media_type {
        clauses.push("photos.media_type = ?".to_string());
        params.push(Value::Text(mt.clone()));
    }
    if let Some(model) = &filter.camera_model {
        clauses.push("photos.camera_model = ?".to_string());
        params.push(Value::Text(model.clone()));
    }
    if let Some(lens) = &filter.lens {
        clauses.push("photos.lens = ?".to_string());
        params.push(Value::Text(lens.clone()));
    }
    if let Some(folder) = &filter.folder {
        clauses.push("photos.folder LIKE ?".to_string());
        params.push(Value::Text(format!("{folder}%")));
    }
    if let Some(from) = filter.date_from {
        clauses.push("photos.taken_at >= ?".to_string());
        params.push(Value::Integer(from));
    }
    if let Some(to) = filter.date_to {
        clauses.push("photos.taken_at <= ?".to_string());
        params.push(Value::Integer(to));
    }
    if let Some(album) = &filter.album_id {
        clauses.push(
            "photos.id IN (SELECT photo_id FROM album_photos WHERE album_id = ?)".to_string(),
        );
        params.push(Value::Text(album.clone()));
    }
    // Require ALL requested tags via a grouped count.
    for tag in &filter.tags {
        clauses.push(
            "photos.id IN (SELECT pt.photo_id FROM photo_tags pt \
             JOIN tags t ON t.id = pt.tag_id WHERE t.name = ? COLLATE NOCASE)"
                .to_string(),
        );
        params.push(Value::Text(tag.clone()));
    }

    (format!("WHERE {}", clauses.join(" AND ")), params)
}

fn order_clause(sort_by: SortBy, dir: SortDir) -> &'static str {
    let d = match dir {
        SortDir::Asc => "ASC",
        SortDir::Desc => "DESC",
    };
    // Deterministic tie-break on id keeps pagination stable.
    match (sort_by, d) {
        (SortBy::TakenAt, "ASC") => "ORDER BY photos.taken_at ASC, photos.id ASC",
        (SortBy::TakenAt, _) => "ORDER BY photos.taken_at DESC, photos.id DESC",
        (SortBy::ImportedAt, "ASC") => "ORDER BY photos.imported_at ASC, photos.id ASC",
        (SortBy::ImportedAt, _) => "ORDER BY photos.imported_at DESC, photos.id DESC",
        (SortBy::Filename, "ASC") => "ORDER BY photos.filename ASC, photos.id ASC",
        (SortBy::Filename, _) => "ORDER BY photos.filename DESC, photos.id DESC",
        (SortBy::Rating, "ASC") => "ORDER BY photos.rating ASC, photos.id ASC",
        (SortBy::Rating, _) => "ORDER BY photos.rating DESC, photos.id DESC",
        (SortBy::FileSize, "ASC") => "ORDER BY photos.file_size ASC, photos.id ASC",
        (SortBy::FileSize, _) => "ORDER BY photos.file_size DESC, photos.id DESC",
    }
}

/// Count live photos matching a filter.
pub fn count(conn: &Connection, filter: &PhotoFilter) -> Result<i64> {
    let (where_sql, params) = build_where(filter);
    let sql = format!("SELECT COUNT(*) FROM photos {where_sql}");
    let n = conn.query_row(&sql, params_from_iter(params.iter()), |r| r.get(0))?;
    Ok(n)
}

/// List a page of photos for a query (without tags; add them in detail views).
pub fn list(conn: &Connection, query: &PhotoQuery) -> Result<Page<Photo>> {
    let q = query.clone().sanitized();
    let (where_sql, mut params) = build_where(&q.filter);
    let order = order_clause(q.sort_by, q.sort_dir);
    let total = count(conn, &q.filter)?;

    let sql = format!("SELECT {COLUMNS} FROM photos {where_sql} {order} LIMIT ? OFFSET ?");
    params.push(Value::Integer(q.limit));
    params.push(Value::Integer(q.offset));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params.iter()), |r| map_row(r))?;
    let mut items = Vec::with_capacity(q.limit as usize);
    for r in rows {
        items.push(r?);
    }
    Ok(Page {
        items,
        total,
        offset: q.offset,
        limit: q.limit,
    })
}

/// Return the full ordered list of photo ids matching a query (ignoring
/// pagination). This is the lightweight backbone for windowed virtualization:
/// the UI knows every id (for a full-height scrollbar, range selection and
/// select-all) while fetching photo *details* in windows on demand.
pub fn list_ids(conn: &Connection, query: &PhotoQuery) -> Result<Vec<String>> {
    let (where_sql, params) = build_where(&query.filter);
    let order = order_clause(query.sort_by, query.sort_dir);
    let sql = format!("SELECT id FROM photos {where_sql} {order}");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params.iter()), |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Aggregate a filtered set into per-day timeline sections (newest first).
pub fn timeline(conn: &Connection, filter: &PhotoFilter) -> Result<Vec<TimelineSection>> {
    let (where_sql, params) = build_where(filter);
    // Group by local day derived from taken_at (fallback to imported_at).
    let sql = format!(
        "SELECT strftime('%Y-%m-%d', COALESCE(photos.taken_at, photos.imported_at), 'unixepoch', 'localtime') AS day, \
                COUNT(*) AS n \
         FROM photos {where_sql} \
         GROUP BY day ORDER BY day DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params.iter()), |r| {
        let date: String = r.get(0)?;
        let count: i64 = r.get(1)?;
        Ok((date, count))
    })?;
    let mut out = Vec::new();
    for r in rows {
        let (date, count) = r?;
        let (year, month, day) = parse_ymd(&date);
        out.push(TimelineSection {
            date,
            year,
            month,
            day,
            count,
        });
    }
    Ok(out)
}

fn parse_ymd(s: &str) -> (i32, u32, u32) {
    let mut parts = s.split('-');
    let y = parts.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m = parts.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = parts.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    (y, m, d)
}

// ---------------------------------------------------------------------------
// Non-destructive mutations
// ---------------------------------------------------------------------------

/// Set the star rating (clamped 0..5) for a set of photos.
pub fn set_rating(conn: &Connection, ids: &[String], rating: u8) -> Result<()> {
    let r = rating.min(5) as i64;
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute(
            "UPDATE photos SET rating = ?2 WHERE id = ?1",
            params![id, r],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Set the color label for a set of photos.
pub fn set_color(conn: &Connection, ids: &[String], color: ColorLabel) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute(
            "UPDATE photos SET color_label = ?2 WHERE id = ?1",
            params![id, color.as_str()],
        )?;
        search::reindex_color(&tx, id, color)?;
    }
    tx.commit()?;
    Ok(())
}

/// Toggle/set the favorite flag for a set of photos.
pub fn set_favorite(conn: &Connection, ids: &[String], favorite: bool) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute(
            "UPDATE photos SET is_favorite = ?2 WHERE id = ?1",
            params![id, favorite as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Non-destructive catalog removal: mark photos deleted and drop their FTS
/// rows. The physical files are never touched.
pub fn soft_delete(conn: &Connection, ids: &[String], when: i64) -> Result<u64> {
    let tx = conn.unchecked_transaction()?;
    let mut n = 0u64;
    for id in ids {
        n += tx.execute(
            "UPDATE photos SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, when],
        )? as u64;
        search::remove_photo(&tx, id)?;
    }
    tx.commit()?;
    Ok(n)
}

/// Restore soft-deleted photos to the catalog (Undo of [`soft_delete`]) and
/// rebuild their search index rows. Returns the number restored.
pub fn restore(conn: &Connection, ids: &[String]) -> Result<u64> {
    let tx = conn.unchecked_transaction()?;
    let mut n = 0u64;
    for id in ids {
        let affected = tx.execute(
            "UPDATE photos SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![id],
        )?;
        if affected > 0 {
            crate::search::reindex(&tx, id)?;
            n += affected as u64;
        }
    }
    tx.commit()?;
    Ok(n)
}

/// Predicate matching live photos that share their content hash with at least
/// one other live photo (i.e. duplicates).
const DUP_PREDICATE: &str = "deleted_at IS NULL AND hash IS NOT NULL AND hash IN \
    (SELECT hash FROM photos WHERE deleted_at IS NULL AND hash IS NOT NULL \
     GROUP BY hash HAVING COUNT(*) > 1)";

/// Total number of duplicate photos in the catalog.
pub fn duplicates_total(conn: &Connection) -> Result<i64> {
    let sql = format!("SELECT COUNT(*) FROM photos WHERE {DUP_PREDICATE}");
    Ok(conn.query_row(&sql, [], |r| r.get(0))?)
}

/// List a page of duplicate photos, grouped by hash so copies sit together.
pub fn duplicates(conn: &Connection, offset: i64, limit: i64) -> Result<Page<Photo>> {
    let total = duplicates_total(conn)?;
    let sql = format!(
        "SELECT {COLUMNS} FROM photos WHERE {DUP_PREDICATE} \
         ORDER BY hash, taken_at DESC, id LIMIT ?1 OFFSET ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit.clamp(1, 1000), offset.max(0)], |r| map_row(r))?;
    let mut items = Vec::new();
    for r in rows {
        items.push(r?);
    }
    Ok(Page {
        items,
        total,
        offset,
        limit,
    })
}

/// Compute aggregate library statistics.
pub fn stats(conn: &Connection) -> Result<LibraryStats> {
    let mut s = LibraryStats::default();
    s.total = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL",
        [],
        |r| r.get(0),
    )?;
    s.favorites = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL AND is_favorite = 1",
        [],
        |r| r.get(0),
    )?;
    s.raw = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL AND is_raw = 1",
        [],
        |r| r.get(0),
    )?;
    s.videos = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL AND media_type = 'video'",
        [],
        |r| r.get(0),
    )?;
    s.pending_thumbs = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL AND thumb_status = 'pending'",
        [],
        |r| r.get(0),
    )?;
    s.tags = conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))?;
    s.albums = conn.query_row("SELECT COUNT(*) FROM albums", [], |r| r.get(0))?;
    Ok(s)
}
