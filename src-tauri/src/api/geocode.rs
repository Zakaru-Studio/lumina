//! Reverse-geocoding command — the online fallback for the map's place names,
//! backed by a persistent DB cache so any coordinate is fetched online at most
//! once.

use std::sync::Arc;

use tauri::State;

use crate::api::{blocking, now};
use crate::core::error::Result;
use crate::core::models::{GeoPlace, GeoSearchResult};
use crate::core::state::SharedState;
use crate::database::geocache;
use crate::geocode;

/// Resolve a coordinate to a human place (city / region / country).
///
/// Checks the persistent cache first; on a miss it queries the free Nominatim
/// service and stores a successful result so the same spot is never looked up
/// online again. Returns `None` when nothing resolves or the lookup fails — the
/// UI then keeps its offline guess (and a failure is left uncached, so it can be
/// retried later). `lang` (a UI language code) localizes the returned names.
#[tauri::command]
pub async fn reverse_geocode(
    state: State<'_, SharedState>,
    lat: f64,
    lon: f64,
    lang: Option<String>,
) -> Result<Option<GeoPlace>> {
    if !lat.is_finite() || !lon.is_finite() {
        return Ok(None);
    }
    let state = Arc::clone(&state);
    let lang = lang.unwrap_or_else(|| "en".to_string());
    blocking(move || {
        // ~110 m grid cell so nearby photos of the same spot share a cache row.
        let lat_e3 = (lat * 1000.0).round() as i64;
        let lon_e3 = (lon * 1000.0).round() as i64;

        let conn = state.db.get()?;
        if let Some(cached) = geocache::get(&conn, lat_e3, lon_e3, &lang)? {
            return Ok(Some(cached));
        }

        let fetched = geocode::reverse(lat, lon, &lang)?;
        if let Some(ref place) = fetched {
            geocache::put(&conn, lat_e3, lon_e3, &lang, place, now())?;
        }
        Ok(fetched)
    })
    .await
}

/// All distinct reverse-geocoded place names (city / region / country) present
/// in the cache, for the library's place filter. May be empty until coordinates
/// have been resolved (e.g. by browsing the map).
#[tauri::command]
pub async fn list_places(state: State<'_, SharedState>) -> Result<Vec<String>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let conn = state.db.get()?;
        geocache::distinct_places(&conn)
    })
    .await
}

/// Forward-geocode a free-text place (city / region / country) to its best
/// matching coordinate + place, via the free Nominatim service. Returns `None`
/// when nothing matches or the lookup fails. Used by the location editor so a
/// typed place can drop the map pin.
#[tauri::command]
pub async fn geocode_search(
    query: String,
    lang: Option<String>,
) -> Result<Option<GeoSearchResult>> {
    blocking(move || geocode::search(&query, lang.as_deref().unwrap_or("en"))).await
}

/// Forward-geocode a free-text address to several ranked matches, for the
/// location editor's address search box. Empty on no match / failure.
#[tauri::command]
pub async fn geocode_search_all(
    query: String,
    lang: Option<String>,
) -> Result<Vec<GeoSearchResult>> {
    blocking(move || geocode::search_all(&query, lang.as_deref().unwrap_or("en"), 6)).await
}

/// Read the cached place for a coordinate **without** any online lookup. Used to
/// pre-fill the location editor with a previously-saved place.
#[tauri::command]
pub async fn get_place(
    state: State<'_, SharedState>,
    lat: f64,
    lon: f64,
    lang: Option<String>,
) -> Result<Option<GeoPlace>> {
    if !lat.is_finite() || !lon.is_finite() {
        return Ok(None);
    }
    let state = Arc::clone(&state);
    let lang = lang.unwrap_or_else(|| "en".to_string());
    blocking(move || {
        let lat_e3 = (lat * 1000.0).round() as i64;
        let lon_e3 = (lon * 1000.0).round() as i64;
        let conn = state.db.get()?;
        geocache::get(&conn, lat_e3, lon_e3, &lang)
    })
    .await
}

/// Store a user-entered place (city / region / country) for a coordinate,
/// overriding whatever the geocoder would derive. Persists to the same cache the
/// map and editor read from, so the label sticks. Blank fields are normalized to
/// `null`.
#[tauri::command]
pub async fn set_place(
    state: State<'_, SharedState>,
    lat: f64,
    lon: f64,
    lang: Option<String>,
    city: Option<String>,
    region: Option<String>,
    country: Option<String>,
) -> Result<()> {
    if !lat.is_finite() || !lon.is_finite() {
        return Ok(());
    }
    let state = Arc::clone(&state);
    let lang = lang.unwrap_or_else(|| "en".to_string());
    let norm = |s: Option<String>| s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let place = GeoPlace {
        city: norm(city),
        region: norm(region),
        country: norm(country),
    };
    blocking(move || {
        let lat_e3 = (lat * 1000.0).round() as i64;
        let lon_e3 = (lon * 1000.0).round() as i64;
        let conn = state.db.get()?;
        geocache::put(&conn, lat_e3, lon_e3, &lang, &place, now())
    })
    .await
}
