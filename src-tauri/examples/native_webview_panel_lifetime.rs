//! Manual Tauri/Wry/AppKit integration regression for a disposable macOS guest.
//! Creates hidden about:blank WebViews using the production ownership bridge.
//! No tracker, account, network request, pointer injection or presentation claim.

#[cfg(target_os = "macos")]
#[path = "../src/commands/macos_panel.rs"]
mod macos_panel;

#[cfg(target_os = "macos")]
unsafe extern "C" fn log_objc_exception(
    exception: *mut objc2::runtime::AnyObject,
) -> *mut objc2::runtime::AnyObject {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use std::ffi::{c_char, CStr};
    let name: *mut AnyObject = msg_send![exception, name];
    let reason: *mut AnyObject = msg_send![exception, reason];
    for (field, string) in [("name", name), ("reason", reason)] {
        if !string.is_null() {
            let text: *const c_char = msg_send![string, UTF8String];
            if !text.is_null() {
                eprintln!(
                    "OBJECTIVE-C EXCEPTION {field}: {}",
                    CStr::from_ptr(text).to_string_lossy()
                );
            }
        }
    }
    exception
}

#[cfg(target_os = "macos")]
fn main() {
    use objc2::rc::{autoreleasepool, Weak};
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSWindow;
    use std::cell::RefCell;
    use std::collections::HashSet;
    use std::rc::Rc;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
    use tauri_nspanel::{ManagerExt, WebviewPanelManager};

    const CYCLES: usize = 8;
    let registry_drop = std::env::args().any(|argument| argument == "--registry-drop");
    let window_control = std::env::args().any(|argument| argument == "--window-control");
    let app_exit = std::env::args().any(|argument| argument == "--app-exit");
    MainThreadMarker::new().expect("Tauri/AppKit requires the process main thread");
    #[link(name = "objc")]
    extern "C" {
        fn objc_setExceptionPreprocessor(
            function: unsafe extern "C" fn(
                *mut objc2::runtime::AnyObject,
            ) -> *mut objc2::runtime::AnyObject,
        ) -> *mut std::ffi::c_void;
    }
    // Diagnostic only: preserve and rethrow the original exception. The probe
    // contains blank WebViews, so names/reasons carry no user activity data.
    unsafe {
        objc_setExceptionPreprocessor(log_objc_exception);
    }
    let (finished_tx, finished_rx) = mpsc::channel();
    let watchdog = std::thread::spawn(move || {
        if finished_rx.recv_timeout(Duration::from_secs(30)).is_err() {
            eprintln!("FAIL: native WebView lifecycle exceeded 30 seconds");
            std::process::exit(74);
        }
    });
    let weak_windows = Rc::new(RefCell::new(Vec::<Weak<NSWindow>>::new()));
    let weak_webviews = Rc::new(RefCell::new(Vec::<Weak<AnyObject>>::new()));
    let destroyed = Rc::new(RefCell::new(HashSet::<String>::new()));
    let original_classes = Rc::new(RefCell::new(Vec::<usize>::new()));
    let exit_observed = Rc::new(RefCell::new(false));
    let observed_windows = weak_windows.clone();
    let observed_webviews = weak_webviews.clone();
    let observed_destroyed = destroyed.clone();
    let observed_classes = original_classes.clone();
    let observed_exit = exit_observed.clone();
    let exit_code = autoreleasepool(|_| {
        eprintln!("STEP: initialize isolated native runtime");
        let mut context = tauri::generate_context!();
        context.config_mut().identifier = "so.drifty.qa.webview-panel-lifetime".into();
        context.config_mut().product_name = Some("Drifty Panel Lifetime Probe".into());
        context.config_mut().app.windows.clear();
        let app = tauri::Builder::default()
            .plugin(tauri_nspanel::init())
            .build(context)
            .expect("build isolated native probe");
        eprintln!("STEP: native runtime built");

        app.run_return(move |app, event| match event {
            RunEvent::Ready => {
                eprintln!("STEP: native runtime Ready");
                let (windows, weak, webviews) = autoreleasepool(|_| {
                    let mut windows = Vec::new();
                    let mut panels = Vec::new();
                    let mut weak = Vec::new();
                    let mut webviews = Vec::new();
                    for cycle in 0..CYCLES {
                        let label = format!("panel-lifetime-{cycle}");
                        eprintln!("STEP: create WebView {cycle}");
                        let window = WebviewWindowBuilder::new(
                            app,
                            label,
                            WebviewUrl::External("about:blank".parse().unwrap()),
                        )
                        .visible(false)
                        .focused(false)
                        .decorations(false)
                        .inner_size(240.0, 120.0)
                        .build()
                        .expect("create actual Tauri WebView window");
                        let original = window.ns_window().expect("original native window");
                        // Observe actual isa, including a KVO subclass, rather
                        // than the overridable Objective-C `class` message.
                        observed_classes.borrow_mut().push(unsafe {
                            (&*original.cast::<tauri_nspanel::objc::runtime::Object>()).class()
                                as *const _ as usize
                        });
                        if !window_control {
                            let panel = macos_panel::to_panel(&window)
                                .expect("production panel conversion");
                            eprintln!("STEP: production bridge converted WebView {cycle}");
                            panel.set_released_when_closed(false);
                            panels.push(panel);
                        }
                        let pointer = window.ns_window().expect("converted native window");
                        // SAFETY: this is the live, main-thread-owned NSWindow returned
                        // by Tauri. Weak observes lifetime without acquiring another +1.
                        weak.push(Weak::new(unsafe { &*pointer.cast::<NSWindow>() }));
                        let (sender, receiver) = mpsc::channel();
                        window
                            .with_webview(move |native| {
                                sender.send(native.inner() as usize).unwrap();
                            })
                            .expect("observe actual WKWebView");
                        let pointer = receiver
                            .recv_timeout(Duration::from_secs(3))
                            .expect("native WKWebView pointer on the main thread");
                        // SAFETY: the actual WebView remains owned by the live
                        // Tauri window; creating Weak does not acquire another +1.
                        webviews.push(Weak::new(unsafe { &*(pointer as *const AnyObject) }));
                        windows.push(window);
                    }
                    // Exercise registry-before-native-owner teardown without removing
                    // managed state or keeping any borrowed State references alive.
                    if registry_drop {
                        let registry = {
                            let manager = app.state::<WebviewPanelManager>();
                            let mut store = manager.0.lock().unwrap();
                            std::mem::take(&mut *store)
                        };
                        drop(registry);
                    }
                    drop(panels);
                    (windows, weak, webviews)
                });
                // Check after the pool drains: autoreleased ns_window results must
                // not temporarily conceal a missing independent owner reference.
                assert!(
                    weak.iter().all(|window| window.load().is_some()),
                    "dropping every panel reference must preserve Tauri's native windows"
                );
                eprintln!("STEP: registry-drop={registry_drop}; pool drained; native owners live");
                *observed_windows.borrow_mut() = weak;
                *observed_webviews.borrow_mut() = webviews;
                if app_exit {
                    // Leave every WebView open. The plugin's Exit hook must
                    // restore their original classes before runtime cleanup.
                    app.exit(0);
                    return;
                }
                for window in windows {
                    window
                        .destroy()
                        .expect("destroy actual Tauri WebView window");
                }
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } if label.starts_with("panel-lifetime-") => {
                eprintln!("STEP: Destroyed {label}");
                observed_destroyed.borrow_mut().insert(label);
                if observed_destroyed.borrow().len() == CYCLES {
                    app.exit(0);
                }
            }
            RunEvent::ExitRequested {
                code: None, api, ..
            } => api.prevent_exit(),
            RunEvent::Exit => {
                *observed_exit.borrow_mut() = true;
                if app_exit {
                    // Plugin events precede this callback. Every native class
                    // must already be restored, even with open WebViews.
                    for (cycle, weak) in observed_windows.borrow().iter().enumerate() {
                        let window = weak.load().expect("native window at Exit");
                        let actual = unsafe {
                            (&*((&*window as *const NSWindow)
                                .cast::<tauri_nspanel::objc::runtime::Object>()))
                                .class() as *const _ as usize
                        };
                        assert_eq!(actual, observed_classes.borrow()[cycle]);
                        assert!(app
                            .get_webview_panel(&format!("panel-lifetime-{cycle}"))
                            .is_err());
                    }
                    eprintln!("STEP: Exit restored all original runtime classes; registry empty");
                }
            }
            _ => {}
        })
    });
    eprintln!("STEP: native runtime returned {exit_code}");
    let _ = finished_tx.send(());
    watchdog.join().expect("native lifecycle watchdog");
    assert_eq!(exit_code, 0, "the native runtime must exit normally");
    assert!(*exit_observed.borrow(), "the native runtime must emit Exit");
    if !app_exit {
        assert_eq!(destroyed.borrow().len(), CYCLES);
    }
    autoreleasepool(|_| {
        let remaining = weak_windows
            .borrow()
            .iter()
            .filter(|window| window.load().is_some())
            .count();
        eprintln!("STEP: window-control={window_control}; native weak references still live: {remaining}/{CYCLES}");
        // Tao's native windows also remain live in the unconverted control;
        // report that boundary rather than equating runtime exit with final
        // NSWindow deallocation. The bounded regression requires real WebView
        // teardown and its observer cleanup to complete without an exception.
        let remaining_webviews = weak_webviews
            .borrow()
            .iter()
            .filter(|webview| webview.load().is_some())
            .count();
        eprintln!("STEP: WKWebView weak references still live: {remaining_webviews}/{CYCLES}");
        // run_return with open windows also retains WebViews in the unconverted
        // control. That mode verifies Exit restoration, not their deallocation.
        if !app_exit {
            assert_eq!(
                remaining_webviews, 0,
                "all destroyed WKWebViews must deallocate"
            );
        }
    });
    println!(
        "native WebView panel lifetime: {CYCLES} windows; registry-drop={registry_drop}; app-exit={app_exit}; \
         window-control={window_control}; native owners survived; mode-specific lifecycle assertions passed"
    );
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("native_webview_panel_lifetime requires a macOS GUI login session");
    std::process::exit(2);
}
