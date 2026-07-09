use serde::{Deserialize, Serialize};
use tauri::async_runtime;
use tauri::{AppHandle, State};

use crate::tracker::{AppIdentity, DeveloperDiagnosticsSettings, TrackerController, TrackerStatus};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePageQuery {
    pub start: Option<String>,
    pub end: Option<String>,
    pub before_segment_id: Option<String>,
    pub before_ended_at: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineSearchQuery {
    pub query: String,
    pub start: Option<String>,
    pub end: Option<String>,
    pub before_segment_id: Option<String>,
    pub before_ended_at: Option<String>,
    pub limit: Option<u32>,
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
pub struct ProjectExemplarSaveQuery {
    pub project_id: String,
    pub run_summary: String,
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAssignmentsSaveQuery {
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
        controller
            .get_status(&app)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_start(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<TrackerStatus, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || controller.start(&app).map_err(|error| error.to_string()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tracker_stop(
    app: AppHandle,
    controller: State<'_, TrackerController>,
) -> Result<TrackerStatus, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || controller.stop(&app).map_err(|error| error.to_string()))
        .await
        .map_err(|error| error.to_string())?
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
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_timeline_page(
                &app,
                query.start,
                query.end,
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
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .search_timeline(
                &app,
                query.query,
                query.start,
                query.end,
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
) -> Result<serde_json::Value, String> {
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

#[tauri::command]
pub async fn tracker_get_unclassified_segments(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ClassificationQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .get_unclassified_segments(&app, query.day, query.start, query.end, query.limit)
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
pub async fn tracker_save_project_exemplar(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ProjectExemplarSaveQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .save_project_exemplar(&app, query.project_id, query.run_summary, query.source)
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
