-- ---------------------------------------------------------------------------
-- Map view: partial, expression index for the geolocated-photo query.
--
-- `with_gps()` selects live photos carrying both coordinates, ordered by
-- COALESCE(taken_at, imported_at) DESC. Without a supporting index SQLite has
-- to scan every live row to find the geotagged subset and then filesort it.
-- A partial index restricted to the same predicate contains only the geotagged
-- live rows, and keying it on the coalesced sort expression lets the query
-- satisfy both the WHERE and the ORDER BY from the index alone.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_photos_gps
    ON photos(COALESCE(taken_at, imported_at) DESC, id DESC)
    WHERE deleted_at IS NULL AND gps_lat IS NOT NULL AND gps_lon IS NOT NULL;
