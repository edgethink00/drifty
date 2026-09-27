//! Keep a panic or Objective-C exception in optional native UI work from
//! ending the app.
//!
//! On macOS, tao runs every `run_on_main_thread` closure inside a
//! `catch_unwind` that stops the whole application on a panic, and a panic
//! inside an AppKit block callback cannot unwind at all and aborts. An
//! Objective-C exception thrown by AppKit into Rust frames is worse: Rust
//! cannot catch foreign exceptions and aborts the process, which users see as
//! "quit unexpectedly" and which the Rust Sentry SDK never records. Overlay
//! work such as the desktop pet is optional, so a bug there should cost one
//! frame of that overlay, never the user's session. AppKit's own run loop
//! makes the same choice: it reports an uncaught exception and keeps running.
//!
//! A contained panic still reaches Sentry through the panic hook with its
//! original message and stack. A contained Objective-C exception is reported
//! here with its name and reason, because nothing else would record it.

use std::panic::{catch_unwind, AssertUnwindSafe};

/// Runs `work`, returning None instead of propagating a panic or, on macOS,
/// an Objective-C exception.
pub(crate) fn contain_panic<R>(label: &'static str, work: impl FnOnce() -> R) -> Option<R> {
    // The Objective-C handler must sit innermost: an Objective-C exception
    // that reaches a Rust catch_unwind frame aborts with "Rust cannot catch
    // foreign exceptions". A Rust panic passes through it untouched.
    #[cfg(target_os = "macos")]
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        objc2::exception::catch(AssertUnwindSafe(work))
            .map_err(|exception| report_objc_exception(label, exception.as_deref()))
            .ok()
    }));
    #[cfg(not(target_os = "macos"))]
    let outcome = catch_unwind(AssertUnwindSafe(|| Some(work())));

    match outcome {
        Ok(value) => value,
        Err(_) => {
            eprintln!("[panic-guard] contained a panic in {label}");
            None
        }
    }
}

/// Wraps main-thread work so a panic or Objective-C exception inside it is
/// contained.
pub(crate) fn contained(
    label: &'static str,
    work: impl FnOnce() + Send + 'static,
) -> impl FnOnce() + Send + 'static {
    move || {
        let _ = contain_panic(label, work);
    }
}

/// Runs `work` on the main thread inside the guard and waits for its result.
/// Tauri window methods called on the main thread execute immediately, so
/// routing them through here puts their AppKit calls inside the guard instead
/// of tao's event loop, where an exception aborts.
pub(crate) fn run_on_main_contained<R: Send + 'static>(
    app: &tauri::AppHandle,
    label: &'static str,
    work: impl FnOnce() -> Result<R, String> + Send + 'static,
) -> Result<R, String> {
    #[cfg(target_os = "macos")]
    {
        const MAIN_THREAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
        if objc2::MainThreadMarker::new().is_some() {
            return contain_panic(label, work).unwrap_or_else(|| Err(contained_error(label)));
        }
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(contained(label, move || {
            let _ = sender.send(work());
        }))
        .map_err(|error| error.to_string())?;
        match receiver.recv_timeout(MAIN_THREAD_TIMEOUT) {
            Ok(result) => result,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err(contained_error(label)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                Err(format!("{label} did not finish on the main thread"))
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        contain_panic(label, work).unwrap_or_else(|| Err(contained_error(label)))
    }
}

fn contained_error(label: &str) -> String {
    format!("{label} failed and was contained")
}

#[cfg(target_os = "macos")]
fn describe_objc_exception(
    exception: Option<&objc2::exception::Exception>,
) -> (String, Option<String>) {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    use objc2_foundation::NSString;

    let Some(exception) = exception else {
        return ("nil".to_string(), None);
    };
    let object: &AnyObject = exception.as_ref();
    // SAFETY: respondsToSelector: is an NSObject method every exception
    // object in practice implements; name is only read when it is present.
    let has_name: bool = unsafe { msg_send![object, respondsToSelector: sel!(name)] };
    let name = has_name
        .then(|| {
            let name: Option<Retained<NSString>> = unsafe { msg_send![object, name] };
            name.map(|name| name.to_string())
        })
        .flatten()
        .unwrap_or_else(|| object.class().name().to_string_lossy().into_owned());
    // Display yields the NSException reason, or a placeholder without one.
    let reason = exception.to_string();
    let reason = (reason != "unknown exception").then(|| {
        crate::observability::redact_user_home(&reason)
            .chars()
            .take(500)
            .collect()
    });
    (name, reason)
}

#[cfg(target_os = "macos")]
fn report_objc_exception(label: &'static str, exception: Option<&objc2::exception::Exception>) {
    let (name, reason) = describe_objc_exception(exception);
    let message = match &reason {
        Some(reason) => format!("Objective-C exception contained in {label}: {name}: {reason}"),
        None => format!("Objective-C exception contained in {label}: {name}"),
    };
    eprintln!("[panic-guard] {message}");
    sentry::with_scope(
        |scope| {
            scope.set_fingerprint(Some(&["objc-exception-contained", label, name.as_str()]));
            scope.set_tag("objc_exception.name", &name);
            scope.set_tag("objc_exception.site", label);
        },
        || sentry::capture_message(&message, sentry::Level::Error),
    );
}

#[cfg(test)]
mod tests {
    use super::{contain_panic, contained};
    use std::sync::mpsc::channel;

    #[test]
    fn a_panicking_task_is_contained_and_later_work_still_runs() {
        assert_eq!(contain_panic("test", || -> u8 { panic!("overlay bug") }), None);
        assert_eq!(contain_panic("test", || 7), Some(7));

        let (sender, receiver) = channel::<()>();
        contained("test", move || {
            drop(sender);
            panic!("overlay bug after dropping the reply channel");
        })();
        // A caller waiting for the reply sees a closed channel instead of the
        // app stopping.
        assert!(receiver.recv().is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn an_appkit_style_exception_is_contained_and_named() {
        use objc2::msg_send;
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2_foundation::{NSArray, NSObject};

        // Without the guard this NSRangeException would abort the test
        // process: Rust cannot catch foreign exceptions.
        let empty: Retained<NSArray<NSObject>> = NSArray::new();
        let contained = contain_panic("test", || {
            let _: *mut AnyObject = unsafe { msg_send![&*empty, objectAtIndex: 5usize] };
        });
        assert_eq!(contained, None);

        let caught = objc2::exception::catch(std::panic::AssertUnwindSafe(|| {
            let _: *mut AnyObject = unsafe { msg_send![&*empty, objectAtIndex: 5usize] };
        }))
        .expect_err("an out-of-range index throws");
        let (name, reason) = super::describe_objc_exception(caught.as_deref());
        assert_eq!(name, "NSRangeException");
        assert!(reason.is_some_and(|reason| reason.contains("index 5")));
    }
}
