use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayDriftAlarmStatus {
    enabled: bool,
    #[serde(default)]
    status_label: String,
    last_checked_at: Option<String>,
    last_checked_label: String,
    result_label: String,
    #[serde(default)]
    developer_details_enabled: bool,
    #[serde(default)]
    tracker_running: Option<bool>,
}

impl Default for TrayDriftAlarmStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            status_label: "Drift alerts: Off".to_string(),
            last_checked_at: None,
            last_checked_label: "Off".to_string(),
            result_label: "Alerts disabled".to_string(),
            developer_details_enabled: false,
            tracker_running: None,
        }
    }
}

impl TrayDriftAlarmStatus {
    pub(super) fn tracker_running(&self) -> Option<bool> {
        self.tracker_running
    }

    pub(super) fn set_tracker_running(&mut self, running: Option<bool>) {
        self.tracker_running = running;
    }
}

pub fn drift_alerts_status_label(status: &TrayDriftAlarmStatus, ko: bool) -> String {
    if status.enabled && status.tracker_running == Some(false) {
        return if ko { "딴짓 알림: 일시 정지됨" } else { "Drift alerts: Paused" }.to_string();
    }

    let label = status.status_label.trim();
    if !label.is_empty() {
        return label.to_string();
    }

    if status.enabled {
        if ko { "딴짓 알림: 감지 중" } else { "Drift alerts: Monitoring" }.to_string()
    } else {
        if ko { "딴짓 알림: 꺼짐" } else { "Drift alerts: Off" }.to_string()
    }
}

pub fn drift_summary_label(status: &TrayDriftAlarmStatus, ko: bool) -> Option<String> {
    if !status.enabled || !status.developer_details_enabled {
        return None;
    }

    if status.enabled && status.tracker_running == Some(false) {
        return Some(if ko { "최근 확인: 확인 안 함" } else { "Last check: Not checking" }.to_string());
    }

    let label = status.last_checked_label.trim();
    let display_label = if label.is_empty() && status.last_checked_at.is_some() {
        if ko { "기록됨" } else { "Recorded" }
    } else if label.is_empty() {
        if ko { "없음" } else { "Never" }
    } else {
        label
    };
    let result = status.result_label.trim();
    if result.is_empty() {
        Some(if ko {
            format!("최근 확인: {display_label}")
        } else {
            format!("Last check: {display_label}")
        })
    } else {
        Some(if ko {
            format!("최근 확인: {display_label} · {result}")
        } else {
            format!("Last check: {display_label} · {result}")
        })
    }
}

pub fn spanish_drift_alerts_status_label(status: &TrayDriftAlarmStatus) -> String {
    if status.enabled && status.tracker_running == Some(false) {
        return "Alertas de distracción: en pausa".to_string();
    }
    let label = status.status_label.trim();
    if !label.is_empty() {
        return label.to_string();
    }
    if status.enabled {
        "Alertas de distracción: activas".to_string()
    } else {
        "Alertas de distracción: desactivadas".to_string()
    }
}

pub fn spanish_drift_summary_label(status: &TrayDriftAlarmStatus) -> Option<String> {
    if !status.enabled || !status.developer_details_enabled {
        return None;
    }
    if status.tracker_running == Some(false) {
        return Some("Última comprobación: sin comprobar".to_string());
    }
    let label = status.last_checked_label.trim();
    let display = if label.is_empty() && status.last_checked_at.is_some() {
        "Registrado"
    } else if label.is_empty() {
        "Nunca"
    } else {
        label
    };
    let result = status.result_label.trim();
    if result.is_empty() {
        Some(format!("Última comprobación: {display}"))
    } else {
        Some(format!("Última comprobación: {display} · {result}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drift_alerts_status_label_uses_runtime_status_instead_of_generic_on() {
        let status = TrayDriftAlarmStatus {
            enabled: true,
            status_label: "Drift alerts: AI unavailable".to_string(),
            last_checked_at: Some("2026-06-12T00:00:00.000Z".to_string()),
            last_checked_label: "9:00:00 AM".to_string(),
            result_label: "Suppressed: AI unavailable".to_string(),
            developer_details_enabled: false,
            tracker_running: None,
        };

        assert_eq!(
            drift_alerts_status_label(&status, false),
            "Drift alerts: AI unavailable"
        );
    }

    #[test]
    fn drift_alerts_status_label_falls_back_without_runtime_status() {
        let enabled_status = TrayDriftAlarmStatus {
            enabled: true,
            status_label: " ".to_string(),
            last_checked_at: None,
            last_checked_label: "Never".to_string(),
            result_label: "No eligible drift".to_string(),
            developer_details_enabled: false,
            tracker_running: None,
        };
        let disabled_status = TrayDriftAlarmStatus {
            enabled: false,
            status_label: " ".to_string(),
            last_checked_at: None,
            last_checked_label: "Off".to_string(),
            result_label: "Alerts disabled".to_string(),
            developer_details_enabled: false,
            tracker_running: None,
        };

        assert_eq!(
            drift_alerts_status_label(&enabled_status, false),
            "Drift alerts: Monitoring"
        );
        assert_eq!(
            drift_alerts_status_label(&disabled_status, false),
            "Drift alerts: Off"
        );
    }

    #[test]
    fn drift_alerts_status_label_falls_back_when_payload_omits_runtime_status() {
        let status: TrayDriftAlarmStatus = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "lastCheckedAt": null,
            "lastCheckedLabel": "Never",
            "resultLabel": "No eligible drift",
            "detailLabel": null,
        }))
        .expect("legacy drift alarm tray status should deserialize");

        assert_eq!(
            drift_alerts_status_label(&status, false),
            "Drift alerts: Monitoring"
        );
    }

    #[test]
    fn tray_status_deserializes_cached_tracker_running_state() {
        let status: TrayDriftAlarmStatus = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "statusLabel": "Drift alerts: Monitoring",
            "lastCheckedAt": null,
            "lastCheckedLabel": "Never",
            "resultLabel": "No eligible drift",
            "detailLabel": null,
            "trackerRunning": true,
        }))
        .expect("tray status with cached tracker state should deserialize");

        assert_eq!(status.tracker_running(), Some(true));
        assert_eq!(drift_summary_label(&status, false), None);
    }

    #[test]
    fn drift_last_check_label_reports_not_checking_when_tracker_is_paused() {
        let status = TrayDriftAlarmStatus {
            enabled: true,
            status_label: "Drift alerts: Paused".to_string(),
            last_checked_at: Some("2026-06-12T00:00:00.000Z".to_string()),
            last_checked_label: "9:00:00 AM".to_string(),
            result_label: "Tracker paused".to_string(),
            developer_details_enabled: true,
            tracker_running: Some(false),
        };

        assert_eq!(
            drift_summary_label(&status, false).as_deref(),
            Some("Last check: Not checking")
        );
    }

    #[test]
    fn drift_summary_is_hidden_when_alerts_are_off() {
        let status = TrayDriftAlarmStatus {
            enabled: false,
            status_label: "Drift alerts: Off".to_string(),
            last_checked_at: None,
            last_checked_label: "Off".to_string(),
            result_label: "Alerts disabled".to_string(),
            developer_details_enabled: true,
            tracker_running: None,
        };

        assert_eq!(drift_summary_label(&status, false), None);
    }

    #[test]
    fn drift_summary_is_hidden_outside_developer_mode() {
        let status = TrayDriftAlarmStatus {
            enabled: true,
            status_label: "Drift alerts: Monitoring".to_string(),
            last_checked_at: Some("2026-06-12T00:00:00.000Z".to_string()),
            last_checked_label: "9:00:00 AM".to_string(),
            result_label: "No eligible drift".to_string(),
            developer_details_enabled: false,
            tracker_running: Some(true),
        };

        assert_eq!(drift_summary_label(&status, false), None);
    }

    #[test]
    fn drift_summary_combines_last_check_and_result_on_one_line() {
        let status = TrayDriftAlarmStatus {
            enabled: true,
            status_label: "Drift alerts: Suppressed".to_string(),
            last_checked_at: Some("2026-06-12T00:00:00.000Z".to_string()),
            last_checked_label: "9:00:00 AM".to_string(),
            result_label: "Suppressed: AI low confidence".to_string(),
            developer_details_enabled: true,
            tracker_running: None,
        };

        assert_eq!(
            drift_summary_label(&status, false).as_deref(),
            Some("Last check: 9:00:00 AM · Suppressed: AI low confidence")
        );
    }

    #[test]
    fn drift_summary_omits_empty_result_without_leaving_a_separator() {
        let status = TrayDriftAlarmStatus {
            enabled: true,
            status_label: "Drift alerts: Monitoring".to_string(),
            last_checked_at: None,
            last_checked_label: "Never".to_string(),
            result_label: " ".to_string(),
            developer_details_enabled: true,
            tracker_running: None,
        };

        assert_eq!(
            drift_summary_label(&status, false).as_deref(),
            Some("Last check: Never")
        );
    }
}
