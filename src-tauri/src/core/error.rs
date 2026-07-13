//! Central error type for the whole backend.
//!
//! Every fallible function returns [`Result<T>`]. Errors are converted to a
//! stable, serializable shape at the Tauri boundary so the frontend can react
//! to error *kinds* rather than parsing strings.

use serde::Serialize;

/// The single error type used across all modules.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("connection pool error: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),

    #[error("image error: {0}")]
    Image(#[from] image::ImageError),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("filesystem watch error: {0}")]
    Watch(#[from] notify::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    Invalid(String),

    #[error("unsupported: {0}")]
    Unsupported(String),

    #[error("task join error: {0}")]
    Join(String),

    #[error("{0}")]
    Other(String),
}

/// Machine-readable error category, mirrored by the frontend `ApiError` type.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Database,
    Io,
    Image,
    Serde,
    Watch,
    NotFound,
    Invalid,
    Unsupported,
    Internal,
}

/// Serializable payload sent to the frontend for every rejected command.
#[derive(Debug, Serialize)]
pub struct ApiError {
    pub kind: ErrorKind,
    pub message: String,
}

impl Error {
    /// Classify the error into a stable [`ErrorKind`].
    pub fn kind(&self) -> ErrorKind {
        match self {
            Error::Database(_) | Error::Pool(_) => ErrorKind::Database,
            Error::Io(_) => ErrorKind::Io,
            Error::Image(_) => ErrorKind::Image,
            Error::Serde(_) => ErrorKind::Serde,
            Error::Watch(_) => ErrorKind::Watch,
            Error::NotFound(_) => ErrorKind::NotFound,
            Error::Invalid(_) => ErrorKind::Invalid,
            Error::Unsupported(_) => ErrorKind::Unsupported,
            Error::Join(_) | Error::Other(_) => ErrorKind::Internal,
        }
    }
}

/// Tauri serializes command errors via `Serialize`; forward to [`ApiError`].
impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        ApiError {
            kind: self.kind(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

impl From<anyhow::Error> for Error {
    fn from(e: anyhow::Error) -> Self {
        Error::Other(e.to_string())
    }
}

impl From<tokio::task::JoinError> for Error {
    fn from(e: tokio::task::JoinError) -> Self {
        Error::Join(e.to_string())
    }
}

/// Convenience alias used throughout the crate.
pub type Result<T> = std::result::Result<T, Error>;
