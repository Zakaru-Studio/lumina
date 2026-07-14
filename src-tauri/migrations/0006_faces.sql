-- Lumina — face recognition (migration 0006)
--
-- On-device face grouping ("People"). Everything here is computed locally by
-- the `ai::face` module (YuNet detector + SFace embedder, both ONNX run through
-- the pure-Rust `tract` engine) — no data ever leaves the machine.
--
-- Design:
--  * `persons`         — a cluster of faces the user can name (a "person").
--  * `faces`           — one detected face instance in a photo, with its
--                        L2-normalized embedding and its cluster assignment.
--  * `face_index_state`— per-photo indexing bookkeeping so the background job is
--                        incremental and resumable (mirrors the thumbnail
--                        pipeline's `thumb_status`).
--
-- The generic `ai_embeddings` / `ai_regions` tables (migration 0001) stay for
-- future CLIP/OCR work; faces get dedicated tables because a face needs its
-- bbox, its embedding and its person link co-located — which the generic
-- region/embedding split cannot express.

-- ---------------------------------------------------------------------------
-- Persons (named or auto clusters)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS persons (
    id            TEXT PRIMARY KEY NOT NULL,
    name          TEXT,                          -- NULL until the user names the cluster
    cover_face_id TEXT,                           -- representative face (faces.id), set by clustering
    is_hidden     INTEGER NOT NULL DEFAULT 0,     -- user hid this cluster (e.g. strangers/false groups)
    face_count    INTEGER NOT NULL DEFAULT 0,     -- denormalized member count (kept in sync on write)
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_persons_name   ON persons(name);
CREATE INDEX IF NOT EXISTS idx_persons_hidden ON persons(is_hidden);

-- ---------------------------------------------------------------------------
-- Faces (one detected instance per row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faces (
    id           TEXT PRIMARY KEY NOT NULL,
    photo_id     TEXT NOT NULL REFERENCES photos(id)  ON DELETE CASCADE,
    person_id    TEXT          REFERENCES persons(id) ON DELETE SET NULL,  -- NULL = unassigned

    -- Bounding box, normalized 0..1 relative to the *display-oriented* image.
    x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
    detect_score REAL,                            -- detector confidence 0..1

    -- Face descriptor: little-endian f32 blob, L2-normalized so cosine == dot.
    embedding    BLOB    NOT NULL,
    dim          INTEGER NOT NULL,
    model        TEXT    NOT NULL,                -- embedding model id (for future re-index)

    -- Review state: a user-confirmed assignment is pinned so re-clustering and
    -- incremental assignment never move it.
    assigned_by  TEXT    NOT NULL DEFAULT 'auto', -- 'auto' | 'user'

    created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_faces_photo  ON faces(photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_person ON faces(person_id);

-- ---------------------------------------------------------------------------
-- Per-photo indexing state (resumable, incremental background job)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS face_index_state (
    photo_id   TEXT PRIMARY KEY NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    status     TEXT    NOT NULL DEFAULT 'pending', -- pending | done | failed
    face_count INTEGER NOT NULL DEFAULT 0,
    model      TEXT,                               -- detector+embedder version that produced this
    error      TEXT,                               -- failure reason when status = 'failed'
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_face_index_status ON face_index_state(status);
