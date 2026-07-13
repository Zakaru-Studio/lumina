//! In-memory LRU cache of encoded thumbnail bytes.
//!
//! The primary delivery path for thumbnails is the Tauri asset protocol
//! (zero-copy from disk), but this bounded cache backs the IPC fallback command
//! and avoids repeated disk reads for hot thumbnails during fast scrolling.

use std::num::NonZeroUsize;
use std::sync::Arc;

use lru::LruCache;
use parking_lot::Mutex;

/// Thread-safe, bounded LRU of `id -> encoded WebP bytes`.
pub struct ThumbCache {
    inner: Mutex<LruCache<String, Arc<Vec<u8>>>>,
}

impl ThumbCache {
    /// Create a cache holding up to `capacity` thumbnails (min 1).
    pub fn new(capacity: usize) -> Self {
        let cap = NonZeroUsize::new(capacity.max(1)).expect("capacity >= 1");
        Self {
            inner: Mutex::new(LruCache::new(cap)),
        }
    }

    /// Fetch cached bytes, promoting the entry to most-recently-used.
    pub fn get(&self, id: &str) -> Option<Arc<Vec<u8>>> {
        self.inner.lock().get(id).cloned()
    }

    /// Insert or replace bytes for `id`.
    pub fn put(&self, id: String, bytes: Arc<Vec<u8>>) {
        self.inner.lock().put(id, bytes);
    }

    /// Drop a cached entry (e.g. on catalog removal).
    pub fn invalidate(&self, id: &str) {
        self.inner.lock().pop(id);
    }
}
