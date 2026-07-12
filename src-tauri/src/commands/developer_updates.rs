use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};
use url::Url;

const PRE_RELEASE_UPDATER_ENDPOINT: &str = "https://github.com/edgethink00/drifty_releases/releases/download/pre-release-channel/latest-prerelease.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperPreReleaseUpdate {
    available: bool,
    current_version: String,
    version: Option<String>,
    date: Option<String>,
    body: Option<String>,
}

#[tauri::command]
pub async fn developer_check_pre_release_update(
    app: AppHandle,
) -> Result<DeveloperPreReleaseUpdate, String> {
    let updater = build_pre_release_updater(&app)?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    Ok(pre_release_update_response(&app, update))
}

#[tauri::command]
pub async fn developer_install_pre_release_update(app: AppHandle) -> Result<bool, String> {
    let updater = build_pre_release_updater(&app)?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(false);
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    Ok(true)
}

fn build_pre_release_updater(app: &AppHandle) -> Result<Updater, String> {
    let endpoint = PRE_RELEASE_UPDATER_ENDPOINT
        .parse::<Url>()
        .map_err(|error| format!("Invalid pre-release updater endpoint: {error}"))?;

    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())
}

fn pre_release_update_response(
    app: &AppHandle,
    update: Option<Update>,
) -> DeveloperPreReleaseUpdate {
    match update {
        Some(update) => DeveloperPreReleaseUpdate {
            available: true,
            current_version: update.current_version,
            version: Some(update.version),
            date: update.date.map(|date| date.to_string()),
            body: update.body,
        },
        None => DeveloperPreReleaseUpdate {
            available: false,
            current_version: app.package_info().version.to_string(),
            version: None,
            date: None,
            body: None,
        },
    }
}
