//! Face recognition ("People") commands.
//!
//! Thin handlers over [`crate::ai::face`]: they marshal input, run DB/model work
//! off the UI thread, and emit `people://changed` so the People views refresh.

use std::sync::Arc;

use tauri::State;

use crate::ai::face::{store, FaceBox, FaceStatus, PersonSummary};
use crate::api::{blocking, now};
use crate::core::error::Result;
use crate::core::state::SharedState;
use crate::database::settings;
use crate::events;

/// Current capability + progress status of the face feature.
#[tauri::command]
pub async fn face_status(state: State<'_, SharedState>) -> Result<FaceStatus> {
    let state = Arc::clone(&state);
    blocking(move || state.faces.status()).await
}

/// Turn face recognition on or off. Enabling downloads the models (if missing)
/// and loads the engine *before* flipping the setting, so a download failure
/// surfaces immediately and leaves the feature off; it then kicks off indexing.
#[tauri::command]
pub async fn set_face_recognition_enabled(
    state: State<'_, SharedState>,
    enabled: bool,
) -> Result<FaceStatus> {
    let state = Arc::clone(&state);
    blocking(move || {
        if enabled {
            // May download ~37 MB and load the models; errors abort enabling.
            state.faces.prepare()?;
        }
        let mut cfg = state.config_snapshot();
        cfg.face_recognition_enabled = enabled;
        {
            let conn = state.db.get()?;
            settings::save_config(&conn, &cfg)?;
        }
        *state.config.write() = cfg;
        if enabled {
            state.faces.spawn_index();
        }
        state.faces.status()
    })
    .await
}

/// Manually (re)start an indexing pass over photos still lacking faces.
#[tauri::command]
pub async fn index_faces_now(state: State<'_, SharedState>) -> Result<()> {
    state.faces.spawn_index();
    Ok(())
}

/// Erase all face data (faces, people, indexing state).
#[tauri::command]
pub async fn clear_face_data(state: State<'_, SharedState>) -> Result<FaceStatus> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.faces.clear_data()?;
        state.faces.status()
    })
    .await
}

/// List people (clusters). `min_faces` hides singletons; `include_hidden` shows
/// hidden clusters; `named_only` restricts to named people.
#[tauri::command]
pub async fn list_people(
    state: State<'_, SharedState>,
    include_hidden: bool,
    named_only: bool,
    min_faces: i64,
) -> Result<Vec<PersonSummary>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        store::list_people(&conn, include_hidden, named_only, min_faces.max(1))
    })
    .await
}

/// Fetch one person by id.
#[tauri::command]
pub async fn get_person(
    state: State<'_, SharedState>,
    id: String,
) -> Result<Option<PersonSummary>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        store::get_person(&conn, &id)
    })
    .await
}

/// Face boxes detected in a photo (for overlays / corrections).
#[tauri::command]
pub async fn faces_in_photo(
    state: State<'_, SharedState>,
    photo_id: String,
) -> Result<Vec<FaceBox>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        store::faces_in_photo(&conn, &photo_id)
    })
    .await
}

/// Rename a person (blank clears the name).
#[tauri::command]
pub async fn rename_person(
    state: State<'_, SharedState>,
    id: String,
    name: Option<String>,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        store::rename_person(&conn, &id, name.as_deref(), now())?;
        events::emit(&state.app, events::names::PEOPLE_CHANGED, ());
        Ok(())
    })
    .await
}

/// Hide or unhide a person cluster.
#[tauri::command]
pub async fn set_person_hidden(
    state: State<'_, SharedState>,
    id: String,
    hidden: bool,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        store::set_person_hidden(&conn, &id, hidden, now())?;
        events::emit(&state.app, events::names::PEOPLE_CHANGED, ());
        Ok(())
    })
    .await
}

/// Delete a person and all of its face detections.
#[tauri::command]
pub async fn delete_person(state: State<'_, SharedState>, id: String) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        store::delete_person(&conn, &id)?;
        events::emit(&state.app, events::names::PEOPLE_CHANGED, ());
        Ok(())
    })
    .await
}

/// Merge several people into one (their faces become user-confirmed members of
/// the target; the emptied source clusters are removed).
#[tauri::command]
pub async fn merge_people(
    state: State<'_, SharedState>,
    sources: Vec<String>,
    into: String,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        store::merge_people(&conn, &sources, &into, now())?;
        events::emit(&state.app, events::names::PEOPLE_CHANGED, ());
        Ok(())
    })
    .await
}

/// Reassign specific faces to a person (`None` detaches them). User correction.
#[tauri::command]
pub async fn assign_faces(
    state: State<'_, SharedState>,
    face_ids: Vec<String>,
    person_id: Option<String>,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        store::assign_faces(&conn, &face_ids, person_id.as_deref(), now())?;
        store::prune_empty_persons(&conn)?;
        events::emit(&state.app, events::names::PEOPLE_CHANGED, ());
        Ok(())
    })
    .await
}

/// Create a new, optionally-named empty person the user can move faces into.
#[tauri::command]
pub async fn create_person(
    state: State<'_, SharedState>,
    name: Option<String>,
) -> Result<String> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        let id = store::new_named_person(&conn, name.as_deref(), now())?;
        events::emit(&state.app, events::names::PEOPLE_CHANGED, ());
        Ok(id)
    })
    .await
}
