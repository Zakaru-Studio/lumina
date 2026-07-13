//! Settings repository: typed [`AppConfig`] persistence plus generic KV access.

use rusqlite::{params, Connection};

use crate::core::config::{AppConfig, SETTINGS_KEY};
use crate::core::error::Result;

/// Read a raw JSON value for `key`, if present.
pub fn get_raw(conn: &Connection, key: &str) -> Result<Option<String>> {
    match conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    ) {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Upsert a raw JSON value for `key`.
pub fn set_raw(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Load the typed application config, falling back to defaults when unset or
/// unparseable (tolerant of forward/backward schema drift).
pub fn load_config(conn: &Connection) -> Result<AppConfig> {
    match get_raw(conn, SETTINGS_KEY)? {
        Some(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        None => Ok(AppConfig::default()),
    }
}

/// Persist the typed application config.
pub fn save_config(conn: &Connection, config: &AppConfig) -> Result<()> {
    let raw = serde_json::to_string(config)?;
    set_raw(conn, SETTINGS_KEY, &raw)
}
