use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, LogicalPosition, Manager};

use super::watcher::watcher_peek_hide;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DriftAlarmAction {
    ReturnToFocus {
        #[serde(rename = "targetId")]
        target_id: String,
    },
    StartBreak {
        minutes: i64,
    },
    ManualCorrection,
    Settings,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DriftAlarmActionPayload {
    action: DriftAlarmAction,
}

const EXTREME_NUDGE_TOAST_WIDTH: f64 = 440.0;
const EXTREME_NUDGE_TOAST_HEIGHT: f64 = 212.0;

pub(super) fn extreme_nudge_toast_window_dimensions() -> (f64, f64) {
    (EXTREME_NUDGE_TOAST_WIDTH, EXTREME_NUDGE_TOAST_HEIGHT)
}

pub(super) fn calculate_extreme_nudge_toast_window_position(
    work_area_x: f64,
    work_area_y: f64,
    work_area_width: f64,
) -> LogicalPosition<f64> {
    let available_x = (work_area_width - EXTREME_NUDGE_TOAST_WIDTH).max(0.0);
    let x_margin = super::watcher::WATCHER_PEEK_WORK_AREA_MARGIN.min(available_x);

    LogicalPosition::new(
        work_area_x + available_x - x_margin,
        work_area_y + super::watcher::WATCHER_PEEK_WORK_AREA_MARGIN,
    )
}

pub(super) fn is_extreme_nudge_toast_payload(payload: &Value) -> bool {
    matches!(
        payload.get("kind").and_then(Value::as_str),
        Some("extremeNudgeToast")
    )
}

/// Only the settings action is a navigation request, so only it may pull the
/// main window forward. The card lives in a separate always-on-top surface
/// while the main window is often hidden (closing it hides rather than quits),
/// so emitting the event alone lands the user on a settings screen they cannot
/// see. Break and correction actions stay deliberately silent: they resolve the
/// drift in place and must not steal focus from whatever the user is doing.
fn should_reveal_main_window_for_action(action: &DriftAlarmAction) -> bool {
    matches!(action, DriftAlarmAction::Settings)
}

#[tauri::command]
pub fn watcher_peek_extreme_nudge_action(
    app: AppHandle,
    action: DriftAlarmAction,
) -> Result<(), String> {
    // Reveal before emitting, matching the tray Settings contract in
    // shell_action.rs, so the settings section renders in an already visible
    // window instead of behind it.
    if should_reveal_main_window_for_action(&action) {
        crate::reveal_main_window(&app);
    }

    watcher_peek_hide(app.clone())?;

    if let Some(main) = app.get_webview_window("main") {
        main.emit("drift-alarm-action", DriftAlarmActionPayload { action })
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_extreme_nudge_toast_as_interactive_top_right_overlay() {
        let (width, height) = extreme_nudge_toast_window_dimensions();

        assert_eq!(width, EXTREME_NUDGE_TOAST_WIDTH);
        assert_eq!(height, EXTREME_NUDGE_TOAST_HEIGHT);
    }

    #[test]
    fn positions_extreme_nudge_toast_top_right_in_work_area() {
        let position = calculate_extreme_nudge_toast_window_position(0.0, 25.0, 1440.0);

        assert_eq!(position.x, 968.0);
        assert_eq!(position.y, 57.0);
    }

    #[test]
    fn detects_extreme_nudge_toast_payload_by_kind() {
        let payload = serde_json::json!({"kind": "extremeNudgeToast", "placement": "top-right"});

        assert!(is_extreme_nudge_toast_payload(&payload));
    }

    #[test]
    fn reveals_main_window_only_for_the_settings_action() {
        assert!(should_reveal_main_window_for_action(
            &DriftAlarmAction::Settings
        ));
    }

    /// The drift card resolves these in place. Pulling the main window forward
    /// here would interrupt the work the user just chose to return to.
    #[test]
    fn keeps_resolving_actions_from_stealing_focus() {
        assert!(!should_reveal_main_window_for_action(
            &DriftAlarmAction::ManualCorrection
        ));
        assert!(!should_reveal_main_window_for_action(
            &DriftAlarmAction::StartBreak { minutes: 15 }
        ));
        assert!(!should_reveal_main_window_for_action(
            &DriftAlarmAction::ReturnToFocus {
                target_id: "app:com.microsoft.VSCode".to_string(),
            }
        ));
    }
}
