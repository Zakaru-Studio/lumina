//! Online reverse geocoding — an opt-in fallback for the map's place names.
//!
//! The map resolves most points offline from bundled data. When it can't name a
//! spot, the UI may ask here for a precise place. We query OpenStreetMap's free
//! Nominatim service: only a single `[lat, lon]` is sent, only on an explicit
//! click, and any failure degrades silently (the caller keeps its offline
//! guess). No API key; we identify ourselves per the Nominatim usage policy and
//! cap the request with a timeout. Nothing else about the photo is transmitted.

use std::time::Duration;

use serde_json::Value;

use crate::core::error::Result;
use crate::core::models::{GeoPlace, GeoSearchResult};

/// Identifies the app to Nominatim (their policy requires a real User-Agent).
const USER_AGENT: &str = concat!(
    "Lumina/",
    env!("CARGO_PKG_VERSION"),
    " (local photo library; support@zakaru.studio)"
);

/// Reverse-geocode `[lat, lon]` via Nominatim, preferring names in `lang`.
/// Returns `Ok(None)` on invalid input or any network/parse failure, so the
/// caller can fall back to its offline result without surfacing an error.
pub fn reverse(lat: f64, lon: f64, lang: &str) -> Result<Option<GeoPlace>> {
    if !lat.is_finite() || !lon.is_finite() {
        return Ok(None);
    }

    // `zoom=12` asks for roughly city-level detail; `addressdetails=1` returns
    // the structured `address` object we pick fields from.
    let url = format!(
        "https://nominatim.openstreetmap.org/reverse\
         ?format=jsonv2&zoom=12&addressdetails=1&lat={lat}&lon={lon}"
    );

    let body = match ureq::get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept-Language", if lang.is_empty() { "en" } else { lang })
        .timeout(Duration::from_secs(8))
        .call()
    {
        Ok(resp) => match resp.into_string() {
            Ok(b) => b,
            Err(_) => return Ok(None),
        },
        // Network error or non-2xx status (rate-limit, etc.) — degrade quietly.
        Err(_) => return Ok(None),
    };

    let json: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let place = place_from_address(&json["address"]);
    if place.city.is_none() && place.region.is_none() && place.country.is_none() {
        return Ok(None);
    }
    Ok(Some(place))
}

/// Forward-geocode a free-text query to up to `limit` matching places, best
/// first. `Ok(vec![])` on empty input or any failure. Powers the location
/// editor's address search.
pub fn search_all(query: &str, lang: &str, limit: u32) -> Result<Vec<GeoSearchResult>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    // ureq URL-encodes query values, so the free-text `q` is passed safely.
    let body = match ureq::get("https://nominatim.openstreetmap.org/search")
        .query("format", "jsonv2")
        .query("addressdetails", "1")
        .query("limit", &limit.clamp(1, 20).to_string())
        .query("q", q)
        .set("User-Agent", USER_AGENT)
        .set("Accept-Language", if lang.is_empty() { "en" } else { lang })
        .timeout(Duration::from_secs(8))
        .call()
    {
        Ok(resp) => match resp.into_string() {
            Ok(b) => b,
            Err(_) => return Ok(Vec::new()),
        },
        Err(_) => return Ok(Vec::new()),
    };

    let json: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()),
    };
    match json.as_array() {
        Some(arr) => Ok(arr.iter().filter_map(parse_hit).collect()),
        None => Ok(Vec::new()),
    }
}

/// Forward-geocode to the single best match (used by "locate"). Thin wrapper.
pub fn search(query: &str, lang: &str) -> Result<Option<GeoSearchResult>> {
    Ok(search_all(query, lang, 1)?.into_iter().next())
}

/// Parse one Nominatim `/search` hit into a [`GeoSearchResult`], or `None` when
/// it lacks usable coordinates. Nominatim returns lat/lon as strings.
fn parse_hit(hit: &Value) -> Option<GeoSearchResult> {
    let lat = hit.get("lat").and_then(Value::as_str).and_then(|s| s.parse::<f64>().ok())?;
    let lon = hit.get("lon").and_then(Value::as_str).and_then(|s| s.parse::<f64>().ok())?;
    Some(GeoSearchResult {
        lat,
        lon,
        place: place_from_address(&hit["address"]),
        display_name: hit
            .get("display_name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    })
}

/// Extract city / region / country from a Nominatim `address` object. Nominatim
/// spreads the locality across several keys by place type; take the first
/// populated one, from most- to least-specific.
fn place_from_address(addr: &Value) -> GeoPlace {
    let pick = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(s) = addr.get(*k).and_then(Value::as_str) {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
        }
        None
    };
    GeoPlace {
        city: pick(&["city", "town", "village", "municipality", "hamlet", "suburb"]),
        region: pick(&["state", "region", "province", "county"]),
        country: pick(&["country"]),
    }
}
