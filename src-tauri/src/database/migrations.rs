//! Minimal forward-only migration runner.
//!
//! Migrations are embedded at compile time and applied in order. The applied
//! version is tracked with SQLite's `user_version` pragma, so the runner is
//! idempotent and dependency-free.

use rusqlite::Connection;
use tracing::info;

use crate::core::error::Result;

/// Ordered list of `(version, sql)` migrations. Append new tuples; never edit
/// or reorder existing ones.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/0001_initial.sql")),
    (2, include_str!("../../migrations/0002_gps_index.sql")),
    (3, include_str!("../../migrations/0003_album_hierarchy.sql")),
    (4, include_str!("../../migrations/0004_date_override.sql")),
    (5, include_str!("../../migrations/0005_folder_mirror.sql")),
    (6, include_str!("../../migrations/0006_faces.sql")),
    (7, include_str!("../../migrations/0007_geocache.sql")),
];

/// Apply all pending migrations to `conn`.
pub fn run(conn: &Connection) -> Result<()> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (version, sql) in MIGRATIONS {
        if *version > current {
            info!(version, "applying migration");
            conn.execute_batch(sql)?;
            // `user_version` does not accept bound params; format the literal.
            conn.pragma_update(None, "user_version", version)?;
        }
    }
    Ok(())
}
