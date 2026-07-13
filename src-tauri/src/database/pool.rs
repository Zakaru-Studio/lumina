//! SQLite connection pool with WAL and sane pragmas applied per connection.

use std::path::Path;
use std::time::Duration;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;

use crate::core::error::Result;

/// A pooled, thread-safe SQLite connection.
pub type Conn = r2d2::PooledConnection<SqliteConnectionManager>;

/// Apply performance/safety pragmas to a freshly opened connection.
///
/// * WAL journaling for concurrent readers during writes.
/// * `NORMAL` synchronous — durable enough with WAL, far faster than FULL.
/// * Foreign keys ON (join-table cascades).
/// * A generous busy timeout so the background scanner and UI never collide.
fn tune(conn: &Connection) -> rusqlite::Result<()> {
    // `journal_mode` returns the resulting mode as a row, so use a query.
    conn.query_row("PRAGMA journal_mode=WAL", [], |_row| Ok(()))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.pragma_update(None, "cache_size", -16_000)?; // ~16 MB page cache
    conn.busy_timeout(Duration::from_secs(10))?;
    Ok(())
}

/// Build a connection pool for the database at `path`, creating the file and
/// parent directory if needed.
pub fn build(path: &Path, max_size: u32) -> Result<Pool<SqliteConnectionManager>> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let manager = SqliteConnectionManager::file(path).with_init(|c| tune(c));
    let pool = Pool::builder()
        .max_size(max_size.max(2))
        .build(manager)
        .map_err(crate::core::error::Error::Pool)?;
    Ok(pool)
}
