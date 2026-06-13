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
    detail_label: Option<String>,
}

impl Default for TrayDriftAlarmStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            status_label: "Drift alerts: Off".to_string(),
            last_checked_at: None,
            last_checked_label: "Off".to_string(),
            result_label: "Alerts disabled".to_string(),
            detail_label: None,
        }
    }
}

pub fn drift_alerts_status_label(status: &TrayDriftAlarmStatus) -> String {
    let label = status.status_label.trim();
    if !label.is_empty() {
        return label.to_string();
    }

    if status.enabled {
        "Drift alerts: Monitoring".to_string()
    } else {
        "Drift alerts: Off".to_string()
    }
}

pub fn drift_last_check_label(status: &TrayDriftAlarmStatus) -> String {
    let label = status.last_checked_label.trim();
    let display_label = if label.is_empty() && status.last_checked_at.is_some() {
        "Recorded"
    } else if label.is_empty() {
        "Never"
    } else {
        label
    };
    format!("Last drift check: {display_label}")
}

pub fn drift_result_label(status: &TrayDriftAlarmStatus) -> String {
    format!("Last result: {}", status.result_label)
}

pub fn drift_detail_label(status: &TrayDriftAlarmStatus) -> Option<String> {
    let detail = status.detail_label.as_ref()?.trim();
    if detail.is_empty() {
        return None;
    }
    Some(format!("Detail: {detail}"))
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
            detail_label: Some("youtube.com - 2m".to_string()),
        };

        assert_eq!(
            drift_alerts_status_label(&status),
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
            detail_label: None,
        };
        let disabled_status = TrayDriftAlarmStatus {
            enabled: false,
            status_label: " ".to_string(),
            last_checked_at: None,
            last_checked_label: "Off".to_string(),
            result_label: "Alerts disabled".to_string(),
            detail_label: None,
        };

        assert_eq!(
            drift_alerts_status_label(&enabled_status),
            "Drift alerts: Monitoring"
        );
        assert_eq!(
            drift_alerts_status_label(&disabled_status),
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
            drift_alerts_status_label(&status),
            "Drift alerts: Monitoring"
        );
    }

    #[test]
    fn drift_detail_label_omits_blank_details() {
        let status = TrayDriftAlarmStatus {
            enabled: true,
            status_label: "Drift alerts: Monitoring".to_string(),
            last_checked_at: Some("2026-06-12T00:00:00.000Z".to_string()),
            last_checked_label: "9:00:00 AM".to_string(),
            result_label: "No eligible drift".to_string(),
            detail_label: Some(" ".to_string()),
        };

        assert_eq!(drift_detail_label(&status), None);
    }

    #[test]
    fn drift_detail_label_formats_candidate_details() {
        let status = TrayDriftAlarmStatus {
            enabled: true,
            status_label: "Drift alerts: Suppressed".to_string(),
            last_checked_at: Some("2026-06-12T00:00:00.000Z".to_string()),
            last_checked_label: "9:00:00 AM".to_string(),
            result_label: "Suppressed: AI low confidence".to_string(),
            detail_label: Some("youtube.com - 2m".to_string()),
        };

        assert_eq!(
            drift_detail_label(&status),
            Some("Detail: youtube.com - 2m".to_string())
        );
    }
}
