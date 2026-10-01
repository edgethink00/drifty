use objc2::sel;
use objc2_app_kit::NSApplication;
use objc2_foundation::NSObjectProtocol;

/// Activate native dialogs on supported macOS versions without changing the
/// caller's activation-policy or window-focus decisions. `activate` is only
/// available starting with macOS 14; sending it on macOS 13 throws an exception.
pub(crate) fn activate_application(application: &NSApplication) {
    if application.respondsToSelector(sel!(activate)) {
        application.activate();
    } else {
        #[allow(deprecated)]
        application.activateIgnoringOtherApps(true);
    }
}
