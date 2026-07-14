-- Persistent cache of reverse-geocoded place names, so any coordinate is looked
-- up online at most once. Keyed by a ~110 m coordinate grid (lat/lon × 1000,
-- rounded to an integer) plus the language the names were fetched in. Rows are
-- written only for successful resolutions; failures/empties are never cached so
-- they can be retried later.
CREATE TABLE IF NOT EXISTS geocache (
    lat_e3     INTEGER NOT NULL,
    lon_e3     INTEGER NOT NULL,
    lang       TEXT    NOT NULL,
    city       TEXT,
    region     TEXT,
    country    TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (lat_e3, lon_e3, lang)
) WITHOUT ROWID;
