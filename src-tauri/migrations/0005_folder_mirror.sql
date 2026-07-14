-- ---------------------------------------------------------------------------
-- Folder mirror mode: let an import root be a bidirectional "mirror" of the
-- on-disk folder tree.
--
--  * `watched_folders.mirror = 1` marks a root whose albums ARE its folders:
--    renaming/moving/deleting an album propagates to disk, and Explorer changes
--    (including offline) reconcile back into the catalog by content hash.
--  * `albums.folder_path` is the on-disk directory a (manual) album represents.
--    NULL means a purely virtual album (the historical behaviour) — created by
--    hand or imported without mirror mode; smart albums keep it NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE watched_folders ADD COLUMN mirror INTEGER NOT NULL DEFAULT 0;
ALTER TABLE albums ADD COLUMN folder_path TEXT;

CREATE INDEX IF NOT EXISTS idx_albums_folder_path ON albums(folder_path);
