//! Actual compiled-context ACL controls for the excluded product build.
use tauri::Manager;

#[path = "../screen_context_build.rs"]
mod screen_context_build;

macro_rules! denied_screen_commands {
    ($($command:ident),+ $(,)?) => {
        $(#[tauri::command]
        fn $command() { panic!("excluded screen command reached a handler"); })+

        #[test]
        fn compiled_capability_denies_all_screen_commands_even_if_a_handler_is_present() {
            // Deliberately register sentinels: denial must come from the actual
            // generated ACL, independently of production handler exclusion.
            let app = tauri::test::mock_builder()
                .invoke_handler(tauri::generate_handler![$($command),+])
                .build(crate::app_context()).unwrap();
            let main = app.get_webview_window("main").unwrap_or_else(|| {
                tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap()
            });
            $(assert!(tauri::test::get_ipc_response(&main, tauri::webview::InvokeRequest {
                cmd: stringify!($command).into(), callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1), url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({})),
                headers: Default::default(), invoke_key: tauri::test::INVOKE_KEY.into(),
            }).is_err(), "{} was permitted", stringify!($command));)+
        }
    }
}

denied_screen_commands!(
    memory_get_status,
    memory_runtime_status,
    memory_runtime_install,
    memory_models_status,
    memory_models_install,
    memory_configure,
    memory_purge,
    memory_forget_source,
    memory_wiki_pages,
    memory_wiki_delete,
    memory_wiki_note,
    memory_export_markdown,
    memory_export_clear,
    memory_export_open,
    memory_set_cloud_session,
    chat_memory_session,
    chat_memory_end,
    screen_context_bind_account,
    screen_context_revoke_account,
    screen_context_get_status,
    screen_context_managed_ai_recipient,
    screen_context_ai_get_settings,
    screen_context_ai_prepare_review,
    screen_context_ai_cancel_review,
    screen_context_ai_confirm_review,
    screen_context_ai_turn_off,
    screen_context_configure,
    screen_context_acknowledge_scope,
    screen_context_list_evidence,
    screen_context_list_activity_evidence,
    screen_context_activity_text,
    screen_context_activity_input,
    screen_context_read_evidence,
    screen_context_sample_now,
    screen_context_delete_evidence,
    screen_context_was_configured,
    screen_context_permission_status,
    screen_context_request_permission,
);

#[test]
fn compiled_capability_keeps_permission_auth_tracker_local_ai_and_pet_commands() {
    let mut context = crate::app_context::<tauri::test::MockRuntime>();
    let authority = context.runtime_authority_mut();
    for command in [
        "system_open_settings_pane",
        "auth_save_session",
        "auth_clear_saved_session",
        "tracker_delete_activity_segments",
        "managed_ai_start",
        "pet_mode_set_enabled",
    ] {
        assert!(
            authority
                .resolve_access(command, "main", "main", &tauri::ipc::Origin::Local)
                .is_some(),
            "ordinary command {command} lost its capability"
        );
    }
}
