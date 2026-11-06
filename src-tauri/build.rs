mod screen_context_build;

fn main() {
    println!("cargo:rerun-if-env-changed=DRIFTY_SCREEN_CONTEXT_MODE");
    println!("cargo:rustc-check-cfg=cfg(drifty_screen_context_excluded)");
    let screen_excluded =
        screen_context_build::excluded(std::env::var_os("DRIFTY_SCREEN_CONTEXT_MODE").as_deref())
            .unwrap_or_else(|error| panic!("{error}"));
    if screen_excluded {
        println!("cargo:rustc-cfg=drifty_screen_context_excluded");
    }
    println!(
        "cargo:rustc-env=DRIFTY_SCREEN_CONTEXT_MODE={}",
        if screen_excluded {
            "excluded"
        } else {
            "included"
        }
    );
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rerun-if-changed=src/windows_material_blur.cpp");
        cc::Build::new()
            .cpp(true)
            .file("src/windows_material_blur.cpp")
            .flag_if_supported("/std:c++20")
            .flag_if_supported("/EHsc")
            .compile("drifty_windows_material_blur");
        for library in [
            "dcomp",
            "d3d11",
            "dxgi",
            "dwmapi",
            "magnification",
            "user32",
            "gdi32",
            "windowsapp",
        ] {
            println!("cargo:rustc-link-lib={library}");
        }
    }
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/menu-bar-template.rgba");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    println!("cargo:rerun-if-changed=binaries");
    println!("cargo:rerun-if-env-changed=VITE_DRIFTY_CHANNEL");
    println!("cargo:rerun-if-env-changed=VITE_SUPABASE_URL");
    println!("cargo:rerun-if-env-changed=VITE_SUPABASE_ANON_KEY");
    println!("cargo:rerun-if-env-changed=VITE_DRIFTY_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    println!("cargo:rerun-if-env-changed=VITE_GOOGLE_CALENDAR_ONBOARDING_ENABLED");
    println!("cargo:rerun-if-env-changed=GOOGLE_CALENDAR_DESKTOP_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GOOGLE_CALENDAR_DESKTOP_CLIENT_SECRET");
    println!(
        "cargo:rustc-env=DRIFTY_BUILD_COMMIT={}",
        resolve_build_commit()
    );

    let commands: &'static [&'static str] = {
        let commands: &'static [&'static str] = &[
            "accessibility_get_status",
            "accessibility_request_access",
            "app_icon_get",
            "app_icon_preview",
            "app_icon_set",
            "dock_visibility_get",
            "dock_visibility_set",
            "app_menu_set_dev_mode_checked",
            "quit_confirmation_set_language",
            "app_restart_after_update",
            "developer_list_releases",
            "developer_install_release",
            "developer_check_pre_release_update",
            "developer_install_pre_release_update",
            "developer_tools_get_status",
            "chat_cli_status",
            "chat_cli_send",
            "chat_cli_cancel",
            "chat_tool_call",
            "chat_read_dropped_file",
            "developer_tools_install_cli",
            "developer_tools_uninstall_cli",
            "developer_tools_install_codex_skill",
            "developer_tools_uninstall_codex_skill",
            "developer_tools_install_skill",
            "developer_tools_uninstall_skill",
            "feedback_diagnostics_get_native",
            "sentry_capture_native_smoke",
            "share_card_save_png",
            "update_policy_fetch",
            "whats_new_changelog_fetch",
            "update_prompt_show_native",
            "update_status_show_native",
            "native_notification_authorization",
            "native_notification_request_authorization",
            "native_notification_send",
            "tracker_get_status",
            "tracker_start",
            "tracker_stop",
            "tracker_get_timeline",
            "tracker_search_timeline",
            "tracker_get_current_snapshot",
            "tracker_set_capture_policy",
            "tracker_get_hourly_summary",
            "tracker_get_raw_events",
            "tracker_get_top_sites",
            "tracker_get_app_icons",
            "tracker_get_site_icons",
            "tracker_clear_icon_caches",
            "tracker_get_unclassified_segments",
            "tracker_get_reusable_ai_classifications",
            "tracker_get_classification_rules",
            "tracker_save_classification_rule",
            "tracker_delete_classification_rule",
            "tracker_get_excluded_apps",
            "tracker_save_excluded_app",
            "tracker_delete_excluded_app",
            "tracker_get_excluded_app_history_count",
            "tracker_delete_excluded_app_history",
            "tracker_get_recent_apps",
            "tracker_delete_history_range",
            "tracker_search_classification_rule_candidates",
            "tracker_preview_classification_rule",
            "tracker_apply_classification_rules",
            "tracker_save_classifications",
            "tracker_refresh_non_ai_classifications",
            "tracker_get_classification_metrics",
            "tracker_get_dev_signals",
            "tracker_get_agent_concurrency_peak",
            "tracker_get_dev_repos",
            "tracker_sync_dev_signals",
            "tracker_list_ssh_agent_sources",
            "tracker_test_ssh_agent_source",
            "tracker_collect_ssh_agent_source",
            "tracker_get_team_projects",
            "tracker_upsert_team_projects",
            "tracker_save_project_window_assignments",
            "tracker_get_project_window_assignments",
            "tracker_get_activity_block_labels",
            "tracker_get_activity_timeline_cards",
            "tracker_save_activity_timeline_window",
            "tracker_save_activity_block_user_label",
            "tracker_delete_activity_block_user_label",
            "tracker_save_team_project_assignments",
            "tracker_get_team_project_assignments",
            "tracker_get_sync_outbox",
            "tracker_get_sync_state",
            "tracker_set_sync_state",
            "tracker_set_team_pause_lock",
            "tracker_apply_synced_definition",
            "tracker_apply_synced_segments",
            "tracker_get_pending_sync_deletions",
            "tracker_mark_sync_deletions_pushed",
            "tracker_apply_synced_deletions",
            "tracker_purge_remote_segments",
            "cloud_sync_http_post",
            "correction_evidence_append",
            "living_soul_read",
            "living_soul_write",
            "tray_update_productivity_icon",
            "tray_update_drift_alarm_status",
            "tray_update_trial_status",
            "auth_take_pending_deep_links",
            "auth_load_saved_session",
            "auth_save_session",
            "auth_clear_saved_session",
            "screen_context_bind_account",
            "screen_context_revoke_account",
            "screen_context_get_status",
            "memory_get_status",
            "memory_configure",
            "memory_purge",
            "memory_forget_source",
            "memory_wiki_pages",
            "memory_wiki_delete",
            "memory_set_cloud_session",
            "chat_memory_session",
            "chat_memory_end",
            "screen_context_managed_ai_recipient",
            "screen_context_ai_get_settings",
            "screen_context_ai_prepare_review",
            "screen_context_ai_cancel_review",
            "screen_context_ai_confirm_review",
            "screen_context_ai_turn_off",
            "screen_context_configure",
            "screen_context_acknowledge_scope",
            "screen_context_list_evidence",
            "screen_context_list_activity_evidence",
            "screen_context_read_evidence",
            "screen_context_sample_now",
            "screen_context_delete_evidence",
            "screen_context_preview_deletion",
            "screen_context_was_configured",
            "screen_context_permission_status",
            "screen_context_request_permission",
            "openrouter_load_api_key",
            "openrouter_save_api_key",
            "openrouter_clear_api_key",
            "analysis_provider_load_api_key",
            "analysis_provider_save_api_key",
            "custom_endpoint_load_api_key",
            "custom_endpoint_save_api_key",
            "custom_endpoint_clear_api_key",
            "cloud_device_identity",
            "cloud_device_install_id",
            "app_reveal_main_window",
            "focus_target_activate_browser_tab",
            "focus_target_browser_tab_exists",
            "focus_target_open_app",
            "google_calendar_capability",
            "google_calendar_authorize",
            "google_calendar_finalize",
            "google_calendar_discard_pending",
            "google_calendar_status",
            "google_calendar_events",
            "google_calendar_disconnect",
            "startup_get_open_at_login_status",
            "startup_set_open_at_login_enabled",
            "startup_get_install_location",
            "system_open_settings_pane",
            "watcher_peek_show",
            "watcher_peek_hide",
            "watcher_peek_dismiss",
            "watcher_peek_set_interactive",
            "watcher_peek_cursor_inside",
            "watcher_peek_respond",
            "watcher_peek_end_of_day_review_action",
            "watcher_peek_end_of_day_review_dropped",
            "watcher_peek_extreme_nudge_action",
            "watcher_companion_set_enabled",
            "watcher_companion_set_state",
            "watcher_companion_update",
            "watcher_companion_dismiss_moment",
            "extreme_nudge_apply",
            "pet_mode_set_enabled",
            "pet_mode_get_startup_state",
            "pet_mode_update",
            "pet_mode_visibility_action",
            "pet_mode_intervene",
            "pet_mode_preview_intervention",
            "pet_mode_preview_action",
            "pet_mode_cancel_motion",
            "pet_mode_set_dance_headroom",
            "pet_mode_move_to_target",
            "pet_mode_align_contact",
            "pet_mode_report_contact",
            "pet_mode_report_pointer",
            "pet_mode_return_home",
            "pet_mode_finish_fullscreen_intervention",
            "pet_mode_complete_fullscreen_close",
            "pet_mode_set_presence",
            "pet_mode_set_interactive",
            "pet_mode_cursor_inside",
            "pet_mode_cursor_sample",
            "pet_mode_stalk_cursor",
            "pet_mode_carry_cursor",
            "pet_mode_input_bounds",
            "pet_mode_roam",
            "pet_mode_exit_screen",
            "pet_mode_return_from_outing",
            "pet_mode_prepare_outing_hunt",
            "pet_mode_reconcile_position",
            "pet_mode_remember_position",
            "pet_mode_probe_ax_seat",
            "pet_quick_controls_set_visible",
            "pet_quick_controls_sync_state",
            "pet_quick_controls_get_state",
            "pet_quick_controls_cursor_inside",
            "pet_quick_controls_action",
        ];
        if screen_excluded {
            Box::leak(
                commands
                    .iter()
                    .copied()
                    .filter(|command| !screen_context_build::is_screen_command(command))
                    .collect::<Vec<_>>()
                    .into_boxed_slice(),
            ) as &'static [&'static str]
        } else {
            commands
        }
    };
    let mut attributes = tauri_build::Attributes::new();
    if screen_excluded {
        // Generate a private build-output copy: never mutate shared capability sources.
        println!("cargo:rerun-if-changed=capabilities");
        let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo OUT_DIR"))
            .join("screen-excluded-capabilities");
        screen_context_build::write_excluded_capabilities(
            std::path::Path::new("capabilities"),
            &output,
        )
        .expect("prepare screen-excluded capabilities");
        let pattern = Box::leak(
            output
                .join("**/*.json")
                .to_string_lossy()
                .into_owned()
                .into_boxed_str(),
        );
        attributes = attributes.capabilities_path_pattern(pattern);
    }
    tauri_build::try_build(
        attributes.app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .unwrap_or_else(|error| panic!("failed to build tauri app manifest: {error:#?}"));
}

fn resolve_build_commit() -> String {
    let resolved_commit = std::env::var("VITE_DRIFTY_BUILD_COMMIT")
        .or_else(|_| std::env::var("GITHUB_SHA"))
        .ok()
        .map(|commit| commit.trim().to_string())
        .filter(|commit| !commit.is_empty())
        .or_else(git_head_commit);

    match resolved_commit {
        Some(commit) => commit,
        None => "unknown".to_string(),
    }
}

fn git_head_commit() -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let commit = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!commit.is_empty()).then_some(commit)
}
