//! API module: thin Tauri command handlers.
//!
//! Commands contain **no business logic** — they validate/marshal input, run
//! the appropriate repository/service call on a blocking worker (so the UI
//! thread is never blocked), and return typed results. All state is injected
//! via `State<'_, SharedState>`.

pub mod albums;
pub mod photos;
pub mod scan;
pub mod settings;
pub mod tags;
pub mod thumbnails;

use crate::core::error::Result;

/// Run blocking (SQLite/image) work off the async executor so commands never
/// stall the UI thread.
pub(crate) async fn blocking<T, F>(f: F) -> Result<T>
where
    F: FnOnce() -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f).await?
}

/// Current Unix timestamp (seconds).
pub(crate) fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
