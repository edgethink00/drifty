use super::{
    build_browser_history_import_payload, build_period_payload, DeveloperDiagnosticsSettings,
    TrackerController, TrackerError,
};
use drifty_screen_context_core::store::ActivityDeletionEffects;
use serde_json::{json, Value};

#[derive(serde::Deserialize)]
struct ActivityDeletionEnvelope {
    #[serde(flatten)]
    envelope: super::SidecarEnvelope<Value>,
    #[serde(rename = "screenContextDeletionEffects")]
    effects: Option<ActivityDeletionEffects>,
}

fn parse_activity_deletion_envelope(
    raw: &[u8],
) -> Result<(Value, Option<ActivityDeletionEffects>), TrackerError> {
    let result: ActivityDeletionEnvelope = serde_json::from_slice(raw).map_err(|_| {
        TrackerError::CommandFailed("screen_context_activity_deletion_unavailable".into())
    })?;
    if !result.envelope.ok {
        return Err(TrackerError::TrackerReturnedError(
            "screen_context_activity_deletion_unavailable".into(),
        ));
    }
    Ok((
        result.envelope.data.ok_or(TrackerError::MissingData)?,
        result.effects,
    ))
}
use tauri::{AppHandle, Manager};

impl TrackerController {
    fn invoke_activity_deletion(
        &self,
        app: &AppHandle,
        command: &str,
        payload: Value,
    ) -> Result<Value, TrackerError> {
        if let Some(account) = app.try_state::<crate::commands::ScreenContextAccount>() {
            return account.runtime.with_activity_deletion(app, |receipt| {
                if receipt {
                    let raw = self.invoke_raw_with_deletion_effects(app, command, payload, true)?;
                    parse_activity_deletion_envelope(&raw)
                } else {
                    self.invoke::<Value>(app, command, payload)
                        .map(|value| (value, None))
                }
            });
        }
        self.invoke::<Value>(app, command, payload)
    }
    pub fn set_developer_diagnostics(
        &self,
        app: &AppHandle,
        settings: DeveloperDiagnosticsSettings,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "set_developer_diagnostics",
            build_developer_diagnostics_payload(&settings),
        )
    }

    pub fn import_browser_history(
        &self,
        app: &AppHandle,
        lookback_days: Option<u32>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "import_browser_history",
            build_browser_history_import_payload(lookback_days),
        )
    }

    /// Private-window and recording-hours choices; the payload is validated
    /// by the tracker, which falls back to recording everything.
    pub fn set_capture_policy(&self, app: &AppHandle, policy: Value) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "set_capture_policy", policy)
    }

    pub fn set_sync_state(&self, app: &AppHandle, entries: Value) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "set_sync_state", json!({ "entries": entries }))
    }

    pub fn apply_synced_definition(
        &self,
        app: &AppHandle,
        input: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "apply_synced_definition", json!({ "input": input }))
    }

    pub fn apply_synced_segments(
        &self,
        app: &AppHandle,
        segments: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "apply_synced_segments",
            json!({ "segments": segments }),
        )
    }

    pub fn mark_sync_deletions_pushed(
        &self,
        app: &AppHandle,
        deletion_uids: Value,
        scope: Option<String>,
    ) -> Result<Value, TrackerError> {
        let mut payload = json!({ "deletionUids": deletion_uids });
        if let Some(scope) = scope {
            payload["scope"] = json!(scope);
        }
        self.invoke::<Value>(app, "mark_sync_deletions_pushed", payload)
    }

    pub fn apply_synced_deletions(
        &self,
        app: &AppHandle,
        deletions: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke_activity_deletion(
            app,
            "apply_synced_deletions",
            json!({ "deletions": deletions }),
        )
    }

    pub fn purge_remote_segments(&self, app: &AppHandle) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "purge_remote_segments", json!({}))
    }

    pub fn save_classification_rule(
        &self,
        app: &AppHandle,
        input: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "save_classification_rule", json!({ "input": input }))
    }

    pub fn delete_classification_rule(
        &self,
        app: &AppHandle,
        id: String,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "delete_classification_rule", json!({ "id": id }))
    }

    pub fn save_excluded_app(&self, app: &AppHandle, input: Value) -> Result<Value, TrackerError> {
        if let Some(account) = app.try_state::<crate::commands::ScreenContextAccount>() {
            return account.runtime.with_exclusion_mutation(app, || {
                self.invoke::<Value>(app, "save_excluded_app", input)
            });
        }
        self.invoke::<Value>(app, "save_excluded_app", input)
    }

    pub fn delete_excluded_app(&self, app: &AppHandle, id: String) -> Result<Value, TrackerError> {
        if let Some(account) = app.try_state::<crate::commands::ScreenContextAccount>() {
            return account.runtime.with_exclusion_mutation(app, || {
                self.invoke::<Value>(app, "delete_excluded_app", json!({ "id": id }))
            });
        }
        self.invoke::<Value>(app, "delete_excluded_app", json!({ "id": id }))
    }

    pub fn delete_excluded_app_history(
        &self,
        app: &AppHandle,
        name: String,
        bundle_id: Option<String>,
        site_domain: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke_activity_deletion(
            app,
            "delete_excluded_app_history",
            json!({ "name": name, "bundleId": bundle_id, "siteDomain": site_domain }),
        )
    }

    pub fn delete_activity_segments(
        &self,
        app: &AppHandle,
        ids: Vec<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke_activity_deletion(
            app,
            "delete_activity_segments",
            build_delete_activity_segments_payload(&ids),
        )
    }

    // CLIPPY-ALLOW: this mirrors the Python command payload flags one-to-one.
    #[allow(clippy::too_many_arguments)]
    pub fn delete_history_range(
        &self,
        app: &AppHandle,
        start: Option<String>,
        end: Option<String>,
        activity: bool,
        ai_classifications: bool,
        youtube_metadata: bool,
        dry_run: bool,
    ) -> Result<Value, TrackerError> {
        let payload = build_delete_history_range_payload(
            start,
            end,
            activity,
            ai_classifications,
            youtube_metadata,
            dry_run,
        );
        if activity && !dry_run {
            return self.invoke_activity_deletion(app, "delete_history_range", payload);
        }
        self.invoke::<Value>(app, "delete_history_range", payload)
    }

    pub fn apply_classification_rules(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        let mut payload = build_period_payload(day, start, end);
        if let Some(payload_object) = payload.as_object_mut() {
            payload_object.insert("limit".into(), json!(limit));
        }
        self.invoke::<Value>(app, "apply_classification_rules", payload)
    }

    pub fn save_classifications(
        &self,
        app: &AppHandle,
        classifications: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "save_classifications",
            json!({ "classifications": classifications }),
        )
    }

    pub fn save_project(&self, app: &AppHandle, input: Value) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "save_project", json!({ "input": input }))
    }

    pub fn delete_project(&self, app: &AppHandle, id: String) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "delete_project", json!({ "id": id }))
    }

    pub fn save_project_anchors(
        &self,
        app: &AppHandle,
        project_id: String,
        anchors: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "save_project_anchors",
            json!({ "projectId": project_id, "anchors": anchors }),
        )
    }

    pub fn delete_project_anchor(
        &self,
        app: &AppHandle,
        project_id: String,
        kind: String,
        value: String,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "delete_project_anchor",
            json!({ "projectId": project_id, "kind": kind, "value": value }),
        )
    }

    pub fn save_project_assignments(
        &self,
        app: &AppHandle,
        assignments: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "save_project_assignments",
            json!({ "assignments": assignments }),
        )
    }

    pub fn save_project_window_assignments(
        &self,
        app: &AppHandle,
        assignments: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "save_project_window_assignments",
            json!({ "assignments": assignments }),
        )
    }

    pub fn save_activity_timeline_window(
        &self,
        app: &AppHandle,
        window: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "save_activity_timeline_window",
            json!({ "window": window }),
        )
    }

    pub fn save_activity_block_user_label(
        &self,
        app: &AppHandle,
        label: Value,
        previous_block_key: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "save_activity_block_user_label",
            json!({ "label": label, "previousBlockKey": previous_block_key }),
        )
    }

    pub fn delete_activity_block_user_label(
        &self,
        app: &AppHandle,
        block_key: String,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "delete_activity_block_user_label",
            json!({ "blockKey": block_key }),
        )
    }

    pub fn upsert_team_projects(
        &self,
        app: &AppHandle,
        organization_id: String,
        projects: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "upsert_team_projects",
            json!({ "organizationId": organization_id, "projects": projects }),
        )
    }

    pub fn save_team_project_assignments(
        &self,
        app: &AppHandle,
        assignments: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "save_team_project_assignments",
            json!({ "assignments": assignments }),
        )
    }

    pub fn record_project_pass(
        &self,
        app: &AppHandle,
        input: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "record_project_pass", json!({ "input": input }))
    }

    pub fn save_ai_review_events(
        &self,
        app: &AppHandle,
        events: Value,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "save_ai_review_events", json!({ "events": events }))
    }

    pub fn revert_ai_review_event(&self, app: &AppHandle, id: i64) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "revert_ai_review_event", json!({ "id": id }))
    }

    pub fn refresh_non_ai_classifications(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "refresh_non_ai_classifications",
            build_period_payload(day, start, end),
        )
    }
}

fn build_delete_activity_segments_payload(ids: &[String]) -> Value {
    json!({ "ids": ids })
}

fn build_delete_history_range_payload(
    start: Option<String>,
    end: Option<String>,
    activity: bool,
    ai_classifications: bool,
    youtube_metadata: bool,
    dry_run: bool,
) -> Value {
    let mut payload = build_period_payload(None, start, end);

    if let Some(payload_object) = payload.as_object_mut() {
        payload_object.insert(
            "scopes".into(),
            json!({
                "activity": activity,
                "aiClassifications": ai_classifications,
                "youtubeMetadata": youtube_metadata,
            }),
        );
        payload_object.insert("dryRun".into(), json!(dry_run));
    }

    payload
}

fn build_developer_diagnostics_payload(settings: &DeveloperDiagnosticsSettings) -> Value {
    json!(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_deletion_receipt_never_enters_the_public_data_and_legacy_reply_stays_unconfirmed() {
        let raw=br#"{"ok":true,"data":{"deleted":1},"error":null,"id":42,"screenContextDeletionEffects":{"version":1,"recordIds":["1"],"overflow":false}}"#;
        let (data, receipt) = parse_activity_deletion_envelope(raw).unwrap();
        assert_eq!(data, json!({"deleted":1}));
        assert!(receipt.is_some());
        let (data, receipt) =
            parse_activity_deletion_envelope(br#"{"ok":true,"data":{"deleted":1},"error":null}"#)
                .unwrap();
        assert_eq!(data, json!({"deleted":1}));
        assert!(receipt.is_none());
    }

    #[test]
    fn private_deletion_errors_and_malformed_receipts_never_echo_contents() {
        for raw in [
            br#"{"ok":false,"data":null,"error":"owned private diagnostic"}"#.as_slice(),
            br#"{"ok":true,"data":{"deleted":1},"screenContextDeletionEffects":{"version":1,"recordIds":["01"],"overflow":false}}"#.as_slice(),
            br#"{"ok":true,"data":{"deleted":1},"screenContextDeletionEffects":{"version":1,"recordIds":[],"overflow":false,"owned private diagnostic":true}}"#.as_slice(),
        ] {
            let error=parse_activity_deletion_envelope(raw).err().unwrap().to_string();
            assert!(!error.contains("owned"));
            assert!(!error.contains("01"));
        }
    }

    #[test]
    fn delete_activity_segments_payload_preserves_selected_ids() {
        let payload = build_delete_activity_segments_payload(&["42".into(), "43".into()]);

        assert_eq!(payload, json!({ "ids": ["42", "43"] }));
    }

    #[test]
    fn delete_history_range_payload_preserves_range_scopes_and_dry_run() {
        let payload = build_delete_history_range_payload(
            Some("2026-04-01".into()),
            Some("2026-04-06".into()),
            true,
            false,
            true,
            true,
        );

        assert_eq!(
            payload,
            json!({
                "start": "2026-04-01",
                "end": "2026-04-06",
                "scopes": {
                    "activity": true,
                    "aiClassifications": false,
                    "youtubeMetadata": true,
                },
                "dryRun": true,
            })
        );
    }

    #[test]
    fn delete_history_range_payload_omits_missing_bounds_for_all_time() {
        let payload = build_delete_history_range_payload(None, None, true, true, true, false);

        assert_eq!(
            payload,
            json!({
                "scopes": {
                    "activity": true,
                    "aiClassifications": true,
                    "youtubeMetadata": true,
                },
                "dryRun": false,
            })
        );
    }

    #[test]
    fn developer_diagnostics_payload_preserves_browser_history_fallback_flag() {
        let payload = build_developer_diagnostics_payload(&DeveloperDiagnosticsSettings {
            force_chromium_ax_capture: true,
            force_frontmost_fallback_capture: false,
            force_browser_history_url_fallback: true,
            browser_content_context_enabled: true,
            enhanced_context_enabled: true,
            enhanced_context_capture_local: false,
            enhanced_context_source_families: vec![
                "document_knowledge".to_owned(),
                "calendar_meeting".to_owned(),
            ],
        });

        assert_eq!(
            payload,
            json!({
                "forceChromiumAxCapture": true,
                "forceFrontmostFallbackCapture": false,
                "forceBrowserHistoryUrlFallback": true,
                "browserContentContextEnabled": true,
                "enhancedContextEnabled": true,
                "enhancedContextCaptureLocal": false,
                "enhancedContextSourceFamilies": ["document_knowledge", "calendar_meeting"],
            })
        );
    }
}
