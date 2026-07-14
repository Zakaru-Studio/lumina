-- Marks photos whose capture date was manually set by the user. When set, the
-- scanner must preserve `taken_at` across re-indexes instead of overwriting it
-- from the file's (possibly wrong) EXIF / filesystem dates. Enables date editing
-- for formats we can't rewrite in place (RAW, video) via a catalog-level override.
ALTER TABLE photos ADD COLUMN date_overridden INTEGER NOT NULL DEFAULT 0;
