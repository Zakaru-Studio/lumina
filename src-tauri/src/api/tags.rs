//! Tag commands.

use std::sync::Arc;

use tauri::State;

use crate::api::{blocking, now};
use crate::core::error::Result;
use crate::core::models::Tag;
use crate::core::state::SharedState;
use crate::database::tags;

#[tauri::command]
pub async fn list_tags(state: State<'_, SharedState>) -> Result<Vec<Tag>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        tags::list(&conn)
    })
    .await
}

#[tauri::command]
pub async fn create_tag(
    state: State<'_, SharedState>,
    name: String,
    color: Option<String>,
) -> Result<Tag> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        tags::create(&conn, &name, color.as_deref(), now())
    })
    .await
}

#[tauri::command]
pub async fn update_tag(
    state: State<'_, SharedState>,
    id: String,
    name: String,
    color: Option<String>,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        tags::update(&conn, &id, &name, color.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn delete_tag(state: State<'_, SharedState>, id: String) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        tags::delete(&conn, &id)
    })
    .await
}

#[tauri::command]
pub async fn attach_tag(
    state: State<'_, SharedState>,
    tag_id: String,
    photo_ids: Vec<String>,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        tags::attach(&conn, &tag_id, &photo_ids, now())
    })
    .await
}

#[tauri::command]
pub async fn detach_tag(
    state: State<'_, SharedState>,
    tag_id: String,
    photo_ids: Vec<String>,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        tags::detach(&conn, &tag_id, &photo_ids)
    })
    .await
}
