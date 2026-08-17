//! Secret storage for the OpenRouter API key, split by platform.
//!
//! macOS keeps its original Security.framework implementation untouched so that
//! existing installs keep reading the exact Keychain item they already wrote;
//! rewriting it onto a cross-platform abstraction would put every current
//! user's stored key at migration risk to save three functions of duplication.
//! Windows gets its own Credential Manager implementation instead.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{clear_api_key, load_api_key, save_api_key};

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{clear_api_key, load_api_key, save_api_key};

