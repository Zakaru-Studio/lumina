//! AI module — **architecture only** for the MVP.
//!
//! No models are bundled or executed. This module defines the provider traits,
//! data types and a registry so future capabilities (CLIP embeddings, face
//! recognition, OCR, vector search) can be added without touching the rest of
//! the codebase. The database already carries `ai_embeddings` and `ai_regions`
//! tables to persist their output.
//!
//! Integration plan:
//!   * Implement [`EmbeddingProvider`] for a CLIP model → store vectors via
//!     [`store::save_embedding`]; add a `vector` search path in the search
//!     module (brute-force cosine now, ANN index later).
//!   * Implement [`RegionDetector`] for faces/OCR → store boxes via
//!     [`store::save_region`].
//!   * Register providers in [`AiRegistry`] at startup; expose Tauri commands
//!     that call them. None of this requires schema or API changes.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::core::error::Result;

pub mod store;

/// The kind of artifact an AI provider produces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiKind {
    Clip,
    Face,
    Ocr,
}

impl AiKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AiKind::Clip => "clip",
            AiKind::Face => "face",
            AiKind::Ocr => "ocr",
        }
    }
}

/// A dense embedding vector for a photo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Embedding {
    pub kind: AiKind,
    pub model: String,
    pub vector: Vec<f32>,
}

/// A detected region (face bbox, text box) in normalized 0..1 coordinates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Region {
    pub kind: AiKind,
    pub label: Option<String>,
    pub confidence: Option<f32>,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// Extra provider-specific payload (e.g. recognized OCR text).
    pub data: Option<serde_json::Value>,
}

/// Produces embeddings for images (e.g. CLIP). Implemented later.
pub trait EmbeddingProvider: Send + Sync {
    /// Stable model identifier stored alongside vectors.
    fn model_id(&self) -> &str;
    /// Embed a decoded image given by path.
    fn embed_image(&self, image_path: &std::path::Path) -> Result<Embedding>;
    /// Embed a text query for cross-modal search (CLIP text tower).
    fn embed_text(&self, _text: &str) -> Result<Embedding> {
        Err(crate::core::error::Error::Unsupported(
            "text embedding not implemented".into(),
        ))
    }
}

/// Detects regions of interest (faces, text). Implemented later.
pub trait RegionDetector: Send + Sync {
    fn kind(&self) -> AiKind;
    fn detect(&self, image_path: &std::path::Path) -> Result<Vec<Region>>;
}

/// Central registry of optional AI providers. Empty in the MVP; wiring a
/// provider is a one-line registration at startup.
#[derive(Default, Clone)]
pub struct AiRegistry {
    pub embedders: Vec<Arc<dyn EmbeddingProvider>>,
    pub detectors: Vec<Arc<dyn RegionDetector>>,
}

impl AiRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// True when at least one provider is available (drives UI feature flags).
    pub fn is_enabled(&self) -> bool {
        !self.embedders.is_empty() || !self.detectors.is_empty()
    }

    pub fn register_embedder(&mut self, p: Arc<dyn EmbeddingProvider>) {
        self.embedders.push(p);
    }

    pub fn register_detector(&mut self, d: Arc<dyn RegionDetector>) {
        self.detectors.push(d);
    }
}

/// Cosine similarity helper for future brute-force vector search.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na.sqrt() * nb.sqrt())
    }
}
