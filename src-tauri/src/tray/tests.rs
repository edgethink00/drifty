use super::*;

#[test]
fn app_version_label_formats_drifty_version() {
    assert_eq!(app_version_label("1.2.3"), "Drifty 1.2.3");
}

#[test]
fn update_status_label_prompts_manual_update_checks() {
    assert_eq!(update_status_label(), "Check for Updates...");
}

#[test]
fn tracking_action_label_starts_when_stopped_or_unknown() {
    assert_eq!(tracking_action_label(Some(false)), "Start Tracking");
    assert_eq!(tracking_action_label(None), "Start Tracking");
}

#[test]
fn tracking_action_label_pauses_when_running() {
    assert_eq!(tracking_action_label(Some(true)), "Pause Tracking");
}

#[test]
fn tray_icon_render_key_matches_for_unchanged_input() {
    assert_eq!(
        TrayIconRenderKey::new(0.5, 0.25, 0.25, true, TrayIconStyle::Compact),
        TrayIconRenderKey::new(0.5, 0.25, 0.25, true, TrayIconStyle::Compact),
    );
}

#[test]
fn tray_icon_render_key_changes_when_any_render_input_changes() {
    let base = TrayIconRenderKey::new(0.5, 0.25, 0.25, true, TrayIconStyle::Compact);

    assert_ne!(base, TrayIconRenderKey::new(0.6, 0.25, 0.25, true, TrayIconStyle::Compact));
    assert_ne!(base, TrayIconRenderKey::new(0.5, 0.3, 0.25, true, TrayIconStyle::Compact));
    assert_ne!(base, TrayIconRenderKey::new(0.5, 0.25, 0.3, true, TrayIconStyle::Compact));
    assert_ne!(base, TrayIconRenderKey::new(0.5, 0.25, 0.25, false, TrayIconStyle::Compact));
    assert_ne!(base, TrayIconRenderKey::new(0.5, 0.25, 0.25, true, TrayIconStyle::Expanded));
}
