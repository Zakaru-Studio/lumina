//! Database module: connection pooling, migrations and per-entity repositories.
//!
//! The [`Database`] handle is a cheap-to-clone wrapper around an r2d2 pool.
//! Repository logic lives in focused submodules ([`photos`], [`tags`],
//! [`albums`], [`settings`], [`folders`]) as free functions taking a
//! `&Connection`, keeping each concern independently testable.

pub mod albums;
pub mod folders;
pub mod geocache;
pub mod migrations;
pub mod photos;
pub mod pool;
pub mod settings;
pub mod tags;

use std::path::Path;
use std::sync::Arc;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

use crate::core::error::Result;

pub use pool::Conn;

/// Thread-safe database handle shared across the whole backend.
#[derive(Clone)]
pub struct Database {
    pool: Arc<Pool<SqliteConnectionManager>>,
}

impl Database {
    /// Open (creating if needed) the database at `path`, run migrations and
    /// seed built-in smart albums.
    pub fn open(path: &Path, max_connections: u32, now: i64) -> Result<Self> {
        let pool = pool::build(path, max_connections)?;
        let db = Self {
            pool: Arc::new(pool),
        };
        {
            let conn = db.get()?;
            migrations::run(&conn)?;
            albums::seed_smart_albums(&conn, now)?;
        }
        Ok(db)
    }

    /// Borrow a pooled connection.
    pub fn get(&self) -> Result<Conn> {
        Ok(self.pool.get()?)
    }
}
