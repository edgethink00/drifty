fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/menu-bar-template.rgba");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    println!("cargo:rerun-if-changed=binaries");
    println!("cargo:rerun-if-env-changed=VITE_DRIFTY_CHANNEL");
    println!("cargo:rerun-if-env-changed=VITE_DRIFTY_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    println!(
        "cargo:rustc-env=DRIFTY_BUILD_COMMIT={}",
        resolve_build_commit()
    );

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "accessibility_get_status",
            "accessibility_request_access",
            "app_menu_set_dev_mode_checked",
            "developer_check_pre_release_update",
            "developer_install_pre_release_update",
            "sentry_capture_native_smoke",
            "update_prompt_show_native",
            "tracker_get_status",
            "tracker_start",
            "tracker_stop",
            "tracker_get_timeline",
            "tracker_search_timeline",
            "tracker_get_current_snapshot",
            "tracker_get_hourly_summary",
            "tracker_get_raw_events",
            "tracker_get_top_sites",
            "tracker_get_app_icons",
            "tracker_get_unclassified_segments",
            "tracker_get_reusable_ai_classifications",
            "tracker_get_classification_rules",
            "tracker_save_classification_rule",
            "tracker_delete_classification_rule",
            "tracker_delete_history_range",
            "tracker_search_classification_rule_candidates",
            "tracker_apply_classification_rules",
            "tracker_save_classifications",
            "tracker_refresh_non_ai_classifications",
            "tracker_get_classification_metrics",
            "tracker_get_team_projects",
            "tracker_upsert_team_projects",
            "tracker_save_team_project_assignments",
            "tracker_get_team_project_assignments",
            "tracker_get_sync_outbox",
            "tracker_get_sync_state",
            "tracker_set_sync_state",
            "tracker_apply_synced_segments",
            "tracker_get_pending_sync_deletions",
            "tracker_mark_sync_deletions_pushed",
            "tracker_apply_synced_deletions",
            "tracker_purge_remote_segments",
            "cloud_sync_http_post",
            "tray_update_productivity_icon",
            "tray_update_drift_alarm_status",
            "auth_take_pending_deep_links",
            "auth_load_saved_session",
            "auth_save_session",
            "auth_clear_saved_session",
            "openrouter_load_api_key",
            "openrouter_save_api_key",
            "openrouter_clear_api_key",
            "cloud_device_identity",
            "cloud_device_install_id",
            "app_reveal_main_window",
            "focus_target_activate_browser_tab",
            "focus_target_browser_tab_exists",
            "focus_target_open_app",
            "startup_get_open_at_login_status",
            "startup_set_open_at_login_enabled",
            "system_open_settings_pane",
            "watcher_peek_show",
            "watcher_peek_hide",
            "watcher_peek_dismiss",
            "watcher_peek_set_interactive",
            "watcher_peek_cursor_inside",
            "watcher_peek_respond",
            "watcher_peek_end_of_day_review_action",
            "watcher_peek_extreme_nudge_action",
            "drift_alarm_current",
            "drift_alarm_show",
            "drift_alarm_hide",
            "drift_alarm_dismiss",
            "drift_alarm_action",
            "extreme_nudge_apply",
        ]),
    ))
    .expect("failed to build tauri app manifest");
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
