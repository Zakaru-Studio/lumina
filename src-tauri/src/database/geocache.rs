//! Persistent cache for reverse-geocoded place names.
//!
//! Keyed by a coarse coordinate grid (`lat/lon × 1000` → integers, ~110 m cells)
//! plus the language the names were resolved in, so once a spot is looked up
//! online it is served from here forever after — no repeat network calls.

use rusqlite::{params, Connection, OptionalExtension};

use crate::core::error::Result;
use crate::core::models::GeoPlace;

/// Fetch the cached place for a grid cell + language, if one was stored.
pub fn get(conn: &Connection, lat_e3: i64, lon_e3: i64, lang: &str) -> Result<Option<GeoPlace>> {
    let place = conn
        .query_row(
            "SELECT city, region, country FROM geocache \
             WHERE lat_e3 = ?1 AND lon_e3 = ?2 AND lang = ?3",
            params![lat_e3, lon_e3, lang],
            |r| {
                Ok(GeoPlace {
                    city: r.get(0)?,
                    region: r.get(1)?,
                    country: r.get(2)?,
                })
            },
        )
        .optional()?;
    Ok(place)
}

/// Distinct place names (city, region and country) present in the cache, sorted
/// case-insensitively. Powers the library's place filter — it is only as complete
/// as the set of coordinates that have already been reverse-geocoded.
pub fn distinct_places(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM (\
             SELECT city AS name FROM geocache WHERE city IS NOT NULL AND city <> '' \
             UNION SELECT region FROM geocache WHERE region IS NOT NULL AND region <> '' \
             UNION SELECT country FROM geocache WHERE country IS NOT NULL AND country <> '' \
         ) ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Remove any cached place for a grid cell + language. Used when the user clears
/// a custom label, so the coordinate can be resolved online again instead of
/// serving a stale/empty entry.
pub fn delete(conn: &Connection, lat_e3: i64, lon_e3: i64, lang: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM geocache WHERE lat_e3 = ?1 AND lon_e3 = ?2 AND lang = ?3",
        params![lat_e3, lon_e3, lang],
    )?;
    Ok(())
}

/// Store (replacing any prior entry) a resolved place for a grid cell + language.
pub fn put(
    conn: &Connection,
    lat_e3: i64,
    lon_e3: i64,
    lang: &str,
    place: &GeoPlace,
    now: i64,
) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO geocache \
         (lat_e3, lon_e3, lang, city, region, country, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![lat_e3, lon_e3, lang, place.city, place.region, place.country, now],
    )?;
    Ok(())
}
