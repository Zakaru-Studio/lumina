//! Core module: cross-cutting types with no external dependencies on other
//! backend modules — the error type, domain models, configuration, query
//! contracts and shared application state.

pub mod config;
pub mod error;
pub mod hash;
pub mod models;
pub mod query;
pub mod state;

pub use error::{Error, Result};
