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
