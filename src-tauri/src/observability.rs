const DEFAULT_SENTRY_ENVIRONMENT: &str = "development";
const SENTRY_RELEASE_PREFIX: &str = "drifty-mac@";
const SHORT_COMMIT_LENGTH: usize = 12;
const REDACTED_USER: &str = "[user]";

#[derive(Debug, Clone, PartialEq, Eq)]
struct NativeSentryConfig {
    dsn: String,
    environment: String,
    release: String,
}

pub fn init_native_sentry() -> Option<sentry::ClientInitGuard> {
    let config = resolve_native_sentry_config()?;
    let options = native_client_options(&config);
    Some(sentry::init((config.dsn, options)))
}

fn native_client_options(config: &NativeSentryConfig) -> sentry::ClientOptions {
    sentry::ClientOptions {
        release: Some(config.release.clone().into()),
        environment: Some(config.environment.clone().into()),
        send_default_pii: false,
        traces_sample_rate: 0.0,
        before_send: Some(std::sync::Arc::new(|event| Some(scrub_native_event(event)))),
        ..Default::default()
    }
}

/// Remove device and account identity that the SDK attaches on its own:
/// the hostname (`server_name`, e.g. "Jane-MacBook-Air.local") and the
/// profile directory inside module and frame paths (e.g. a Windows build run
/// from `C:\Users\<name>\Downloads\drifty.exe`).
fn scrub_native_event(mut event: sentry::protocol::Event<'static>) -> sentry::protocol::Event<'static> {
    use sentry::protocol::DebugImage;

    event.server_name = None;
    event.message = event.message.take().map(|message| redact_user_home(&message));
    for exception in event.exception.values.iter_mut() {
        exception.value = exception.value.take().map(|value| redact_user_home(&value));
        scrub_stacktrace(exception.stacktrace.as_mut());
        scrub_stacktrace(exception.raw_stacktrace.as_mut());
    }
    for thread in event.threads.values.iter_mut() {
        scrub_stacktrace(thread.stacktrace.as_mut());
        scrub_stacktrace(thread.raw_stacktrace.as_mut());
    }
    scrub_stacktrace(event.stacktrace.as_mut());
    for image in event.debug_meta.to_mut().images.iter_mut() {
        match image {
            DebugImage::Apple(image) => image.name = redact_user_home(&image.name),
            DebugImage::Symbolic(image) => image.name = redact_user_home(&image.name),
            DebugImage::Wasm(image) => image.code_file = redact_user_home(&image.code_file),
            _ => {}
        }
    }
    event
}

fn scrub_stacktrace(stacktrace: Option<&mut sentry::protocol::Stacktrace>) {
    let Some(stacktrace) = stacktrace else {
        return;
    };
    for frame in stacktrace.frames.iter_mut() {
        for path in [&mut frame.package, &mut frame.filename, &mut frame.abs_path] {
            if let Some(value) = path.as_mut() {
                *value = redact_user_home(value);
            }
        }
    }
}

/// Replace the account segment after a `Users` directory in either separator
/// style: `/Users/<name>/…` and `C:\Users\<name>\…` become `…/Users/[user]/…`.
fn redact_user_home(path: &str) -> String {
    const USERS: &str = "users";
    let is_separator = |byte: u8| byte == b'/' || byte == b'\\';
    // ASCII lowercasing keeps byte offsets identical to `path`.
    let lower = path.to_ascii_lowercase();
    let bytes = path.as_bytes();
    let mut redacted = String::with_capacity(path.len());
    let mut copied_until = 0;
    let mut search_from = 0;
    while let Some(offset) = lower[search_from..].find(USERS) {
        let users_start = search_from + offset;
        let users_end = users_start + USERS.len();
        search_from = users_end;
        if users_start == 0 || !is_separator(bytes[users_start - 1]) {
            continue;
        }
        let mut name_start = users_end;
        while name_start < bytes.len() && is_separator(bytes[name_start]) {
            name_start += 1;
        }
        if name_start == users_end || name_start == bytes.len() {
            continue;
        }
        let mut name_end = name_start;
        while name_end < bytes.len() && !is_separator(bytes[name_end]) {
            name_end += 1;
        }
        search_from = name_end;
        if &path[name_start..name_end] == REDACTED_USER {
            continue;
        }
        redacted.push_str(&path[copied_until..name_start]);
        redacted.push_str(REDACTED_USER);
        copied_until = name_end;
    }
    redacted.push_str(&path[copied_until..]);
    redacted
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
    use super::{
        build_release, native_client_options, redact_user_home, scrub_native_event,
        NativeSentryConfig,
    };
    use sentry::protocol::{
        DebugImage, DebugMeta, Event, Exception, Frame, Stacktrace, SymbolicDebugImage,
    };
    use std::borrow::Cow;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    struct CapturingTransport(Arc<Mutex<Vec<sentry::Envelope>>>);

    impl sentry::Transport for CapturingTransport {
        fn send_envelope(&self, envelope: sentry::Envelope) {
            self.0.lock().unwrap().push(envelope);
        }
    }

    #[test]
    fn native_client_sends_events_without_the_hostname_its_integrations_add() {
        let envelopes = Arc::new(Mutex::new(Vec::new()));
        let sink = envelopes.clone();
        let mut options = native_client_options(&NativeSentryConfig {
            dsn: "https://public@example.invalid/1".to_string(),
            environment: "test".to_string(),
            release: "drifty-mac@0.0.0".to_string(),
        });
        options.dsn = "https://public@example.invalid/1".parse().ok();
        options.transport = Some(Arc::new(move |_: &sentry::ClientOptions| {
            Arc::new(CapturingTransport(sink.clone())) as Arc<dyn sentry::Transport>
        }));
        // The same defaults sentry::init installs, including the contexts
        // integration that fills server_name with the device hostname.
        let client = Arc::new(sentry::Client::with_options(sentry::apply_defaults(options)));
        assert!(
            client.options().server_name.is_some(),
            "the contexts integration should still supply a hostname for the scrubber to remove"
        );
        let hub = sentry::Hub::new(Some(client.clone()), Arc::new(Default::default()));

        hub.capture_message(
            "could not open /Users/jane/Library/Application Support/so.drifty.mac",
            sentry::Level::Warning,
        );
        client.flush(Some(Duration::from_secs(2)));

        let envelopes = envelopes.lock().unwrap();
        let event = envelopes
            .iter()
            .find_map(|envelope| envelope.event())
            .expect("captured event");
        assert_eq!(event.server_name, None);
        assert_eq!(
            event.message.as_deref(),
            Some("could not open /Users/[user]/Library/Application Support/so.drifty.mac")
        );
    }

    #[test]
    fn redact_user_home_hides_the_account_segment_on_both_platforms() {
        assert_eq!(
            redact_user_home("/Users/jane/Library/Application Support/so.drifty.mac"),
            "/Users/[user]/Library/Application Support/so.drifty.mac"
        );
        assert_eq!(
            redact_user_home(r"C:\Users\pQ7xYz\Downloads\drifty.exe"),
            r"C:\Users\[user]\Downloads\drifty.exe"
        );
        assert_eq!(
            redact_user_home(r"\\?\C:\USERS\Morgan\AppData\Local\drifty"),
            r"\\?\C:\USERS\[user]\AppData\Local\drifty"
        );
        assert_eq!(
            redact_user_home("C:/Users/rileyk/Downloads/drifty/drifty.exe"),
            "C:/Users/[user]/Downloads/drifty/drifty.exe"
        );
        assert_eq!(
            redact_user_home("moved /Users/a/x to /Users/b/y"),
            "moved /Users/[user]/x to /Users/[user]/y"
        );
    }

    #[test]
    fn redact_user_home_leaves_paths_without_a_profile_segment() {
        for path in [
            "/Applications/Drifty.app/Contents/MacOS/drifty",
            "/opt/superusers/bin",
            "/Users",
            "/Users/",
            "/Users/[user]/Library",
            "",
        ] {
            assert_eq!(redact_user_home(path), path);
        }
    }

    #[test]
    fn scrub_native_event_drops_hostname_and_profile_paths() {
        let frame = Frame {
            package: Some(r"C:\Users\pQ7xYz\Downloads\drifty.exe".to_string()),
            abs_path: Some("/Users/jane/src/main.rs".to_string()),
            ..Default::default()
        };
        let image: DebugImage = SymbolicDebugImage {
            name: r"C:\Users\pQ7xYz\Downloads\drifty.exe".to_string(),
            arch: None,
            image_addr: 0.into(),
            image_size: 0,
            image_vmaddr: 0.into(),
            id: Default::default(),
            code_id: None,
            debug_file: None,
        }
        .into();
        let event = Event {
            server_name: Some(Cow::Borrowed("Sams-MacBook-Air.local")),
            exception: vec![Exception {
                ty: "panic".to_string(),
                value: Some("could not open /Users/jane/Library/db".to_string()),
                stacktrace: Some(Stacktrace {
                    frames: vec![frame],
                    ..Default::default()
                }),
                ..Default::default()
            }]
            .into(),
            debug_meta: Cow::Owned(DebugMeta {
                images: vec![image],
                ..Default::default()
            }),
            ..Default::default()
        };

        let scrubbed = scrub_native_event(event);

        assert_eq!(scrubbed.server_name, None);
        let exception = &scrubbed.exception.values[0];
        assert_eq!(
            exception.value.as_deref(),
            Some("could not open /Users/[user]/Library/db")
        );
        let frame = &exception.stacktrace.as_ref().unwrap().frames[0];
        assert_eq!(
            frame.package.as_deref(),
            Some(r"C:\Users\[user]\Downloads\drifty.exe")
        );
        assert_eq!(frame.abs_path.as_deref(), Some("/Users/[user]/src/main.rs"));
        let DebugImage::Symbolic(image) = &scrubbed.debug_meta.images[0] else {
            panic!("expected a symbolic debug image");
        };
        assert_eq!(image.name, r"C:\Users\[user]\Downloads\drifty.exe");
    }

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
