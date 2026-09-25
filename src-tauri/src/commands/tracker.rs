use serde::{Deserialize, Deserializer, Serialize};
use tauri::async_runtime;
use tauri::{AppHandle, Manager, State};

use crate::tracker::{
    apply_tracker_startup_state, apply_tracking_pause_state, degraded_tracker_status,
    tracker_start_error_message, tracker_status_error_message, tracker_stop_error_message,
    AppIdentity, DeveloperDiagnosticsSettings, TrackerController, TrackerStartupState,
    TrackerStatus,
};
use crate::tracking_activation;
use crate::tracking_pause::{self, TrackingPauseState};
use crate::tray;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayQuery {
    pub day: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTailQuery {
    pub start: Option<String>,
    pub end: Option<String>,
    pub after_segment_id: Option<String>,
    pub after_ended_at: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Default)]
enum TimelineSelectorField {
    #[default]
    Missing,
    Null,
    Value(String),
}

impl TimelineSelectorField {
    fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Value(value) => Some(value),
            Self::Missing | Self::Null => None,
        }
    }

    fn into_option(self) -> Option<String> {
        match self {
            Self::Value(value) => Some(value),
            Self::Missing | Self::Null => None,
        }
    }
}

fn deserialize_timeline_selector_field<'de, D>(
    deserializer: D,
) -> Result<TimelineSelectorField, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(match Option::<String>::deserialize(deserializer)? {
        Some(value) => TimelineSelectorField::Value(value),
        None => TimelineSelectorField::Null,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePageQuery {
    #[serde(default, deserialize_with = "deserialize_timeline_selector_field")]
    day: TimelineSelectorField,
    #[serde(default, deserialize_with = "deserialize_timeline_selector_field")]
    start: TimelineSelectorField,
    #[serde(default, deserialize_with = "deserialize_timeline_selector_field")]
    end: TimelineSelectorField,
    pub before_segment_id: Option<String>,
    pub before_ended_at: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineSearchQuery {
    pub query: String,
    #[serde(default, deserialize_with = "deserialize_timeline_selector_field")]
    day: TimelineSelectorField,
    #[serde(default, deserialize_with = "deserialize_timeline_selector_field")]
    start: TimelineSelectorField,
    #[serde(default, deserialize_with = "deserialize_timeline_selector_field")]
    end: TimelineSelectorField,
    pub before_segment_id: Option<String>,
    pub before_ended_at: Option<String>,
    pub limit: Option<u32>,
}

fn validate_timeline_page_selector(
    day: &TimelineSelectorField,
    start: &TimelineSelectorField,
    end: &TimelineSelectorField,
) -> Result<(), String> {
    if matches!(day, TimelineSelectorField::Null)
        || matches!(start, TimelineSelectorField::Null)
        || matches!(end, TimelineSelectorField::Null)
    {
        return Err("timeline page selector fields cannot be null".into());
    }

    match (day.as_deref(), start.as_deref(), end.as_deref()) {
        (Some(day), None, None) if !day.is_empty() => Ok(()),
        (None, Some(start), Some(end)) if !start.is_empty() && !end.is_empty() => Ok(()),
        (Some(_), Some(_), _) | (Some(_), _, Some(_)) => {
            Err("timeline page selector cannot mix day with start or end".into())
        }
        (None, Some(_), None) | (None, None, Some(_)) => {
            Err("timeline page selector requires both start and end".into())
        }
        (None, None, None) => {
            Err("timeline page selector requires day or both start and end".into())
        }
        (Some(_), None, None) => {
            Err("timeline page selector day must be a non-empty string".into())
        }
        (None, Some(_), Some(_)) => {
            Err("timeline page selector start and end must be non-empty strings".into())
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawEventsQuery {
    pub day: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub app_name: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopSitesQuery {
    pub day: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryImportQuery {
    pub lookback_days: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationQuery {
    pub day: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub limit: Option<u32>,
    pub segment_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationSaveQuery {
    pub classifications: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationRuleSaveQuery {
    pub input: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationRuleDeleteQuery {
    pub id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedAppSaveQuery {
    pub id: String,
    pub name: String,
    pub bundle_id: Option<String>,
    #[serde(default = "default_user_source")]
    pub source: String,
    pub tombstone: Option<bool>,
    pub updated_at: Option<String>,
}

fn default_user_source() -> String {
    "user".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedAppDeleteQuery {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedAppHistoryQuery {
    pub name: String,
    pub bundle_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentAppsQuery {
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedAppsQuery {
    pub include_tombstones: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteActivitySegmentsQuery {
    pub ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteHistoryRangeScopes {
    pub activity: bool,
    pub ai_classifications: bool,
    pub youtube_metadata: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteHistoryRangeQuery {
    pub start: Option<String>,
    pub end: Option<String>,
    pub scopes: DeleteHistoryRangeScopes,
    pub dry_run: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationRuleCandidateQuery {
    pub query: String,
    pub target_kind: Option<ClassificationRuleTargetKind>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClassificationRuleTargetKind {
    Site,
    App,
}

impl ClassificationRuleTargetKind {
    const fn as_tracker_payload(&self) -> &'static str {
        match self {
            ClassificationRuleTargetKind::Site => "site",
            ClassificationRuleTargetKind::App => "app",
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReusableAiClassificationsQuery {
    pub input_fingerprints: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIconsQuery {
    pub apps: Vec<AppIdentity>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteIconsQuery {
    pub domains: Vec<String>,
    /// Settle only domains already in the on-disk cache and omit the rest,
    /// without any network fetch. Used to prefetch icons for an unopened view.
    #[serde(default)]
    pub cached_only: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSaveQuery {
    pub input: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeleteQuery {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnchorsSaveQuery {
    pub project_id: String,
    pub anchors: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnchorDeleteQuery {
    pub project_id: String,
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAssignmentsSaveQuery {
    pub assignments: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWindowAssignmentsSaveQuery {
    pub assignments: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamProjectsUpsertQuery {
    pub organization_id: String,
    pub projects: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamProjectAssignmentsSaveQuery {
    pub assignments: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPassRecordQuery {
    pub input: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewEventsSaveQuery {
    pub events: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewEventRevertQuery {
    pub id: i64,
}

#[tauri::command]
pub async fn tracker_get_status(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<TrackerStatus, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        let pause_state = app.state::<TrackingPauseState>();
        let _operation = pause_state.lock_operation();
        let startup_state = app.state::<TrackerStartupState>();
        let tracking_paused = pause_state.snapshot().is_active();
        match controller.get_status(&app) {
            Ok(status) => Ok(apply_tracking_pause_state(
                apply_tracker_startup_state(&startup_state, status),
                tracking_paused,
            )),
            Err(_) => match startup_state.failure_message() {
                Some(message) => Ok(apply_tracking_pause_state(
                    degraded_tracker_status(message),
                    tracking_paused,
                )),
                None if tracking_paused => Ok(apply_tracking_pause_state(
                    degraded_tracker_status(tracker_status_error_message()),
                    true,
                )),
                None => Err(tracker_status_error_message()),
            },
        }
    })
    .await
    .map_err(|_| tracker_status_error_message())?
}

#[tauri::command]
pub async fn tracker_start(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<TrackerStatus, String> {
    let controller = *controller.inner();
    let generation = app.state::<TrackerStartupState>().begin_start_attempt();
    async_runtime::spawn_blocking(move || {
        let pause_state = app.state::<TrackingPauseState>();
        let _operation = pause_state.lock_operation();
        let startup_state = app.state::<TrackerStartupState>();
        // Record activation before starting. If this cannot be persisted, refuse
        // to start so a restart cannot silently resume capturing without a
        // durable record that the user asked for it.
        if let Err(error) = tracking_activation::activate(&app) {
            let activation_error = crate::tracker::TrackerError::TrackerReturnedError(error);
            startup_state.record_start_failure(generation, &activation_error);
            return Err(tracker_start_error_message());
        }
        if let Err(error) = tracking_pause::clear_for_manual_start(&app) {
            let clear_error = crate::tracker::TrackerError::TrackerReturnedError(error);
            startup_state.record_start_failure(generation, &clear_error);
            return Err(tracker_start_error_message());
        }
        match controller.start(&app) {
            Ok(status) if status.running => {
                startup_state.complete_start_success(generation);
                tray::queue_tracking_controls_refresh(&app, Some(status.running));
                Ok(TrackerStatus {
                    tracking_paused: false,
                    ..status
                })
            }
            Ok(status) => {
                let error = crate::tracker::TrackerError::TrackerReturnedError(
                    "tracker did not report running after start".to_string(),
                );
                startup_state.record_start_failure(generation, &error);
                tray::queue_tracking_controls_refresh(&app, Some(status.running));
                Err(tracker_start_error_message())
            }
            Err(error) => {
                startup_state.record_start_failure(generation, &error);
                Err(tracker_start_error_message())
            }
        }
    })
    .await
    .map_err(|_| tracker_start_error_message())?
}

#[tauri::command]
pub async fn tracker_stop(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<TrackerStatus, String> {
    let controller = *controller.inner();
    let generation = app.state::<TrackerStartupState>().begin_stop_attempt();
    async_runtime::spawn_blocking(move || {
        let pause_state = app.state::<TrackingPauseState>();
        let _operation = pause_state.lock_operation();
        let startup_state = app.state::<TrackerStartupState>();
        if let Err(error) = tracking_pause::prepare_indefinite_pause(&app) {
            eprintln!("[tracking-pause] Refusing an unpersisted manual stop: {error}");
            return Err(tracker_stop_error_message());
        }
        match tracking_pause::finish_indefinite_pause_stop(&app, &controller, controller.stop(&app))
        {
            tracking_pause::IndefinitePauseStopOutcome::Paused(status) => {
                startup_state.complete_stop_success(generation);
                tray::queue_tracking_controls_refresh(&app, Some(status.running));
                Ok(TrackerStatus {
                    tracking_paused: true,
                    ..status
                })
            }
            tracking_pause::IndefinitePauseStopOutcome::StillRunning(status) => {
                tray::queue_tracking_controls_refresh(&app, Some(status.running));
                Err(tracker_stop_error_message())
            }
            tracking_pause::IndefinitePauseStopOutcome::Ambiguous(error) => {
                eprintln!(
                    "[tracking-pause] Preserving manual pause after an ambiguous stop: {error}"
                );
                tray::queue_tracking_controls_refresh(&app, Some(false));
                Err(tracker_stop_error_message())
            }
        }
    })
    .await
    .map_err(|_| tracker_stop_error_message())?
}

#[tauri::command]
pub async fn tracker_get_timeline(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DayQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_timeline(&app, query.day, query.start, query.end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_timeline_page(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: TimelinePageQuery,
) -> Result<serde_json::Value, String> {
    validate_timeline_page_selector(&query.day, &query.start, &query.end)?;
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_timeline_page(
                &app,
                query.day.into_option(),
                query.start.into_option(),
                query.end.into_option(),
                query.before_segment_id,
                query.before_ended_at,
                query.limit,
            )
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_search_timeline(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: TimelineSearchQuery,
) -> Result<serde_json::Value, String> {
    validate_timeline_page_selector(&query.day, &query.start, &query.end)?;
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .search_timeline(
                &app,
                query.query,
                query.day.into_option(),
                query.start.into_option(),
                query.end.into_option(),
                query.before_segment_id,
                query.before_ended_at,
                query.limit,
            )
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_dashboard_week_timeline(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DayQuery,
) -> Result<Box<serde_json::value::RawValue>, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_dashboard_week_timeline(&app, query.start, query.end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_project_trend_timeline(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DayQuery,
) -> Result<Box<serde_json::value::RawValue>, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_project_trend_timeline(&app, query.start, query.end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_live_tail(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: LiveTailQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_live_tail(
                &app,
                query.start,
                query.end,
                query.after_segment_id,
                query.after_ended_at,
                query.limit,
            )
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_current_snapshot(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_current_snapshot(&app)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_set_developer_diagnostics(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DeveloperDiagnosticsSettings,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .set_developer_diagnostics(&app, query)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_preview_browser_history_import(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: Option<BrowserHistoryImportQuery>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .preview_browser_history_import(&app, query.and_then(|value| value.lookback_days))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_import_browser_history(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: Option<BrowserHistoryImportQuery>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .import_browser_history(&app, query.and_then(|value| value.lookback_days))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_browser_history_environment(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_browser_history_environment(&app)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_hourly_summary(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DayQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_hourly_summary(&app, query.day, query.start, query.end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_raw_events(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: RawEventsQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_raw_events(
                &app,
                query.day,
                query.start,
                query.end,
                query.app_name,
                query.limit,
            )
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn tracker_get_top_sites(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: TopSitesQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_top_sites(&app, query.day, query.start, query.end, query.limit)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_app_icons(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: AppIconsQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_app_icons(&app, &query.apps)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Resolves site icons through the local cache, so the webview never issues
/// the outbound request itself.
#[tauri::command]
pub async fn tracker_get_site_icons(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: SiteIconsQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_site_icons(&app, &query.domains, query.cached_only)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Clears every cached icon and reports the reclaimed bytes.
#[tauri::command]
pub async fn tracker_clear_icon_caches(app: AppHandle) -> Result<serde_json::Value, String> {
    async_runtime::spawn_blocking(move || {
        let site_bytes = crate::site_icons::clear_site_icon_cache(&app)
            .map_err(|error| error.to_string())?;
        let app_bytes = crate::app_icons::clear_app_icon_cache(&app)
            .map_err(|error| error.to_string())?;
        Ok::<serde_json::Value, String>(serde_json::json!({
            "reclaimedBytes": site_bytes + app_bytes,
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_unclassified_segments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ClassificationQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_unclassified_segments(
                &app,
                query.day,
                query.start,
                query.end,
                query.limit,
                query.segment_ids,
            )
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_reusable_ai_classifications(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ReusableAiClassificationsQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_reusable_ai_classifications(&app, query.input_fingerprints)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_classification_rules(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_classification_rules(&app)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_save_classification_rule(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ClassificationRuleSaveQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .save_classification_rule(&app, query.input)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_delete_classification_rule(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ClassificationRuleDeleteQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .delete_classification_rule(&app, query.id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_excluded_apps(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: Option<ExcludedAppsQuery>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    let include_tombstones = query.and_then(|q| q.include_tombstones).unwrap_or(false);
    async_runtime::spawn_blocking(move || {
        controller
            .get_excluded_apps(&app, include_tombstones)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_save_excluded_app(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ExcludedAppSaveQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .save_excluded_app(&app, serde_json::to_value(&query).map_err(|e| e.to_string())?)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_delete_excluded_app(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ExcludedAppDeleteQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .delete_excluded_app(&app, query.id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_excluded_app_history_count(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ExcludedAppHistoryQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_excluded_app_history_count(&app, query.name, query.bundle_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_delete_excluded_app_history(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ExcludedAppHistoryQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .delete_excluded_app_history(&app, query.name, query.bundle_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_recent_apps(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: Option<RecentAppsQuery>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    let limit = query.and_then(|q| q.limit).unwrap_or(50);
    async_runtime::spawn_blocking(move || {
        controller
            .get_recent_apps(&app, limit)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_delete_activity_segments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DeleteActivitySegmentsQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .delete_activity_segments(&app, query.ids)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_projects(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_projects(&app)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_dev_signals(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    day: Option<String>,
    start: Option<String>,
    end: Option<String>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_dev_signals(&app, day, start, end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_agent_concurrency_peak(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    day: Option<String>,
    start: Option<String>,
    end: Option<String>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_agent_concurrency_peak(&app, day, start, end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_sync_dev_signals(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    backfill_days: Option<u32>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .sync_dev_signals(&app, backfill_days)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_list_ssh_agent_sources(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .list_ssh_agent_sources(&app)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_test_ssh_agent_source(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    host: String,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .test_ssh_agent_source(&app, host)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_collect_ssh_agent_source(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    host: String,
    backfill_days: Option<u32>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .collect_ssh_agent_source(&app, host, backfill_days)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_dev_repos(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_dev_repos(&app)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_save_project(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ProjectSaveQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .save_project(&app, query.input)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_delete_project(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ProjectDeleteQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .delete_project(&app, query.id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_save_project_anchors(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ProjectAnchorsSaveQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .save_project_anchors(&app, query.project_id, query.anchors)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_delete_project_anchor(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ProjectAnchorDeleteQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .delete_project_anchor(&app, query.project_id, query.kind, query.value)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_save_project_assignments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ProjectAssignmentsSaveQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .save_project_assignments(&app, query.assignments)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_project_assignments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DayQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_project_assignments(&app, query.day, query.start, query.end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_save_project_window_assignments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ProjectWindowAssignmentsSaveQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .save_project_window_assignments(&app, query.assignments)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_project_window_assignments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DayQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_project_window_assignments(&app, query.day, query.start, query.end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_team_projects(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_team_projects(&app)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_upsert_team_projects(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: TeamProjectsUpsertQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .upsert_team_projects(&app, query.organization_id, query.projects)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_save_team_project_assignments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: TeamProjectAssignmentsSaveQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .save_team_project_assignments(&app, query.assignments)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_team_project_assignments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DayQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_team_project_assignments(&app, query.day, query.start, query.end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_record_project_pass(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ProjectPassRecordQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .record_project_pass(&app, query.input)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_project_pass_runs(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DayQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_project_pass_runs(&app, query.day, query.start, query.end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_save_ai_review_events(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: AiReviewEventsSaveQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .save_ai_review_events(&app, query.events)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_ai_review_events(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DayQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_ai_review_events(&app, query.day, query.start, query.end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_revert_ai_review_event(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: AiReviewEventRevertQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .revert_ai_review_event(&app, query.id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_delete_history_range(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: DeleteHistoryRangeQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .delete_history_range(
                &app,
                query.start,
                query.end,
                query.scopes.activity,
                query.scopes.ai_classifications,
                query.scopes.youtube_metadata,
                query.dry_run.unwrap_or(false),
            )
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_search_classification_rule_candidates(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ClassificationRuleCandidateQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .search_classification_rule_candidates(
                &app,
                query.query,
                query
                    .target_kind
                    .as_ref()
                    .map(ClassificationRuleTargetKind::as_tracker_payload)
                    .map(str::to_owned),
            )
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_apply_classification_rules(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: Option<ClassificationQuery>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        let query = query.unwrap_or(ClassificationQuery {
            day: None,
            start: None,
            end: None,
            limit: None,
            segment_ids: None,
        });
        controller
            .apply_classification_rules(&app, query.day, query.start, query.end, query.limit)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_save_classifications(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ClassificationSaveQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .save_classifications(&app, query.classifications)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_refresh_non_ai_classifications(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ClassificationQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .refresh_non_ai_classifications(&app, query.day, query.start, query.end)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_classification_metrics(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ClassificationQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_classification_metrics(&app, query.day, query.start, query.end, query.limit)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutboxQuery {
    pub after_seq: i64,
    pub limit: Option<i64>,
    pub hot_grace_seconds: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStateEntriesQuery {
    pub entries: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedSegmentsQuery {
    pub segments: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDeletionLimitQuery {
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDeletionUidsQuery {
    pub deletion_uids: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedDeletionsQuery {
    pub deletions: serde_json::Value,
}

#[tauri::command]
pub async fn tracker_get_sync_outbox(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: SyncOutboxQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_sync_outbox(&app, query.after_seq, query.limit, query.hot_grace_seconds)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_sync_state(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_sync_state(&app)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_set_sync_state(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: SyncStateEntriesQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .set_sync_state(&app, query.entries)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_apply_synced_segments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: SyncedSegmentsQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .apply_synced_segments(&app, query.segments)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_get_pending_sync_deletions(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: SyncDeletionLimitQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_pending_sync_deletions(&app, query.limit)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_mark_sync_deletions_pushed(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: SyncDeletionUidsQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .mark_sync_deletions_pushed(&app, query.deletion_uids)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_apply_synced_deletions(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: SyncedDeletionsQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .apply_synced_deletions(&app, query.deletions)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_purge_remote_segments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .purge_remote_segments(&app)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        validate_timeline_page_selector, TimelinePageQuery, TimelineSearchQuery,
        TimelineSelectorField,
    };
    use serde_json::json;

    fn value(value: &str) -> TimelineSelectorField {
        TimelineSelectorField::Value(value.to_owned())
    }

    fn missing() -> TimelineSelectorField {
        TimelineSelectorField::Missing
    }

    #[test]
    fn timeline_page_selector_accepts_day_or_complete_range() {
        assert!(
            validate_timeline_page_selector(&value("2026-07-12"), &missing(), &missing(),).is_ok()
        );
        assert!(validate_timeline_page_selector(
            &missing(),
            &value("2026-07-12T00:00:00"),
            &value("2026-07-12T23:59:59"),
        )
        .is_ok());
    }

    #[test]
    fn timeline_page_selector_rejects_empty_partial_and_mixed_forms() {
        for selector in [
            (missing(), missing(), missing()),
            (missing(), value("start"), missing()),
            (missing(), missing(), value("end")),
            (value("day"), value("start"), value("end")),
            (value(""), missing(), missing()),
            (missing(), value(""), value("end")),
        ] {
            assert!(
                validate_timeline_page_selector(&selector.0, &selector.1, &selector.2).is_err()
            );
        }
    }

    #[test]
    fn timeline_page_and_search_selectors_reject_explicit_null_fields() {
        let page: TimelinePageQuery = serde_json::from_value(json!({
            "day": null,
            "start": "2026-07-12T00:00:00",
            "end": "2026-07-12T23:59:59"
        }))
        .expect("page query should deserialize before validation");
        assert!(validate_timeline_page_selector(&page.day, &page.start, &page.end).is_err());

        let search: TimelineSearchQuery = serde_json::from_value(json!({
            "query": "focus",
            "day": "2026-07-12",
            "start": null
        }))
        .expect("search query should deserialize before validation");
        assert!(validate_timeline_page_selector(&search.day, &search.start, &search.end).is_err());
    }
}
