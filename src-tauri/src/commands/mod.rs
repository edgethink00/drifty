mod accessibility;
mod ai;
mod analysis_credentials;
mod app_icon;
mod chat_cli;
mod github_star;
pub(crate) mod chat_memory;
#[cfg(target_os = "macos")]
mod ax_values;
mod cloud_sync;
mod companion_context;
mod companion_panel;
mod correction_evidence;
mod developer_tools;
mod developer_updates;
mod developer_versions;
mod extreme_nudge;
mod feedback_diagnostics;
mod google_calendar;
mod living_soul;
#[cfg(target_os = "macos")]
mod macos_panel;
mod managed_ai;
mod native_update_dialog;
mod native_notifications;
#[cfg(target_os = "windows")]
mod pet_cursor_windows;
mod pet_drop;
mod pet_drop_windows;
mod pet_hit_region;
mod pet_mode;
mod pet_mode_startup;
mod pet_mode_ax_control_veto;
mod pet_panel;
mod pet_render_geometry;
mod pet_surface;
mod pet_quick_controls;
mod permission_guide;
mod sentry_smoke;
#[cfg(not(drifty_screen_context_excluded))]
mod screen_context_account;
#[cfg(not(drifty_screen_context_excluded))]
mod screen_context_runtime;
mod share_card;
mod startup_settings;
mod system_settings;
mod tracker;
mod update_policy;
mod whats_new;
mod windows_update_feed;
#[cfg(target_os = "windows")]
mod windows_stable_update;
mod watcher;
mod watcher_extreme_nudge;
mod window_chrome;
#[cfg(target_os = "windows")]
mod windows_browser_uia;
#[cfg(any(target_os = "windows", test))]
mod windows_browser_uia_operation;
mod windows_overlay;

pub use accessibility::*;
pub use ai::*;
pub use analysis_credentials::*;
pub use app_icon::{app_icon_get, app_icon_preview, app_icon_set};
#[cfg(target_os = "macos")]
pub(crate) use app_icon::apply_saved_app_icon;
pub use chat_cli::*;
pub use github_star::{github_cli_login, github_repository_status, github_star_repository, github_star_status};
pub use cloud_sync::*;
pub use companion_context::*;
pub use correction_evidence::*;
pub use developer_tools::*;
pub use developer_updates::*;
pub use developer_versions::*;
pub use extreme_nudge::*;
pub use feedback_diagnostics::*;
pub use google_calendar::*;
pub use living_soul::*;
pub use managed_ai::*;
pub use native_update_dialog::*;
pub use native_notifications::*;
pub use pet_hit_region::*;
pub use pet_mode::*;
pub use pet_mode_startup::*;
pub use pet_quick_controls::*;
pub use permission_guide::PermissionGuideState;
pub use sentry_smoke::*;
#[cfg(not(drifty_screen_context_excluded))]
pub use screen_context_account::*;
#[cfg(not(drifty_screen_context_excluded))]
pub use screen_context_runtime::*;
pub use share_card::*;
pub use startup_settings::*;
pub use system_settings::*;
pub use tracker::*;
pub use update_policy::*;
pub use whats_new::*;
#[cfg(target_os = "windows")]
pub use windows_stable_update::*;
pub use watcher::*;
pub use watcher_extreme_nudge::*;
pub use window_chrome::*;
#[cfg(target_os = "windows")]
pub(crate) use windows_overlay::stop_windows_pet_dpi_reevaluation;
