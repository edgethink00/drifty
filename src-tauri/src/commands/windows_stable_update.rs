//! Windows stable updater staging. The JavaScript updater is used to discover
//! candidates, but its install() hook calls Tauri cleanup_before_exit before
//! ShellExecuteW. That leaves no reliable recovery if the installer fails to
//! launch. This native path retains verified bytes until the idle gate and
//! performs our tracker cleanup before launching NSIS. The plugin's Windows
//! install() ignores ShellExecuteW failures and always exits, so that call is
//! intentionally avoided here.

use std::{fs, io::Write, process::Command, sync::Mutex};

use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

struct PreparedStableUpdate {
    version: String,
    bytes: Vec<u8>,
}

#[derive(Default)]
pub struct WindowsStableUpdateState(Mutex<Option<PreparedStableUpdate>>);

#[tauri::command]
pub async fn windows_download_stable_update(
    app: AppHandle,
    state: State<'_, WindowsStableUpdateState>,
    expected_version: String,
) -> Result<(), String> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The Windows stable update is no longer available.".to_string())?;
    if update.version != expected_version {
        return Err(format!(
            "The Windows stable update changed from {expected_version} to {}. Check again.",
            update.version
        ));
    }
    if !super::windows_update_feed::is_stable_installer_url(
        &app,
        update.download_url.as_str(),
        &expected_version,
    )? {
        return Err("The Windows update is not the immutable signed NSIS asset.".to_string());
    }
    // download() verifies the Tauri signature before these bytes are retained.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    if !bytes.starts_with(b"MZ") {
        return Err("The signed Windows update is not an executable installer.".to_string());
    }
    let mut prepared = state
        .0
        .lock()
        .map_err(|_| "Windows updater state is unavailable.")?;
    *prepared = Some(PreparedStableUpdate {
        version: expected_version,
        bytes,
    });
    Ok(())
}

#[tauri::command]
pub fn windows_install_prepared_stable_update(
    app: AppHandle,
    state: State<'_, WindowsStableUpdateState>,
    expected_version: String,
    silent: bool,
) -> Result<(), String> {
    let prepared = {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "Windows updater state is unavailable.")?;
        if guard.as_ref().map(|update| update.version.as_str()) != Some(expected_version.as_str()) {
            return Err("The prepared Windows update is missing or has changed.".to_string());
        }
        guard.take().expect("prepared version checked above")
    };
    let mut installer = tempfile::Builder::new()
        .prefix("drifty-stable-update-")
        .suffix(".exe")
        .tempfile()
        .map_err(|error| error.to_string())?;
    installer
        .write_all(&prepared.bytes)
        .and_then(|_| installer.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    // Keep the executable after this process exits; NSIS opens its own path.
    let installer_path = installer
        .into_temp_path()
        .keep()
        .map_err(|error| error.to_string())?;

    // Stop the tracker before NSIS can replace its files. Unlike the plugin's
    // unconditional exit, a spawn failure is reported so JS can restart this
    // intact WebView and restore normal tracker startup.
    let launch_path = super::windows_update_feed::installer_launch_path(&app, &installer_path)?;
    // The installer relaunches Drifty while this process's WebView2 browser can
    // still be retiring. Capture its PID now, while the webviews are alive, so
    // the relaunch records it and waits for that browser before creating a view.
    let browser_pids = crate::windows_browser_process_ids(&app);
    crate::shutdown_app_for_exit(&app, crate::AppExitKind::Requested);
    let mut command = Command::new(&launch_path);
    command.args(["/S", "/R", "/UPDATE", "/ARGS"]);
    if silent || std::env::args_os().any(|argument| argument.to_string_lossy() == "--background") {
        command.arg("--background");
    }
    match command.spawn() {
        Ok(_) => {
            crate::record_windows_previous_instance(&app, browser_pids);
            std::process::exit(0)
        }
        Err(error) => {
            let _ = fs::remove_file(&installer_path);
            Err(format!(
                "Could not launch the Windows updater installer: {error}"
            ))
        }
    }
}

#[tauri::command]
pub fn windows_clear_prepared_stable_update(
    state: State<'_, WindowsStableUpdateState>,
) -> Result<(), String> {
    let mut prepared = state
        .0
        .lock()
        .map_err(|_| "Windows updater state is unavailable.")?;
    *prepared = None;
    Ok(())
}
