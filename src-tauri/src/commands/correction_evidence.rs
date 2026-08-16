use tauri::{AppHandle, Manager};

use crate::correction_evidence_store::append_correction_evidence;

#[tauri::command]
pub async fn correction_evidence_append(
    app: AppHandle,
    scope: String,
    record_json: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        append_correction_evidence(&app_data_dir, &scope, &record_json)
    })
    .await
    .map_err(|error| error.to_string())?
}
