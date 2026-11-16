//! Use the native bundle identity, including for release-mode QA builds.
pub const PRODUCTION_APP_IDENTIFIER: &str = "so.drifty.mac";

pub fn is_production_identifier(identifier: &str) -> bool {
    matches!(identifier, PRODUCTION_APP_IDENTIFIER | "so.drifty.windows")
}

/// All app and memory keychain calls share the core's process-wide UI lock.
#[cfg(target_os = "macos")]
pub fn with_keychain_interaction<T>(
    allow: bool,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    drifty_screen_context_core::key_store::interaction::run(allow, operation)
        .map_err(|status| format!("Credential interaction control failed (OS status {status})."))?
}

pub fn service_for_app(service: &str, identifier: &str, debug_build: bool) -> String {
    if is_production_identifier(identifier) && !debug_build {
        return service.to_owned();
    }
    let suffix = if debug_build { ".debug" } else { "" };
    format!("{service}.{identifier}{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_production_and_isolates_qa_even_in_release_builds() {
        for service in [
            "so.drifty.auth-session",
            "so.drifty.cloud-device",
            "so.drifty.openrouter-api-key",
            "so.drifty.custom-endpoint-api-key",
        ] {
            assert_eq!(
                service_for_app(service, PRODUCTION_APP_IDENTIFIER, false),
                service
            );
            assert_eq!(
                service_for_app(service, "so.drifty.windows", false),
                service
            );
            let qa = service_for_app(service, "so.drifty.mac.memoryqa", false);
            assert_ne!(qa, service);
            assert_ne!(qa, service_for_app(service, "so.drifty.mac.otherqa", false));
            assert_ne!(
                service_for_app(service, PRODUCTION_APP_IDENTIFIER, true),
                service
            );
        }
    }
}
