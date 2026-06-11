use serde::{Deserialize, Serialize};
use tauri::async_runtime;
use tauri::{AppHandle, State};

use crate::tracker::{AppIdentity, TrackerController, TrackerStatus};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayQuery {
    pub day: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
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
pub struct ClassificationRuleCandidateQuery {
    pub query: String,
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
pub async fn tracker_search_classification_rule_candidates(
    app: AppHandle,
    controller: State<'_, TrackerController>,
    query: ClassificationRuleCandidateQuery,
) -> Result<serde_json::Value, String> {
    let controller = *controller.inner();
    async_runtime::spawn_blocking(move || {
        controller
            .search_classification_rule_candidates(&app, query.query)
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
