//! Direct Intelligence keys live in the OS credential store, never settings JSON.
use tauri::{AppHandle, Manager, Runtime};

fn credential_service(identifier: &str, provider: &str, isolated: bool) -> Result<String, String> {
    if provider != "openai" && provider != "anthropic" {
        return Err("Unsupported Intelligence credential provider.".into());
    }
    let prefix = if isolated { identifier } else { "so.drifty" };
    Ok(format!("{prefix}.intelligence-{provider}-api-key"))
}

#[tauri::command]
pub fn analysis_provider_load_api_key<R: Runtime>(
    app: AppHandle<R>,
    provider: String,
) -> Result<Option<String>, String> {
    let service = credential_service(&app.config().identifier, &provider, cfg!(debug_assertions))?;
    load(&service).map_err(|_| "Unable to read Intelligence credentials.".into())
}

#[tauri::command]
pub fn analysis_provider_save_api_key<R: Runtime>(
    app: AppHandle<R>,
    provider: String,
    value: String,
) -> Result<(), String> {
    let service = credential_service(&app.config().identifier, &provider, cfg!(debug_assertions))?;
    save(&service, value.trim())
        .map_err(|_| "Unable to save Intelligence credentials.".to_owned())?;
    #[cfg(not(drifty_screen_context_excluded))]
    if provider == "anthropic" {
        if let Some(state) = app.try_state::<super::ScreenContextAccount>() {
            state.runtime.memory_credentials_changed();
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn load(service: &str) -> Result<Option<String>, String> {
    use security_framework::passwords::get_generic_password;
    use security_framework_sys::base::errSecItemNotFound;
    match get_generic_password(service, "desktop") {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "decode".into()),
        Err(error) if error.code() == errSecItemNotFound => Ok(None),
        Err(_) => Err("read".into()),
    }
}

#[cfg(target_os = "macos")]
fn save(service: &str, value: &str) -> Result<(), String> {
    use security_framework::passwords::{delete_generic_password, set_generic_password};
    use security_framework_sys::base::errSecItemNotFound;
    if value.is_empty() {
        return match delete_generic_password(service, "desktop") {
            Ok(()) => Ok(()),
            Err(error) if error.code() == errSecItemNotFound => Ok(()),
            Err(_) => Err("clear".into()),
        };
    }
    set_generic_password(service, "desktop", value.as_bytes()).map_err(|_| "write".into())
}

#[cfg(target_os = "windows")]
fn load(service: &str) -> Result<Option<String>, String> {
    use keyring::{Entry, Error};
    let entry = Entry::new(service, "desktop").map_err(|_| "open")?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err("read".into()),
    }
}

#[cfg(target_os = "windows")]
fn save(service: &str, value: &str) -> Result<(), String> {
    use keyring::{Entry, Error};
    let entry = Entry::new(service, "desktop").map_err(|_| "open")?;
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(_) => Err("clear".into()),
        };
    }
    entry.set_password(value).map_err(|_| "write".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn direct_keys_are_separate_and_debug_keys_are_isolated() {
        assert_eq!(
            credential_service("task.app", "anthropic", true).unwrap(),
            "task.app.intelligence-anthropic-api-key"
        );
        assert_eq!(
            credential_service("task.app", "openai", false).unwrap(),
            "so.drifty.intelligence-openai-api-key"
        );
        assert_ne!(
            credential_service("task.app", "openai", true).unwrap(),
            credential_service("task.app", "anthropic", true).unwrap()
        );
        assert!(credential_service("task.app", "custom-endpoint", true).is_err());
    }

    #[test]
    #[ignore = "explicit OS credential-store smoke; creates only unique task-owned entries"]
    fn native_analysis_credentials_round_trip() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let identity = format!("so.drifty.qa.intelligence.{}.{}", std::process::id(), nonce);
        for provider in ["openai", "anthropic"] {
            let service = credential_service(&identity, provider, true).unwrap();
            assert_eq!(load(&service).unwrap(), None);
            let saved = save(&service, "synthetic-qa-key");
            let restored = load(&service);
            let updated = save(&service, "synthetic-qa-key-updated");
            let restored_update = load(&service);
            // Clear before asserting, so a failed assertion preserves no entry.
            let cleared = save(&service, "");
            assert!(saved.is_ok());
            assert_eq!(restored.unwrap().as_deref(), Some("synthetic-qa-key"));
            assert!(updated.is_ok());
            assert_eq!(
                restored_update.unwrap().as_deref(),
                Some("synthetic-qa-key-updated")
            );
            assert!(cleared.is_ok());
            assert_eq!(load(&service).unwrap(), None);
            assert!(save(&service, "").is_ok());
        }
    }

    #[test]
    #[ignore = "explicit native IPC/OS smoke using task-owned credentials and the generated app capabilities"]
    fn native_analysis_credentials_ipc_round_trip() {
        use tauri::Manager;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let identity = format!(
            "so.drifty.qa.intelligence.ipc.{}.{}",
            std::process::id(),
            nonce
        );
        let mut context = crate::app_context();
        context.config_mut().identifier = identity.clone();
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![
                analysis_provider_load_api_key,
                analysis_provider_save_api_key
            ])
            .build(context)
            .unwrap();
        let window = app.get_webview_window("main").unwrap_or_else(|| {
            tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .unwrap()
        });
        let invoke = |command: &str, body: serde_json::Value| {
            tauri::test::get_ipc_response(
                &window,
                tauri::webview::InvokeRequest {
                    cmd: command.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
            )
        };
        for provider in ["openai", "anthropic"] {
            let service = credential_service(&identity, provider, true).unwrap();
            assert_eq!(load(&service).unwrap(), None);
            let saved = invoke(
                "analysis_provider_save_api_key",
                serde_json::json!({ "provider": provider, "value": " synthetic-ipc-key " }),
            );
            let restored = invoke(
                "analysis_provider_load_api_key",
                serde_json::json!({ "provider": provider }),
            );
            let cleared = invoke(
                "analysis_provider_save_api_key",
                serde_json::json!({ "provider": provider, "value": "" }),
            );
            // Always clear the unique service before assertions, even if IPC fails.
            save(&service, "").unwrap();
            assert!(saved.is_ok(), "save command rejected");
            assert_eq!(
                restored
                    .unwrap()
                    .deserialize::<Option<String>>()
                    .unwrap()
                    .as_deref(),
                Some("synthetic-ipc-key")
            );
            assert!(cleared.is_ok(), "clear command rejected");
            assert_eq!(
                invoke(
                    "analysis_provider_load_api_key",
                    serde_json::json!({ "provider": provider })
                )
                .unwrap()
                .deserialize::<Option<String>>()
                .unwrap(),
                None
            );
        }
        let rejected = invoke("analysis_provider_save_api_key", serde_json::json!({ "provider": "custom-endpoint", "value": "synthetic-rejected-value" })).unwrap_err();
        assert!(rejected.as_str().unwrap().contains("Unsupported"));
        assert!(!rejected.to_string().contains("synthetic-rejected-value"));
        let other_window = tauri::WebviewWindowBuilder::new(
            &app,
            "intelligence-qa-no-credential-access",
            Default::default(),
        )
        .build()
        .unwrap();
        assert!(
            tauri::test::get_ipc_response(
                &other_window,
                tauri::webview::InvokeRequest {
                    cmd: "analysis_provider_load_api_key".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::Json(serde_json::json!({ "provider": "openai" })),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                }
            )
            .is_err(),
            "credential commands must be limited to the main window"
        );
    }
}
