//! Lumina backend library.
//!
//! Wires together the modules, bootstraps application state (database,
//! configuration, thumbnail service, scan manager) and registers the Tauri
//! command surface. `main.rs` is a thin wrapper around [`run`].

pub mod ai;
pub mod api;
pub mod core;
pub mod database;
pub mod events;
pub mod metadata;
pub mod scanner;
pub mod search;
pub mod thumbnail;

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::RwLock;
use tauri::Manager;
use tracing::{info, warn};

use crate::core::config::Paths;
use crate::core::error::{Error, Result};
use crate::core::state::AppState;
use crate::database::{folders, settings, Database};
use crate::scanner::ScanManager;
use crate::thumbnail::ThumbnailService;

/// Max pooled SQLite connections. One writer + readers for the UI and scanner.
const DB_POOL_SIZE: u32 = 8;
/// In-memory thumbnail LRU capacity (encoded WebP entries).
const THUMB_LRU: usize = 1024;

/// Initialize tracing once, honoring `RUST_LOG` (defaults to info).
fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,lumina_lib=debug"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

/// Build application state from the resolved data directory.
fn bootstrap(app: &tauri::App) -> Result<Arc<AppState>> {
    let handle = app.handle().clone();
    let data_dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| Error::Other(format!("cannot resolve app data dir: {e}")))?;
    std::fs::create_dir_all(&data_dir)?;

    let now = chrono::Utc::now().timestamp();
    let db_path = data_dir.join("lumina.db");
    let db = Database::open(&db_path, DB_POOL_SIZE, now)?;

    // Load config, resolve paths, ensure the thumbnail cache directory exists.
    let config = {
        let conn = db.get()?;
        settings::load_config(&conn)?
    };
    let paths = Paths::resolve(data_dir, config.cache_dir.as_deref());
    std::fs::create_dir_all(&paths.thumbnails)?;
    info!(db = %db_path.display(), thumbs = %paths.thumbnails.display(), "storage ready");

    // Shared, mutable config/paths so `update_config` reaches the scanner too.
    let config_lock = Arc::new(RwLock::new(config));
    let paths_lock = Arc::new(RwLock::new(paths));
    let thumbnails = Arc::new(ThumbnailService::new(THUMB_LRU));

    let scanner = Arc::new(ScanManager::new(
        db.clone(),
        Arc::clone(&thumbnails),
        Arc::clone(&config_lock),
        Arc::clone(&paths_lock),
        handle.clone(),
    ));

    let state = AppState::new(
        handle,
        db,
        config_lock,
        paths_lock,
        Arc::clone(&scanner),
        thumbnails,
    );
    Ok(Arc::new(state))
}

/// On startup, resume watching existing folders and pick up any new files.
fn resume_background_work(state: &Arc<AppState>) {
    let roots: Vec<PathBuf> = match state.db.get() {
        Ok(conn) => folders::list(&conn)
            .map(|list| {
                list.into_iter()
                    .filter(|f| f.active)
                    .map(|f| PathBuf::from(f.path))
                    .collect()
            })
            .unwrap_or_default(),
        Err(e) => {
            warn!(error = %e, "cannot list watched folders at startup");
            Vec::new()
        }
    };
    if roots.is_empty() {
        return;
    }
    state.scanner.start_watching(roots.clone());
    state.scanner.spawn_scan(roots);
}

/// Entry point: build and run the Tauri application.
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let state = bootstrap(app)?;
            app.manage(Arc::clone(&state));
            resume_background_work(&state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // photos
            api::photos::list_photos,
            api::photos::get_photo,
            api::photos::count_photos,
            api::photos::photo_timeline,
            api::photos::photos_with_gps,
            api::photos::library_stats,
            api::photos::set_rating,
            api::photos::set_favorite,
            api::photos::remove_photos,
            api::photos::delete_photos_from_disk,
            api::photos::restore_photos,
            api::photos::list_duplicates,
            api::photos::list_photo_ids,
            api::photos::save_edited_image,
            api::photos::overwrite_original,
            api::photos::set_capture_date,
            // thumbnails
            api::thumbnails::thumbnail_path,
            api::thumbnails::ensure_thumbnail,
            api::thumbnails::display_preview,
            // scan / folders
            api::scan::scan_folders,
            api::scan::rescan_library,
            api::scan::regenerate_thumbnails,
            api::scan::scan_progress,
            api::scan::list_watched_folders,
            api::scan::add_watched_folder,
            api::scan::remove_watched_folder,
            // tags
            api::tags::list_tags,
            api::tags::create_tag,
            api::tags::update_tag,
            api::tags::delete_tag,
            api::tags::attach_tag,
            api::tags::detach_tag,
            // albums
            api::albums::list_albums,
            api::albums::get_album,
            api::albums::create_album,
            api::albums::move_album,
            api::albums::rename_album,
            api::albums::delete_album,
            api::albums::add_to_album,
            api::albums::remove_from_album,
            api::albums::album_photos,
            // import as albums
            api::import::preview_import_tree,
            api::import::import_as_albums,
            // settings / ai
            api::settings::get_config,
            api::settings::update_config,
            api::settings::ai_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumina");
}
