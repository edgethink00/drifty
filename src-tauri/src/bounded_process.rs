//! Shared bounded process collector; tracker limits and behavior are unchanged.
pub(crate) use drifty_screen_context_core::process::{output, MAX_STDOUT_BYTES};

#[cfg(target_os = "macos")]
pub(crate) use drifty_screen_context_core::process::output_cancellable;
