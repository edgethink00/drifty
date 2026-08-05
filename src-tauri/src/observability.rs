const DEFAULT_SENTRY_ENVIRONMENT: &str = "development";
const SENTRY_RELEASE_PREFIX: &str = "drifty-mac@";
const SHORT_COMMIT_LENGTH: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
struct NativeSentryConfig {
    dsn: String,
    environment: String,
    release: String,
}

pub fn init_native_sentry() -> Option<sentry::ClientInitGuard> {
    let config = resolve_native_sentry_config()?;
    Some(sentry::init((
        config.dsn,
        sentry::ClientOptions {
            release: Some(config.release.into()),
            environment: Some(config.environment.into()),
            send_default_pii: false,
            traces_sample_rate: 0.0,
            ..Default::default()
        },
    )))
}

pub(crate) fn tracker_sentry_env_vars() -> Vec<(&'static str, String)> {
    let mut vars = Vec::new();
    if let Some(dsn) = first_non_empty([
        runtime_env("DRIFTY_TRACKER_SENTRY_DSN"),
        runtime_env("DRIFTY_NATIVE_SENTRY_DSN"),
        runtime_env("SENTRY_DSN"),
        compile_env(option_env!("DRIFTY_TRACKER_SENTRY_DSN")),
        compile_env(option_env!("DRIFTY_NATIVE_SENTRY_DSN")),
        compile_env(option_env!("SENTRY_DSN")),
    ]) {
        vars.push(("DRIFTY_TRACKER_SENTRY_DSN", dsn));
    }
    vars.push((
        "SENTRY_ENVIRONMENT",
        sentry_environment().unwrap_or_else(|| DEFAULT_SENTRY_ENVIRONMENT.to_string()),
    ));
    vars.push(("SENTRY_RELEASE", sentry_release()));
    vars
}

fn resolve_native_sentry_config() -> Option<NativeSentryConfig> {
    let dsn = first_non_empty([
        runtime_env("DRIFTY_NATIVE_SENTRY_DSN"),
        runtime_env("SENTRY_DSN"),
        compile_env(option_env!("DRIFTY_NATIVE_SENTRY_DSN")),
        compile_env(option_env!("SENTRY_DSN")),
    ])?;

    Some(NativeSentryConfig {
        dsn,
        environment: sentry_environment().unwrap_or_else(|| DEFAULT_SENTRY_ENVIRONMENT.to_string()),
        release: sentry_release(),
    })
}

fn sentry_environment() -> Option<String> {
    first_non_empty([
        runtime_env("DRIFTY_SENTRY_ENVIRONMENT"),
        runtime_env("SENTRY_ENVIRONMENT"),
        runtime_env("VITE_DRIFTY_CHANNEL"),
        compile_env(option_env!("DRIFTY_SENTRY_ENVIRONMENT")),
        compile_env(option_env!("SENTRY_ENVIRONMENT")),
        compile_env(option_env!("VITE_DRIFTY_CHANNEL")),
    ])
}

fn sentry_release() -> String {
    first_non_empty([
        runtime_env("DRIFTY_SENTRY_RELEASE"),
        runtime_env("SENTRY_RELEASE"),
        compile_env(option_env!("DRIFTY_SENTRY_RELEASE")),
        compile_env(option_env!("SENTRY_RELEASE")),
    ])
    .unwrap_or_else(|| {
        build_release(
            env!("CARGO_PKG_VERSION"),
            option_env!("DRIFTY_BUILD_COMMIT"),
        )
    })
}

fn build_release(version: &str, commit: Option<&str>) -> String {
    let version = non_empty_trimmed(version).unwrap_or_else(|| "unknown".to_string());
    let Some(commit) = compile_env(commit) else {
        return format!("{SENTRY_RELEASE_PREFIX}{version}");
    };
    if commit == "unknown" {
        return format!("{SENTRY_RELEASE_PREFIX}{version}");
    }
    let short_commit: String = commit.chars().take(SHORT_COMMIT_LENGTH).collect();
    format!("{SENTRY_RELEASE_PREFIX}{version}+{short_commit}")
}

fn runtime_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .and_then(|value| non_empty_trimmed(&value))
}

fn compile_env(value: Option<&str>) -> Option<String> {
    value.and_then(non_empty_trimmed)
}

fn first_non_empty(values: impl IntoIterator<Item = Option<String>>) -> Option<String> {
    values.into_iter().flatten().next()
}

fn non_empty_trimmed(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::build_release;

    #[test]
    fn build_release_includes_short_commit_when_present() {
        assert_eq!(
            build_release("1.2.16", Some("d1f00b6a2cc9a43278b4e3f61234567890123456")),
            "drifty-mac@1.2.16+d1f00b6a2cc9"
        );
    }

    #[test]
    fn build_release_omits_unknown_commit() {
        assert_eq!(
            build_release("1.2.16", Some("unknown")),
            "drifty-mac@1.2.16"
        );
        assert_eq!(build_release("1.2.16", None), "drifty-mac@1.2.16");
    }
}
