-- ---------------------------------------------------------------------------
-- Album hierarchy: let manual albums nest under a parent album.
--
-- `parent_id` is a self-reference into `albums`. NULL means a root album.
-- Only manual albums participate in the hierarchy; smart albums always keep
-- parent_id NULL (enforced in the repository layer). Deleting a parent promotes
-- its children to the root (ON DELETE SET NULL) rather than cascading, so a
-- sub-tree is never lost by removing an intermediate album.
-- ---------------------------------------------------------------------------
ALTER TABLE albums ADD COLUMN parent_id TEXT
    REFERENCES albums(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_albums_parent ON albums(parent_id);
