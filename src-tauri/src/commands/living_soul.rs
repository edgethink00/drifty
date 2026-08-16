use tauri::{AppHandle, Manager};

use crate::living_soul_store::{read_living_soul, write_living_soul};

#[tauri::command]
pub async fn living_soul_read(app: AppHandle, scope: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        read_living_soul(&app_data_dir, &scope)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn living_soul_write(
    app: AppHandle,
    scope: String,
    markdown: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        write_living_soul(&app_data_dir, &scope, &markdown)
    })
    .await
    .map_err(|error| error.to_string())?
}
