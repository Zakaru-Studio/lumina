//! Content hashing shared across the scanner and backup pipelines.
//!
//! A file's SHA-256 is used both for library dedupe/integrity (the "Duplicates"
//! smart album) and for the external-drive backup diff, so it lives here rather
//! than in any single pipeline.

use std::io::{Read, Write};
use std::path::Path;

use crate::core::error::Result;

/// Read buffer size shared by the hashers — 64 KB, so arbitrarily large media
/// never loads fully into memory.
const CHUNK: usize = 64 * 1024;

/// Stream a file through SHA-256, returning the lowercase hex digest.
pub fn hash_file(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; CHUNK];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Stream `src` into `dst`, returning `(sha256, bytes_written)` for the copied
/// bytes. Reads the source once and hashes in the same pass, so a verified
/// backup copy costs a single read of the source rather than a copy + a separate
/// re-hash. The caller is responsible for flushing/syncing and renaming `dst`.
pub fn copy_and_hash(src: &Path, dst: &mut impl Write) -> Result<(String, u64)> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(src)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; CHUNK];
    let mut total = 0u64;
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        dst.write_all(&buf[..n])?;
        total += n as u64;
    }
    Ok((format!("{:x}", hasher.finalize()), total))
}
