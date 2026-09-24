//! Secret storage for the custom (OpenAI-compatible) endpoint API key.
//!
//! Classification and Intelligence share one custom endpoint connection, so a
//! single key lives here. It mirrors `openrouter_key_store`: macOS uses the
//! Security.framework Keychain and Windows uses the Credential Manager, under a
//! service name distinct from the OpenRouter key so clearing one never touches
//! the other.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{clear_api_key, load_api_key, save_api_key};

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{clear_api_key, load_api_key, save_api_key};
