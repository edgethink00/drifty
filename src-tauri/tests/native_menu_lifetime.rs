//! Actual AppKit/muda lifetime regression, on the process main thread.
//! No windows, tracking, account access, popup, or foreground activation.
//! Run: cargo test --test native_menu_lifetime

#[cfg(target_os = "macos")]
#[path = "../src/tray/menu.rs"]
mod menu;

#[cfg(target_os = "macos")]
fn main() {
    use menu::{run_menu_update, MenuRow, TrayMenu};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSMenuItem};
    use std::sync::mpsc;

    let mtm = MainThreadMarker::new().expect("native test must run on the main thread");
    let ns_app = NSApplication::sharedApplication(mtm);
    ns_app.setActivationPolicy(NSApplicationActivationPolicy::Prohibited);
    // Install before Tauri's mock event proxy, which would swallow events.
    let (events_tx, events_rx) = mpsc::channel();
    muda::MenuEvent::set_event_handler(Some(move |event: muda::MenuEvent| {
        events_tx.send(event.id.0).unwrap();
    }));
    let app = tauri::test::mock_app();
    let failed = tauri::async_runtime::block_on(run_menu_update(app.handle().clone(), |_| {
        Err(tauri::Error::FailedToReceiveMessage)
    }));
    assert!(failed.is_err(), "native failures must reach the IPC caller");
    tauri::async_runtime::block_on(run_menu_update(app.handle().clone(), |_| {
        assert!(MainThreadMarker::new().is_some());
        Ok(())
    }))
    .expect("a failed update must not leave a claim that blocks later updates");
    let rows = |show_pause: bool, korean: bool, revision: usize| {
        vec![
            MenuRow::item(
                "pause",
                if korean { "일시 정지" } else { "Pause" },
                show_pause,
                show_pause,
            ),
            MenuRow::item(
                "resume",
                if korean { "다시 시작" } else { "Resume" },
                !show_pause,
                !show_pause,
            ),
            MenuRow::separator("separator"),
            MenuRow::item("status", format!("Status {revision}"), false, true),
            MenuRow::item("optional", "Summary", false, revision % 3 == 0),
            MenuRow::item(
                "settings",
                if korean { "설정" } else { "Settings" },
                true,
                true,
            ),
        ]
    };
    let mut tray = TrayMenu::new(app.handle(), rows(true, false, 0)).unwrap();
    // Expose this process-local menu to AppKit so the test can retain the real
    // native targets. The process cannot activate or display a menu bar.
    tray.menu.set_as_app_menu().unwrap();
    let native = ns_app.mainMenu().unwrap();
    let original_pause = native.itemAtIndex(0).unwrap();
    let settings = native.itemAtIndex(native.numberOfItems() - 1).unwrap();
    let mut old_targets = vec![(original_pause, "pause")];

    let click = |item: &NSMenuItem, expected: &str| {
        let target = item.target().expect("muda native action target");
        // SAFETY: selector, target and sender all come from this actual native
        // menu item; this is the same sendAction path AppKit uses on a click.
        assert!(unsafe {
            ns_app.sendAction_to_from(item.action().unwrap(), Some(&target), Some(item))
        });
        assert_eq!(events_rx.try_recv().unwrap(), expected);
        assert!(
            events_rx.try_recv().is_err(),
            "one click must emit exactly one event"
        );
    };

    for revision in 1..=1_000 {
        let show_pause = revision % 2 == 0;
        let korean = revision % 4 < 2;
        tray.apply(rows(show_pause, korean, revision)).unwrap();
        assert!(std::ptr::eq(&*native, &*ns_app.mainMenu().unwrap()));
        let expected_count = if revision % 3 == 0 { 5 } else { 4 };
        assert_eq!(native.numberOfItems(), expected_count);
        assert_eq!(
            native.itemAtIndex(2).unwrap().title().to_string(),
            format!("Status {revision}")
        );
        assert!(!native.itemAtIndex(2).unwrap().isEnabled());
        assert!(
            std::ptr::eq(
                &*settings,
                &*native.itemAtIndex(expected_count - 1).unwrap()
            ),
            "status/structure updates must not replace unrelated native items"
        );
        assert_eq!(
            settings.title().to_string(),
            if korean { "설정" } else { "Settings" }
        );
        let target = native.itemAtIndex(0).unwrap();
        let expected_id = if show_pause { "pause" } else { "resume" };
        assert_eq!(
            target.title().to_string(),
            match (show_pause, korean) {
                (true, true) => "일시 정지",
                (true, false) => "Pause",
                (false, true) => "다시 시작",
                (false, false) => "Resume",
            }
        );
        click(&target, expected_id);
        old_targets.push((target, expected_id));
        // An identical refresh must preserve the current native identity too.
        tray.apply(rows(show_pause, korean, revision)).unwrap();
        assert!(std::ptr::eq(
            &*old_targets.last().unwrap().0,
            &*native.itemAtIndex(0).unwrap()
        ));
    }
    // AppKit-held old targets must remain callable indefinitely, including
    // those no longer present in the menu and long past the former 8-item ring.
    for (item, expected_id) in &old_targets {
        click(item, expected_id);
    }
    click(&settings, "settings");
    println!("PASS: 1000 native updates, stable root/static item identity, current labels/states, 1001 retained old targets, exact click IDs");
    // Drop pending native callbacks before releasing the app-owned item pool.
    drop(old_targets);
    drop(settings);
    ns_app.setMainMenu(None);
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("native_menu_lifetime: macOS-only AppKit regression; not run on this platform");
}
