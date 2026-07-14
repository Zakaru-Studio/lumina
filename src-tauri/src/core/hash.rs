//! Content hashing shared across the scanner and backup pipelines.
//!
//! A file's SHA-256 is used both for library dedupe/integrity (the "Duplicates"
//! smart album) and for the external-drive backup diff, so it lives here rather
//! than in any single pipeline.

use std::io::Read;
use std::path::Path;

use crate::core::error::Result;

/// Stream a file through SHA-256, returning the lowercase hex digest. Reads in
/// 64 KB chunks so arbitrarily large media never loads fully into memory.
pub fn hash_file(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
