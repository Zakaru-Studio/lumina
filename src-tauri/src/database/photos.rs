//! Photo repository: inserts from the scanner, catalog queries, listing with
//! filtering/sorting/pagination, timeline aggregation and non-destructive
//! mutations (rating, color, favorite, soft delete, thumbnail status).

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, Row};

use crate::core::error::{Error, Result};
use crate::core::models::{
    LibraryStats, MapPoint, MediaType, Photo, ThumbStatus, TimelineSection,
};
use crate::core::query::{Page, PhotoFilter, PhotoQuery, SortBy, SortDir};
use crate::search;

/// Column projection shared by every `SELECT` so [`map_row`] stays valid.
const COLUMNS: &str = "id, path, filename, folder, format, media_type, \
    taken_at, file_created, file_modified, imported_at, \
    width, height, orientation, file_size, \
    camera_make, camera_model, lens, iso, focal_length, aperture, shutter_speed, \
    gps_lat, gps_lon, hash, rating, is_favorite, is_raw, \
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
        is_favorite: row.get::<_, i64>(25)? != 0,
        is_raw: row.get::<_, i64>(26)? != 0,
        thumb_status: ThumbStatus::from_str_lenient(&row.get::<_, String>(27)?),
        thumb_path: row.get(28)?,
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
            gps_lat, gps_lon, hash, rating, is_favorite, is_raw, \
            thumb_status, thumb_path, deleted_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,NULL) \
         ON CONFLICT(path) DO UPDATE SET \
            filename=excluded.filename, folder=excluded.folder, format=excluded.format, \
            media_type=excluded.media_type, \
            taken_at=CASE WHEN photos.date_overridden = 1 THEN photos.taken_at ELSE excluded.taken_at END, \
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
            p.gps_lat, p.gps_lon, p.hash, p.rating as i64,
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

/// Set a user-chosen capture date (`taken_at`, Unix seconds) for a photo and
/// mark it as overridden so a later rescan preserves it instead of re-reading
/// the file's (wrong) EXIF/filesystem date. Also refreshes the file size/mtime
/// markers (an EXIF rewrite changes them). Rebuilds the FTS row.
pub fn set_taken_at(
    conn: &Connection,
    id: &str,
    taken_at: i64,
    file_size: i64,
    file_modified: Option<i64>,
) -> Result<()> {
    conn.execute(
        "UPDATE photos SET taken_at = ?2, file_size = ?3, file_modified = ?4, \
         date_overridden = 1 WHERE id = ?1",
        params![id, taken_at, file_size, file_modified],
    )?;
    search::reindex(conn, id)?;
    Ok(())
}

/// Rename a photo for display only (the `filename` column), leaving the file on
/// disk and its `path`/`folder` untouched. Used for virtual (non-mirror) photos
/// where a rename is a catalog-only relabel. Refreshes the FTS row so the new
/// name is searchable.
pub fn set_filename(conn: &Connection, id: &str, filename: &str) -> Result<()> {
    let n = conn.execute(
        "UPDATE photos SET filename = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, filename],
    )?;
    if n == 0 {
        return Err(Error::NotFound(format!("photo {id}")));
    }
    search::reindex(conn, id)?;
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
        (SortBy::Timeline, "ASC") => {
            "ORDER BY COALESCE(photos.taken_at, photos.imported_at) ASC, photos.id ASC"
        }
        (SortBy::Timeline, _) => {
            "ORDER BY COALESCE(photos.taken_at, photos.imported_at) DESC, photos.id DESC"
        }
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

/// List every live, geolocated photo as a lightweight [`MapPoint`] (newest
/// first). Rows without both coordinates are excluded so the map only ever
/// receives plottable points. Returns the full set — geotagged photos are a
/// small subset of a library and the map clusters them client-side.
pub fn with_gps(conn: &Connection) -> Result<Vec<MapPoint>> {
    let mut stmt = conn.prepare(
        "SELECT id, gps_lat, gps_lon, filename, taken_at, thumb_path \
         FROM photos \
         WHERE deleted_at IS NULL AND gps_lat IS NOT NULL AND gps_lon IS NOT NULL \
         ORDER BY COALESCE(taken_at, imported_at) DESC, id DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(MapPoint {
            id: r.get(0)?,
            gps_lat: r.get(1)?,
            gps_lon: r.get(2)?,
            filename: r.get(3)?,
            taken_at: r.get(4)?,
            thumb_path: r.get(5)?,
        })
    })?;
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

/// Permanently delete photo rows and drop their FTS rows. Tag/album/AI links are
/// removed automatically by `ON DELETE CASCADE` (foreign keys are enabled per
/// connection). Used when the underlying files are deleted from disk — there is
/// no undo. Returns the number of rows removed.
pub fn hard_delete(conn: &Connection, ids: &[String]) -> Result<u64> {
    let tx = conn.unchecked_transaction()?;
    let mut n = 0u64;
    for id in ids {
        search::remove_photo(&tx, id)?;
        n += tx.execute("DELETE FROM photos WHERE id = ?1", params![id])? as u64;
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

/// All live photos located at (an exact file) or under (a folder) `prefix`.
///
/// Uses a byte-range on the unique `path` index (`prefix+SEP` .. `prefix+SEP⁺`)
/// rather than `LIKE`, so `_`/`%`/`\` in folder names can never cause false
/// matches. Backbone of mirror relocation and reconciliation.
pub fn by_path_prefix(conn: &Connection, prefix: &str) -> Result<Vec<Photo>> {
    let sep = std::path::MAIN_SEPARATOR;
    let low = format!("{prefix}{sep}");
    // Exclusive upper bound: same prefix with the separator byte incremented.
    let high = format!("{prefix}{}", ((sep as u8) + 1) as char);
    let sql = format!(
        "SELECT {COLUMNS} FROM photos \
         WHERE deleted_at IS NULL AND (path = ?1 OR (path >= ?2 AND path < ?3)) \
         ORDER BY path"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![prefix, low, high], |r| map_row(r))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Relocate every live photo at/under `old_prefix` to `new_prefix`, rewriting
/// `path`/`folder`/`filename` **in place** so identity (id, rating, favorite,
/// tags, album membership) is preserved, and refreshing the FTS index. Works for
/// a whole folder (dir prefix) or a single file (exact path). Returns the count.
pub fn relocate_prefix(conn: &Connection, old_prefix: &str, new_prefix: &str) -> Result<usize> {
    let affected = by_path_prefix(conn, old_prefix)?;
    let tx = conn.unchecked_transaction()?;
    let mut n = 0usize;
    for p in &affected {
        // `old_prefix` is a byte-prefix of `p.path` (guaranteed by the range
        // query), so slicing at its length is on a valid boundary.
        let rest = &p.path[old_prefix.len()..];
        let new_path = format!("{new_prefix}{rest}");
        let np = std::path::Path::new(&new_path);
        let new_folder = np
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let new_filename = np
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        tx.execute(
            "UPDATE photos SET path = ?2, folder = ?3, filename = ?4 WHERE id = ?1",
            params![p.id, new_path, new_folder, new_filename],
        )?;
        search::reindex(&tx, &p.id)?;
        n += 1;
    }
    tx.commit()?;
    Ok(n)
}

/// Soft-delete every live photo at/under `folder_prefix` (catalog-only). Returns
/// the number affected. Used when a mirror folder is trashed on disk.
pub fn soft_delete_under(conn: &Connection, folder_prefix: &str, when: i64) -> Result<u64> {
    let ids: Vec<String> = by_path_prefix(conn, folder_prefix)?
        .into_iter()
        .map(|p| p.id)
        .collect();
    soft_delete(conn, &ids, when)
}

/// Live photos whose content hash matches `hash`. Backs mirror move-detection
/// (a file that vanished from one path but re-appears, byte-identical, at
/// another is a move, not a delete). Uses `idx_photos_hash`.
pub fn get_by_hash(conn: &Connection, hash: &str) -> Result<Vec<Photo>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM photos WHERE hash = ?1 AND deleted_at IS NULL ORDER BY path"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![hash], |r| map_row(r))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
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

/// Penalty for duplicate-copy markers in a filename — a parenthesised number
/// (`photo (1).jpg`) or a "copy"/"copie" word. Lower is a cleaner name.
fn copy_marker_penalty(filename: &str) -> i64 {
    let lower = filename.to_lowercase();
    let mut penalty = 0;
    if lower.contains("copy") || lower.contains("copie") {
        penalty += 1;
    }
    // A parenthesised run of digits, e.g. "(1)".
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'(' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            if j > i + 1 && j < bytes.len() && bytes[j] == b')' {
                penalty += 1;
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    penalty
}

/// Ordering key for picking the copy to KEEP within a duplicate group. The
/// smallest key wins, encoding the agreed priority: richest metadata first,
/// then the cleanest filename, then the shallowest folder, then the oldest
/// import, then the shortest path, with the id as a stable final tie-break.
fn keeper_key(photo: &Photo, tag_count: i64) -> (i64, i64, usize, i64, usize, String) {
    let metadata = photo.rating as i64 + if photo.is_favorite { 5 } else { 0 } + tag_count;
    let depth = photo.folder.matches(|c| c == '/' || c == '\\').count();
    (
        -metadata,
        copy_marker_penalty(&photo.filename),
        depth,
        photo.imported_at,
        photo.path.chars().count(),
        photo.id.clone(),
    )
}

/// Build a "smart dedupe" proposal: group live duplicates by content hash and,
/// for each group, choose one copy to keep (see [`keeper_key`]) and mark the
/// rest for removal. Purely advisory — nothing is deleted here.
///
/// With `ids = None` the whole catalog is considered. With `ids = Some(..)` only
/// those photos are — a "test on a selection" scope: copies are only proposed
/// for removal when at least two of the *selected* photos share a hash.
pub fn dedupe_plan(
    conn: &Connection,
    ids: Option<&[String]>,
) -> Result<crate::core::models::DedupePlan> {
    use crate::core::models::{DedupeGroup, DedupePlan};
    use std::collections::BTreeMap;

    // Scope: whole-catalog duplicates, or just the given selection.
    let (where_sql, id_params): (String, Vec<&String>) = match ids {
        Some(ids) => {
            if ids.is_empty() {
                return Ok(DedupePlan { groups: vec![], total_remove: 0 });
            }
            let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            (
                format!("deleted_at IS NULL AND hash IS NOT NULL AND id IN ({placeholders})"),
                ids.iter().collect(),
            )
        }
        None => (DUP_PREDICATE.to_string(), Vec::new()),
    };

    let sql = format!(
        "SELECT {COLUMNS}, \
         (SELECT COUNT(*) FROM photo_tags pt WHERE pt.photo_id = photos.id) AS tag_count \
         FROM photos WHERE {where_sql} ORDER BY hash, id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(id_params), |r| {
        let photo = map_row(r)?;
        let tag_count: i64 = r.get(29)?;
        Ok((photo, tag_count))
    })?;

    // Group by content hash, preserving each photo's tag count for scoring.
    let mut by_hash: BTreeMap<String, Vec<(Photo, i64)>> = BTreeMap::new();
    for row in rows {
        let (photo, tag_count) = row?;
        let hash = photo.hash.clone().unwrap_or_default();
        by_hash.entry(hash).or_default().push((photo, tag_count));
    }

    let mut groups = Vec::new();
    let mut total_remove = 0;
    for (_hash, mut items) in by_hash {
        if items.len() < 2 {
            continue; // Not actually duplicated (defensive).
        }
        items.sort_by(|(pa, ta), (pb, tb)| keeper_key(pa, *ta).cmp(&keeper_key(pb, *tb)));
        let keep = items.remove(0).0;
        let remove: Vec<Photo> = items.into_iter().map(|(p, _)| p).collect();
        total_remove += remove.len() as i64;
        groups.push(DedupeGroup { keep, remove });
    }

    Ok(DedupePlan {
        groups,
        total_remove,
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
