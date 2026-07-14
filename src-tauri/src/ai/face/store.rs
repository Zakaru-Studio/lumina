//! Persistence for the face feature: the `persons`, `faces` and
//! `face_index_state` tables (migration 0006), plus the read queries the
//! People UI is built on.

use rusqlite::{params, Connection, OptionalExtension};

use super::{FaceBox, FaceStats, FaceThumb, PersonSummary};
use crate::core::error::Result;

/// Encode an f32 vector as little-endian bytes for BLOB storage.
fn encode_vector(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

/// Decode a little-endian f32 BLOB back into a vector.
pub fn decode_vector(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

// ---------------------------------------------------------------------------
// Indexing bookkeeping
// ---------------------------------------------------------------------------

/// Live photos still needing face indexing (never indexed, or marked pending),
/// newest first so recent imports get people fastest.
pub fn pending_photo_ids(conn: &Connection, limit: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT p.id FROM photos p \
         LEFT JOIN face_index_state s ON s.photo_id = p.id \
         WHERE p.deleted_at IS NULL AND p.media_type = 'photo' \
           AND (s.status IS NULL OR s.status = 'pending') \
         ORDER BY p.taken_at DESC, p.imported_at DESC \
         LIMIT ?1",
    )?;
    let ids = stmt
        .query_map(params![limit], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

/// Whether any indexed photo was processed by a different model/pipeline version
/// — i.e. the stored faces/persons are stale and should be rebuilt from scratch.
pub fn model_changed(conn: &Connection, current: &str) -> Result<bool> {
    let stale: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM face_index_state WHERE model IS NOT NULL AND model != ?1)",
        params![current],
        |r| r.get(0),
    )?;
    Ok(stale)
}

/// Count of photos still awaiting face indexing.
pub fn count_pending(conn: &Connection) -> Result<i64> {
    let n = conn.query_row(
        "SELECT COUNT(*) FROM photos p \
         LEFT JOIN face_index_state s ON s.photo_id = p.id \
         WHERE p.deleted_at IS NULL AND p.media_type = 'photo' \
           AND (s.status IS NULL OR s.status = 'pending')",
        [],
        |r| r.get(0),
    )?;
    Ok(n)
}

/// Mark a photo as successfully indexed with `face_count` faces.
pub fn mark_indexed(
    conn: &Connection,
    photo_id: &str,
    face_count: i64,
    model: &str,
    now: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO face_index_state (photo_id, status, face_count, model, error, updated_at) \
         VALUES (?1, 'done', ?2, ?3, NULL, ?4) \
         ON CONFLICT(photo_id) DO UPDATE SET \
           status='done', face_count=excluded.face_count, model=excluded.model, \
           error=NULL, updated_at=excluded.updated_at",
        params![photo_id, face_count, model, now],
    )?;
    Ok(())
}

/// Mark a photo's indexing as failed (kept out of the pending queue but visible
/// for diagnostics).
pub fn mark_failed(conn: &Connection, photo_id: &str, error: &str, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO face_index_state (photo_id, status, face_count, error, updated_at) \
         VALUES (?1, 'failed', 0, ?2, ?3) \
         ON CONFLICT(photo_id) DO UPDATE SET \
           status='failed', error=excluded.error, updated_at=excluded.updated_at",
        params![photo_id, error, now],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Faces & persons (writes)
// ---------------------------------------------------------------------------

/// Insert an unassigned face and return its new id.
#[allow(clippy::too_many_arguments)]
pub fn insert_face(
    conn: &Connection,
    photo_id: &str,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    score: f32,
    embedding: &[f32],
    model: &str,
    now: i64,
) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO faces \
           (id, photo_id, person_id, x, y, w, h, detect_score, embedding, dim, model, assigned_by, created_at) \
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'auto', ?11)",
        params![
            id,
            photo_id,
            x,
            y,
            w,
            h,
            score,
            encode_vector(embedding),
            embedding.len() as i64,
            model,
            now
        ],
    )?;
    Ok(id)
}

/// Create a new (unnamed) person cluster and return its id.
pub fn create_person(conn: &Connection, cover_face_id: &str, now: i64) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO persons (id, name, cover_face_id, is_hidden, face_count, created_at, updated_at) \
         VALUES (?1, NULL, ?2, 0, 0, ?3, ?3)",
        params![id, cover_face_id, now],
    )?;
    Ok(id)
}

/// Assign a face to a person, recording whether the decision was automatic or
/// user-confirmed.
pub fn assign_face(
    conn: &Connection,
    face_id: &str,
    person_id: &str,
    assigned_by: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE faces SET person_id = ?2, assigned_by = ?3 WHERE id = ?1",
        params![face_id, person_id, assigned_by],
    )?;
    Ok(())
}

/// Ensure a person's cover points at one of *their own* faces. Repairs a cover
/// left dangling after its face was reassigned to someone else, and gives a
/// user-created or merged cluster its first cover. Picks the highest-confidence
/// face (newest as tiebreak); clears the cover to NULL when the person has no
/// faces left. No-op when the current cover is already valid.
fn ensure_person_cover(conn: &Connection, person_id: &str, now: i64) -> Result<()> {
    let valid: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM persons pr JOIN faces f ON f.id = pr.cover_face_id \
         WHERE pr.id = ?1 AND f.person_id = ?1)",
        params![person_id],
        |r| r.get(0),
    )?;
    if valid {
        return Ok(());
    }
    let face_id: Option<String> = conn
        .query_row(
            "SELECT id FROM faces WHERE person_id = ?1 \
             ORDER BY COALESCE(detect_score, 0) DESC, created_at DESC LIMIT 1",
            params![person_id],
            |r| r.get(0),
        )
        .optional()?;
    conn.execute(
        "UPDATE persons SET cover_face_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![person_id, face_id, now],
    )?;
    Ok(())
}

/// Point a person's cover at a specific face.
pub fn set_person_cover(conn: &Connection, person_id: &str, face_id: &str, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE persons SET cover_face_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![person_id, face_id, now],
    )?;
    Ok(())
}

/// All (person_id, embedding) pairs for currently-assigned faces — used to seed
/// cluster centroids when the indexer resumes.
pub fn assigned_embeddings(conn: &Connection) -> Result<Vec<(String, Vec<f32>)>> {
    let mut stmt = conn.prepare(
        "SELECT person_id, embedding FROM faces WHERE person_id IS NOT NULL",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let pid: String = r.get(0)?;
            let blob: Vec<u8> = r.get(1)?;
            Ok((pid, blob))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows
        .into_iter()
        .map(|(pid, blob)| (pid, decode_vector(&blob)))
        .collect())
}

// ---------------------------------------------------------------------------
// People UI queries
// ---------------------------------------------------------------------------

/// List people (clusters) ordered by size. `min_faces` filters out singletons
/// (noise); `include_hidden` includes user-hidden clusters; `named_only`
/// restricts to clusters the user has named.
pub fn list_people(
    conn: &Connection,
    include_hidden: bool,
    named_only: bool,
    min_faces: i64,
) -> Result<Vec<PersonSummary>> {
    let sql = format!(
        "SELECT pr.id, pr.name, pr.face_count, pr.is_hidden, \
                f.id, f.photo_id, ph.thumb_path, f.x, f.y, f.w, f.h, \
                ph.width, ph.height, ph.orientation \
         FROM persons pr \
         LEFT JOIN faces f  ON f.id = pr.cover_face_id \
         LEFT JOIN photos ph ON ph.id = f.photo_id \
         WHERE pr.face_count >= ?1 \
           {hidden} {named} \
         ORDER BY pr.name IS NULL, pr.face_count DESC, pr.name COLLATE NOCASE",
        hidden = if include_hidden { "" } else { "AND pr.is_hidden = 0" },
        named = if named_only { "AND pr.name IS NOT NULL" } else { "" },
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![min_faces], map_person_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Display-oriented pixel dimensions: EXIF orientations 5–8 swap width/height.
fn oriented_dims(w: i64, h: i64, orientation: i64) -> (u32, u32) {
    let (w, h) = (w.max(0) as u32, h.max(0) as u32);
    if matches!(orientation, 5 | 6 | 7 | 8) {
        (h, w)
    } else {
        (w, h)
    }
}

fn map_person_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<PersonSummary> {
    let cover_face_id: Option<String> = r.get(4)?;
    let cover = match cover_face_id {
        Some(face_id) => {
            let (photo_w, photo_h) = oriented_dims(
                r.get::<_, Option<i64>>(11)?.unwrap_or(0),
                r.get::<_, Option<i64>>(12)?.unwrap_or(0),
                r.get::<_, Option<i64>>(13)?.unwrap_or(1),
            );
            Some(FaceThumb {
                face_id,
                photo_id: r.get(5)?,
                thumb_path: r.get(6)?,
                x: r.get(7)?,
                y: r.get(8)?,
                w: r.get(9)?,
                h: r.get(10)?,
                photo_w,
                photo_h,
            })
        }
        None => None,
    };
    Ok(PersonSummary {
        id: r.get(0)?,
        name: r.get(1)?,
        face_count: r.get(2)?,
        is_hidden: r.get::<_, i64>(3)? != 0,
        cover,
    })
}

/// Fetch a single person summary by id.
pub fn get_person(conn: &Connection, id: &str) -> Result<Option<PersonSummary>> {
    let mut stmt = conn.prepare(
        "SELECT pr.id, pr.name, pr.face_count, pr.is_hidden, \
                f.id, f.photo_id, ph.thumb_path, f.x, f.y, f.w, f.h, \
                ph.width, ph.height, ph.orientation \
         FROM persons pr \
         LEFT JOIN faces f  ON f.id = pr.cover_face_id \
         LEFT JOIN photos ph ON ph.id = f.photo_id \
         WHERE pr.id = ?1",
    )?;
    let row = stmt
        .query_row(params![id], map_person_summary)
        .optional()?;
    Ok(row)
}

/// Ordered, de-duplicated photo ids that contain a given person — feeds the
/// windowed photo grid on the person detail page.
pub fn person_photo_ids(conn: &Connection, person_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT p.id FROM photos p \
         WHERE p.deleted_at IS NULL AND p.id IN \
           (SELECT DISTINCT photo_id FROM faces WHERE person_id = ?1) \
         ORDER BY p.taken_at DESC, p.imported_at DESC",
    )?;
    let ids = stmt
        .query_map(params![person_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

/// All face boxes detected in a photo, with the owning person's name (for
/// overlays / "who is this" affordances).
pub fn faces_in_photo(conn: &Connection, photo_id: &str) -> Result<Vec<FaceBox>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.person_id, pr.name, f.x, f.y, f.w, f.h, f.detect_score \
         FROM faces f LEFT JOIN persons pr ON pr.id = f.person_id \
         WHERE f.photo_id = ?1 ORDER BY f.detect_score DESC",
    )?;
    let rows = stmt
        .query_map(params![photo_id], |r| {
            Ok(FaceBox {
                id: r.get(0)?,
                person_id: r.get(1)?,
                person_name: r.get(2)?,
                x: r.get(3)?,
                y: r.get(4)?,
                w: r.get(5)?,
                h: r.get(6)?,
                score: r.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// People UI mutations
// ---------------------------------------------------------------------------

/// Rename a person (empty/blank name clears it back to an unnamed cluster).
pub fn rename_person(conn: &Connection, id: &str, name: Option<&str>, now: i64) -> Result<()> {
    let clean = name.map(str::trim).filter(|s| !s.is_empty());
    conn.execute(
        "UPDATE persons SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, clean, now],
    )?;
    Ok(())
}

/// Hide or unhide a person cluster.
pub fn set_person_hidden(conn: &Connection, id: &str, hidden: bool, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE persons SET is_hidden = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, hidden as i64, now],
    )?;
    Ok(())
}

/// Delete a person and all of its face detections. The photos themselves are
/// untouched; the faces won't reappear until a full re-analysis.
pub fn delete_person(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM faces WHERE person_id = ?1", params![id])?;
    tx.execute("DELETE FROM persons WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(())
}

/// Merge several source clusters into a target: all their faces become
/// user-confirmed members of the target, then the emptied sources are removed.
pub fn merge_people(conn: &Connection, sources: &[String], into: &str, now: i64) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for src in sources {
        if src == into {
            continue;
        }
        tx.execute(
            "UPDATE faces SET person_id = ?2, assigned_by = 'user' WHERE person_id = ?1",
            params![src, into],
        )?;
        tx.execute("DELETE FROM persons WHERE id = ?1", params![src])?;
    }
    // Recount the survivor.
    let count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM faces WHERE person_id = ?1",
        params![into],
        |r| r.get(0),
    )?;
    tx.execute(
        "UPDATE persons SET face_count = ?2, updated_at = ?3 WHERE id = ?1",
        params![into, count, now],
    )?;
    // The survivor may have absorbed faces without a cover of its own.
    ensure_person_cover(&tx, into, now)?;
    tx.commit()?;
    Ok(())
}

/// Reassign specific faces to a person (user correction). Passing `None` for the
/// target detaches them (they become unassigned). Recomputes affected counts.
pub fn assign_faces(
    conn: &Connection,
    face_ids: &[String],
    target: Option<&str>,
    now: i64,
) -> Result<()> {
    if face_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    // Collect the persons touched so we can recount them afterwards.
    let mut touched: std::collections::HashSet<String> = std::collections::HashSet::new();
    for fid in face_ids {
        if let Some(prev) = tx
            .query_row(
                "SELECT person_id FROM faces WHERE id = ?1",
                params![fid],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten()
        {
            touched.insert(prev);
        }
        tx.execute(
            "UPDATE faces SET person_id = ?2, assigned_by = 'user' WHERE id = ?1",
            params![fid, target],
        )?;
    }
    if let Some(t) = target {
        touched.insert(t.to_string());
    }
    for pid in touched {
        let count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM faces WHERE person_id = ?1",
            params![pid],
            |r| r.get(0),
        )?;
        tx.execute(
            "UPDATE persons SET face_count = ?2, updated_at = ?3 WHERE id = ?1",
            params![pid, count, now],
        )?;
        // A reassignment may have moved this person's cover face away (or given a
        // user-created cluster its first faces) — repair the cover.
        ensure_person_cover(&tx, &pid, now)?;
    }
    tx.commit()?;
    Ok(())
}

/// Create an empty, optionally-named person the user can move faces into.
pub fn new_named_person(conn: &Connection, name: Option<&str>, now: i64) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let clean = name.map(str::trim).filter(|s| !s.is_empty());
    conn.execute(
        "INSERT INTO persons (id, name, cover_face_id, is_hidden, face_count, created_at, updated_at) \
         VALUES (?1, ?2, NULL, 0, 0, ?3, ?3)",
        params![id, clean, now],
    )?;
    Ok(id)
}

/// Wipe all face data (faces, persons, indexing state). Used when the user
/// disables face recognition or asks to erase the biometric data.
pub fn clear_all(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM faces", [])?;
    tx.execute("DELETE FROM persons", [])?;
    tx.execute("DELETE FROM face_index_state", [])?;
    tx.commit()?;
    Ok(())
}

/// Remove empty clusters left after corrections/merges.
pub fn prune_empty_persons(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM persons WHERE face_count <= 0", [])?;
    Ok(())
}

/// Aggregate counts for the settings panel / status.
pub fn stats(conn: &Connection) -> Result<FaceStats> {
    let people: i64 = conn.query_row("SELECT COUNT(*) FROM persons", [], |r| r.get(0))?;
    let named_people: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persons WHERE name IS NOT NULL",
        [],
        |r| r.get(0),
    )?;
    let faces: i64 = conn.query_row("SELECT COUNT(*) FROM faces", [], |r| r.get(0))?;
    let indexed_photos: i64 = conn.query_row(
        "SELECT COUNT(*) FROM face_index_state WHERE status = 'done'",
        [],
        |r| r.get(0),
    )?;
    let pending_photos = count_pending(conn)?;
    Ok(FaceStats {
        people,
        named_people,
        faces,
        indexed_photos,
        pending_photos,
    })
}
