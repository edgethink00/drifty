//! Native macOS notifications through UNUserNotificationCenter.
//!
//! tauri-plugin-notification 2.3 posts through the legacy
//! NSUserNotificationCenter and reports "granted" without asking macOS. On
//! macOS 27 the first legacy notification raises the system's permission
//! request instead of showing, and nothing tells the app whether the user
//! allowed it, so a notification could disappear while Drifty counted it as
//! shown. This module reads and requests the real authorization, posts the
//! notification, keeps the banner when Drifty is frontmost, and brings the
//! main window forward when the notification is clicked.
//!
//! UNUserNotificationCenter needs the process to run from an app bundle. In
//! plain `tauri dev` and on Windows every command reports `unavailable` and the
//! renderer keeps the plugin path.
//!
//! macOS also refuses authorization outright to a bundle without a team
//! signature (an ad-hoc signed development build): the request fails with
//! UNErrorCodeNotificationsNotAllowed while the status stays "not
//! determined", and no prompt is shown. Such a process is treated as
//! `unavailable` from then on, so it keeps the plugin path instead of
//! offering a request that can never succeed. A user's own refusal is
//! recorded as "denied" and never reaches that branch.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeNotificationAuthorization {
    /// Authorized, provisional or ephemeral: macOS will deliver.
    Authorized,
    Denied,
    /// The user has not answered the permission request yet.
    NotDetermined,
    /// Not macOS, or not running from an app bundle.
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeNotificationSendOutcome {
    Sent,
    Denied,
    /// The permission request is still unanswered, so nothing was posted.
    NotDetermined,
    Unavailable,
}

/// The current macOS notification permission for Drifty.
#[tauri::command]
pub async fn native_notification_authorization() -> Result<NativeNotificationAuthorization, String> {
    run_blocking(platform::authorization).await
}

/// Asks macOS for permission when it has not been asked yet, and reports the
/// resulting permission. An earlier answer is returned without a prompt.
#[tauri::command]
pub async fn native_notification_request_authorization(
) -> Result<NativeNotificationAuthorization, String> {
    run_blocking(platform::request_authorization).await
}

/// Posts one notification, asking for permission first when macOS has not
/// asked yet. A later request with the same identifier replaces the earlier one.
#[tauri::command]
pub async fn native_notification_send(
    identifier: String,
    title: String,
    body: String,
) -> Result<NativeNotificationSendOutcome, String> {
    run_blocking(move || platform::send(&identifier, &title, &body)).await?
}

/// Lets notifications show while Drifty is frontmost and reveals the main
/// window when one is clicked. Call once during setup.
pub fn install_native_notification_delegate(app: &AppHandle) {
    platform::install_delegate(app);
}

async fn run_blocking<T: Send + 'static>(
    job: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())
}

/// UNAuthorizationStatus values: notDetermined 0, denied 1, authorized 2,
/// provisional 3, ephemeral 4. An unknown future value is treated as unasked.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn authorization_from_status(status: isize) -> NativeNotificationAuthorization {
    match status {
        1 => NativeNotificationAuthorization::Denied,
        2..=4 => NativeNotificationAuthorization::Authorized,
        _ => NativeNotificationAuthorization::NotDetermined,
    }
}

/// What a send reports without posting, or `None` when it may post.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn outcome_before_posting(
    authorization: NativeNotificationAuthorization,
) -> Option<NativeNotificationSendOutcome> {
    match authorization {
        NativeNotificationAuthorization::Authorized => None,
        NativeNotificationAuthorization::Denied => Some(NativeNotificationSendOutcome::Denied),
        NativeNotificationAuthorization::NotDetermined => {
            Some(NativeNotificationSendOutcome::NotDetermined)
        }
        NativeNotificationAuthorization::Unavailable => {
            Some(NativeNotificationSendOutcome::Unavailable)
        }
    }
}

/// UNErrorCodeNotificationsNotAllowed: macOS refused because notifications are off
/// for this app, or because it will not authorize this process at all.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_notifications_not_allowed(domain: &str, code: isize) -> bool {
    domain == "UNErrorDomain" && code == 1
}

/// The authorization a request leaves behind. A refusal without an answer
/// recorded means macOS will never ask for this process.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn authorization_after_request(
    status_after: NativeNotificationAuthorization,
    refused_as_not_allowed: bool,
) -> NativeNotificationAuthorization {
    if refused_as_not_allowed && status_after == NativeNotificationAuthorization::NotDetermined {
        NativeNotificationAuthorization::Unavailable
    } else {
        status_after
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{
        authorization_after_request, authorization_from_status, is_notifications_not_allowed,
        outcome_before_posting, NativeNotificationAuthorization, NativeNotificationSendOutcome,
    };
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread, DefinedClass};
    use objc2_foundation::{NSBundle, NSError, NSObject, NSObjectProtocol, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
        UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
        UNNotificationSettings, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, OnceLock};
    use std::time::Duration;
    use tauri::AppHandle;

    const SETTINGS_TIMEOUT: Duration = Duration::from_secs(5);
    const POST_TIMEOUT: Duration = Duration::from_secs(10);
    /// How long a permission request waits for the user's answer.
    const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

    /// Set once macOS has refused to authorize this process at all.
    static REFUSED_PROCESS: AtomicBool = AtomicBool::new(false);

    /// UNUserNotificationCenter raises an exception outside an app bundle.
    fn available() -> bool {
        static AVAILABLE: OnceLock<bool> = OnceLock::new();
        *AVAILABLE.get_or_init(|| {
            let bundle = NSBundle::mainBundle();
            bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
        })
    }

    fn center() -> Option<Retained<UNUserNotificationCenter>> {
        (available() && !REFUSED_PROCESS.load(Ordering::Relaxed))
            .then(UNUserNotificationCenter::currentNotificationCenter)
    }

    pub(super) fn authorization() -> NativeNotificationAuthorization {
        match center() {
            Some(center) => read_authorization(&center),
            None => NativeNotificationAuthorization::Unavailable,
        }
    }

    fn read_authorization(center: &UNUserNotificationCenter) -> NativeNotificationAuthorization {
        let (sender, receiver) = mpsc::channel();
        let handler = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: macOS passes a valid settings object for the handler's duration.
            let status = unsafe { settings.as_ref() }.authorizationStatus();
            let _ = sender.send(status.0);
        });
        center.getNotificationSettingsWithCompletionHandler(&handler);
        receiver
            .recv_timeout(SETTINGS_TIMEOUT)
            .map(authorization_from_status)
            .unwrap_or(NativeNotificationAuthorization::NotDetermined)
    }

    pub(super) fn request_authorization() -> NativeNotificationAuthorization {
        let Some(center) = center() else {
            return NativeNotificationAuthorization::Unavailable;
        };
        let current = read_authorization(&center);
        if current != NativeNotificationAuthorization::NotDetermined {
            return current;
        }
        let (sender, receiver) = mpsc::channel();
        let handler = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
            // SAFETY: a non-null error is valid for the handler's duration.
            let not_allowed = unsafe { error.as_ref() }
                .is_some_and(|error| is_notifications_not_allowed(&error.domain().to_string(), error.code()));
            let _ = sender.send(not_allowed);
        });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &handler,
        );
        match receiver.recv_timeout(REQUEST_TIMEOUT) {
            Ok(not_allowed) => {
                let after = authorization_after_request(read_authorization(&center), not_allowed);
                if after == NativeNotificationAuthorization::Unavailable {
                    REFUSED_PROCESS.store(true, Ordering::Relaxed);
                }
                after
            }
            Err(_) => NativeNotificationAuthorization::NotDetermined,
        }
    }

    pub(super) fn send(
        identifier: &str,
        title: &str,
        body: &str,
    ) -> Result<NativeNotificationSendOutcome, String> {
        let Some(center) = center() else {
            return Ok(NativeNotificationSendOutcome::Unavailable);
        };
        let authorization = match read_authorization(&center) {
            NativeNotificationAuthorization::NotDetermined => request_authorization(),
            other => other,
        };
        if let Some(outcome) = outcome_before_posting(authorization) {
            return Ok(outcome);
        }

        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(identifier),
            &content,
            None,
        );
        let (sender, receiver) = mpsc::channel();
        let handler = RcBlock::new(move |error: *mut NSError| {
            // SAFETY: a non-null error is valid for the handler's duration.
            let result = match unsafe { error.as_ref() } {
                None => Ok(()),
                Some(error) => Err((
                    error.domain().to_string(),
                    error.code(),
                    error.localizedDescription().to_string(),
                )),
            };
            let _ = sender.send(result);
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&handler));
        match receiver.recv_timeout(POST_TIMEOUT) {
            Ok(Ok(())) => Ok(NativeNotificationSendOutcome::Sent),
            Ok(Err((domain, code, _))) if is_notifications_not_allowed(&domain, code) => {
                Ok(NativeNotificationSendOutcome::Denied)
            }
            Ok(Err((_, _, message))) => Err(message),
            Err(_) => Err("macOS did not confirm the notification".to_string()),
        }
    }

    struct NotificationDelegateIvars {
        app: AppHandle,
    }

    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = AnyThread]
        #[ivars = NotificationDelegateIvars]
        struct DriftyNotificationDelegate;

        unsafe impl NSObjectProtocol for DriftyNotificationDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for DriftyNotificationDelegate {
            /// macOS hides a notification from the frontmost app unless told otherwise.
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion_handler.call((
                    UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List,
                ));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                _response: &UNNotificationResponse,
                completion_handler: &block2::DynBlock<dyn Fn()>,
            ) {
                let app = self.ivars().app.clone();
                let main_thread_app = app.clone();
                // A click brings Drifty forward, including a main window that was closed to the menu bar.
                let _ = app.run_on_main_thread(move || crate::reveal_main_window(&main_thread_app));
                completion_handler.call(());
            }
        }
    );

    pub(super) fn install_delegate(app: &AppHandle) {
        let Some(center) = center() else {
            return;
        };
        let delegate = DriftyNotificationDelegate::alloc()
            .set_ivars(NotificationDelegateIvars { app: app.clone() });
        // SAFETY: NSObject's init initializes this NSObject subclass.
        let delegate: Retained<DriftyNotificationDelegate> =
            unsafe { msg_send![super(delegate), init] };
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        // The center holds its delegate weakly; this one lives as long as the app.
        std::mem::forget(delegate);
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{NativeNotificationAuthorization, NativeNotificationSendOutcome};
    use tauri::AppHandle;

    pub(super) fn authorization() -> NativeNotificationAuthorization {
        NativeNotificationAuthorization::Unavailable
    }

    pub(super) fn request_authorization() -> NativeNotificationAuthorization {
        NativeNotificationAuthorization::Unavailable
    }

    pub(super) fn send(
        _identifier: &str,
        _title: &str,
        _body: &str,
    ) -> Result<NativeNotificationSendOutcome, String> {
        Ok(NativeNotificationSendOutcome::Unavailable)
    }

    pub(super) fn install_delegate(_app: &AppHandle) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_every_macos_authorization_status() {
        assert_eq!(authorization_from_status(0), NativeNotificationAuthorization::NotDetermined);
        assert_eq!(authorization_from_status(1), NativeNotificationAuthorization::Denied);
        for delivering in [2, 3, 4] {
            assert_eq!(
                authorization_from_status(delivering),
                NativeNotificationAuthorization::Authorized
            );
        }
        assert_eq!(authorization_from_status(99), NativeNotificationAuthorization::NotDetermined);
    }

    #[test]
    fn posts_only_when_macos_will_deliver() {
        assert_eq!(outcome_before_posting(NativeNotificationAuthorization::Authorized), None);
        assert_eq!(
            outcome_before_posting(NativeNotificationAuthorization::Denied),
            Some(NativeNotificationSendOutcome::Denied)
        );
        assert_eq!(
            outcome_before_posting(NativeNotificationAuthorization::NotDetermined),
            Some(NativeNotificationSendOutcome::NotDetermined)
        );
        assert_eq!(
            outcome_before_posting(NativeNotificationAuthorization::Unavailable),
            Some(NativeNotificationSendOutcome::Unavailable)
        );
    }

    #[test]
    fn recognizes_only_the_notifications_off_error() {
        assert!(is_notifications_not_allowed("UNErrorDomain", 1));
        assert!(!is_notifications_not_allowed("UNErrorDomain", 2));
        assert!(!is_notifications_not_allowed("NSCocoaErrorDomain", 1));
    }

    #[test]
    fn gives_up_on_a_process_macos_refuses_without_asking() {
        // An unsigned development build: refused, and no answer was ever recorded.
        assert_eq!(
            authorization_after_request(NativeNotificationAuthorization::NotDetermined, true),
            NativeNotificationAuthorization::Unavailable
        );
        // A user who said no is "denied", which keeps the native path and its Settings notice.
        assert_eq!(
            authorization_after_request(NativeNotificationAuthorization::Denied, true),
            NativeNotificationAuthorization::Denied
        );
        // An unanswered prompt without that error stays "not determined" and may be asked again.
        assert_eq!(
            authorization_after_request(NativeNotificationAuthorization::NotDetermined, false),
            NativeNotificationAuthorization::NotDetermined
        );
        assert_eq!(
            authorization_after_request(NativeNotificationAuthorization::Authorized, false),
            NativeNotificationAuthorization::Authorized
        );
    }

    #[test]
    fn reports_values_in_the_renderer_spelling() {
        assert_eq!(
            serde_json::to_string(&NativeNotificationAuthorization::NotDetermined).unwrap(),
            "\"notDetermined\""
        );
        assert_eq!(
            serde_json::to_string(&NativeNotificationSendOutcome::Sent).unwrap(),
            "\"sent\""
        );
    }
}

