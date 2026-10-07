//! Manual AppKit regression: run in a disposable macOS GUI login session.
//! Exercises the actual dependency destructor, without a WebView or tracker.
#[cfg(target_os = "macos")]
fn main() {
    use objc2::rc::{autoreleasepool, Weak};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSPanel};
    use tauri_nspanel::objc_foundation::INSObject;
    use tauri_nspanel::raw_nspanel::RawNSPanel;

    let main_thread = MainThreadMarker::new().expect("AppKit requires the main thread");
    let _app = NSApplication::sharedApplication(main_thread);
    for cycle in 0..32 {
        let weak = autoreleasepool(|_| {
            let panel = RawNSPanel::new();
            panel.set_released_when_closed(false);
            // SAFETY: RawNSPanel is a live Objective-C instance; both bindings
            // use the same runtime object pointer. Weak does not acquire +1.
            let object = unsafe { &*((&*panel as *const RawNSPanel).cast::<NSPanel>()) };
            let weak = Weak::new(object);
            object.close();
            drop(panel);
            weak
        });
        assert!(
            weak.load().is_none(),
            "native panel must deallocate after closing and releasing cycle {cycle}"
        );
    }
    println!("native panel destructor: 32 cycles passed; all weak references cleared");
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("native_panel_lifetime requires a macOS GUI login session");
    std::process::exit(2);
}
