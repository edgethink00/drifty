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
fn objc_exception_stacktrace(
    exception: Option<&objc2::exception::Exception>,
) -> Option<sentry::protocol::Stacktrace> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    use objc2_foundation::{NSArray, NSNumber};
    use sentry::protocol::{Addr, Frame, Stacktrace};

    let object: &AnyObject = exception?.as_ref();
    // Read the addresses saved at the original throw, not a Rust backtrace
    // here after AppKit's failing frames have already unwound. Do not collect
    // stack symbols, object descriptions, local variables, or userInfo.
    // A non-NSException object may be thrown, and optional diagnostics must
    // not let a second Objective-C exception escape the existing guard.
    objc2::exception::catch(AssertUnwindSafe(|| {
        let has_stack: bool =
            unsafe { msg_send![object, respondsToSelector: sel!(callStackReturnAddresses)] };
        if !has_stack {
            return None;
        }
        // SAFETY: NSException's documented result is an array of NSNumbers.
        let addresses: Option<Retained<NSArray<NSNumber>>> =
            unsafe { msg_send![object, callStackReturnAddresses] };
        let frames = addresses?
            .iter()
            .take(64)
            .map(|address| Frame {
                instruction_addr: Some(Addr(address.unsignedLongLongValue())),
                ..Default::default()
            })
            .collect();
        // Foundation returns newest first; Sentry expects oldest first.
        Stacktrace::from_frames_reversed(frames)
    }))
    .ok()
    .flatten()
}

#[cfg(target_os = "macos")]
fn objc_exception_event(
    label: &'static str,
    exception: Option<&objc2::exception::Exception>,
) -> sentry::protocol::Event<'static> {
    use sentry::protocol::{Event, Exception, Mechanism};

    let (name, reason) = describe_objc_exception(exception);
    let message = match &reason {
        Some(reason) => format!("Objective-C exception contained in {label}: {name}: {reason}"),
        None => format!("Objective-C exception contained in {label}: {name}"),
    };
    Event {
        message: Some(message),
        level: sentry::Level::Error,
        fingerprint: vec![
            "objc-exception-contained".into(),
            label.into(),
            name.clone().into(),
        ]
        .into(),
        tags: [
            ("objc_exception.name".into(), name.clone()),
            ("objc_exception.site".into(), label.into()),
        ]
        .into_iter()
        .collect(),
        exception: vec![Exception {
            ty: name,
            value: reason,
            stacktrace: objc_exception_stacktrace(exception),
            mechanism: Some(Mechanism {
                ty: "objc_exception".into(),
                handled: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        }]
        .into(),
        ..Default::default()
    }
}

#[cfg(target_os = "macos")]
fn report_objc_exception(label: &'static str, exception: Option<&objc2::exception::Exception>) {
    let event = objc_exception_event(label, exception);
    eprintln!(
        "[panic-guard] {}",
        event.message.as_deref().unwrap_or_default()
    );
    sentry::capture_event(event);
}

#[cfg(test)]
mod tests {
    use super::{contain_panic, contained};
    use std::sync::mpsc::channel;

    #[test]
    fn a_panicking_task_is_contained_and_later_work_still_runs() {
        assert_eq!(
            contain_panic("test", || -> u8 { panic!("overlay bug") }),
            None
        );
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

        let object: &AnyObject = caught.as_ref().unwrap().as_ref();
        let addresses: Retained<NSArray<objc2_foundation::NSNumber>> =
            unsafe { msg_send![object, callStackReturnAddresses] };
        let expected: Vec<_> = addresses
            .iter()
            .take(64)
            .map(|address| sentry::protocol::Addr(address.unsignedLongLongValue()))
            .collect();
        assert!(
            !expected.is_empty(),
            "AppKit must retain its original throw stack"
        );
        let event = super::objc_exception_event("test", caught.as_deref());
        let exception = &event.exception.values[0];
        let frames = &exception.stacktrace.as_ref().unwrap().frames;
        assert_eq!(
            frames
                .iter()
                .map(|frame| frame.instruction_addr.unwrap())
                .collect::<Vec<_>>(),
            expected.into_iter().rev().collect::<Vec<_>>()
        );
        assert!(frames.iter().all(|frame| frame.vars.is_empty()
            && frame.function.is_none()
            && frame.abs_path.is_none()));
        assert_eq!(exception.mechanism.as_ref().unwrap().handled, Some(true));
        assert_eq!(
            event.fingerprint.as_ref(),
            ["objc-exception-contained", "test", "NSRangeException"]
        );
        assert_eq!(event.level, sentry::Level::Error);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn absent_objc_throw_stack_keeps_the_existing_message_and_group() {
        let event = super::objc_exception_event("test", None);
        assert_eq!(
            event.message.as_deref(),
            Some("Objective-C exception contained in test: nil")
        );
        assert_eq!(
            event.fingerprint.as_ref(),
            ["objc-exception-contained", "test", "nil"]
        );
        assert!(event.exception.values[0].stacktrace.is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn contained_objc_exception_sends_original_frames_with_debug_images_offline() {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        use objc2_foundation::{NSArray, NSObject};
        use std::sync::{Arc, Mutex};

        struct CapturingTransport(Arc<Mutex<Vec<sentry::Envelope>>>);
        impl sentry::Transport for CapturingTransport {
            fn send_envelope(&self, envelope: sentry::Envelope) {
                self.0.lock().unwrap().push(envelope);
            }
        }
        let envelopes = Arc::new(Mutex::new(Vec::new()));
        let sink = envelopes.clone();
        let options = sentry::ClientOptions {
            dsn: "https://public@example.invalid/1".parse().ok(),
            transport: Some(Arc::new(move |_: &sentry::ClientOptions| {
                Arc::new(CapturingTransport(sink.clone())) as Arc<dyn sentry::Transport>
            })),
            ..Default::default()
        };
        let client = Arc::new(sentry::Client::with_options(sentry::apply_defaults(
            options,
        )));
        let hub = sentry::Hub::new(Some(client), Arc::new(Default::default()));
        sentry::Hub::run(Arc::new(hub), || {
            let empty = NSArray::<NSObject>::new();
            assert_eq!(
                contain_panic("test-native-stack", || {
                    let _: *mut AnyObject = unsafe { msg_send![&*empty, objectAtIndex: 5usize] };
                }),
                None
            );
            assert_eq!(contain_panic("test-native-stack", || 7), Some(7));
        });
        let envelopes = envelopes.lock().unwrap();
        let events: Vec<_> = envelopes
            .iter()
            .filter_map(|envelope| envelope.event())
            .collect();
        assert_eq!(events.len(), 1);
        let event = events[0];
        assert!(!event.debug_meta.images.is_empty());
        assert!(!event.exception.values[0]
            .stacktrace
            .as_ref()
            .unwrap()
            .frames
            .is_empty());
        assert_eq!(
            event.tags.get("objc_exception.site").map(String::as_str),
            Some("test-native-stack")
        );
        assert_eq!(
            event.exception.values[0]
                .mechanism
                .as_ref()
                .unwrap()
                .handled,
            Some(true)
        );
    }
}
