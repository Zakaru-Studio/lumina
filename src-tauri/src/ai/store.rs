//! Persistence helpers for AI artifacts. Wired to the `ai_embeddings` and
//! `ai_regions` tables so future providers have a ready storage path.

use rusqlite::{params, Connection};

use crate::ai::{Embedding, Region};
use crate::core::error::Result;

/// Encode an f32 vector as little-endian bytes for BLOB storage.
fn encode_vector(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

/// Decode a little-endian f32 BLOB back into a vector.
pub fn decode_vector(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

/// Persist an embedding for a photo.
pub fn save_embedding(conn: &Connection, photo_id: &str, emb: &Embedding, now: i64) -> Result<()> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO ai_embeddings (id, photo_id, kind, model, dim, vector, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            photo_id,
            emb.kind.as_str(),
            emb.model,
            emb.vector.len() as i64,
            encode_vector(&emb.vector),
            now
        ],
    )?;
    Ok(())
}

/// Persist a detected region for a photo.
pub fn save_region(conn: &Connection, photo_id: &str, region: &Region, now: i64) -> Result<()> {
    let id = uuid::Uuid::new_v4().to_string();
    let data = region
        .data
        .as_ref()
        .map(|v| v.to_string());
    conn.execute(
        "INSERT INTO ai_regions (id, photo_id, kind, label, confidence, x, y, w, h, data, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            photo_id,
            region.kind.as_str(),
            region.label,
            region.confidence,
            region.x,
            region.y,
            region.w,
            region.h,
            data,
            now
        ],
    )?;
    Ok(())
}
