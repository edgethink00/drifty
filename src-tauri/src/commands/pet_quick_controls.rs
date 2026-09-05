use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use super::pet_mode::{current_pet_logical_position, PET_MODE_WINDOW_LABEL};
use super::pet_panel::{configure_pet_panel, show_pet_panel_at_position};

pub const PET_QUICK_CONTROLS_WINDOW_LABEL: &str = "pet-quick-controls";
const PET_QUICK_CONTROLS_KO_WIDTH: f64 = 273.0;
const PET_QUICK_CONTROLS_EN_WIDTH: f64 = 300.0;
const PET_QUICK_CONTROLS_HEIGHT: f64 = 36.0;
#[cfg(target_os = "macos")]
const PET_QUICK_CONTROLS_MATERIAL_RADIUS: f64 = PET_QUICK_CONTROLS_HEIGHT / 2.0;
const PET_QUICK_CONTROLS_GAP: f64 = 8.0;
const PET_QUICK_CONTROLS_SCREEN_INSET: f64 = 8.0;
const PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_FAILSAFE_MS: u64 = 5_000;
static PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_HELD: AtomicBool = AtomicBool::new(false);
static PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetQuickControlsState {
    pub automatic_close_enabled: bool,
    pub automatic_close_saved_enabled: bool,
    pub automatic_close_override: Option<PetQuickControlsAutomaticCloseOverride>,
    pub language: String,
    pub theme: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetQuickControlsAutomaticCloseOverride {
    pub enabled: bool,
    pub kind: String,
    pub ends_at_ms: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PetQuickControlsLayout {
    x: f64,
    y: f64,
    placement: &'static str,
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn is_supported_quick_controls_action(action: &str) -> bool {
    matches!(
        action,
        "hideOneHour"
            | "turnOff"
            | "openDashboard"
            | "openSettings"
            | "toggleAutomaticClose"
            | "automaticClosePause15"
            | "automaticClosePause60"
            | "automaticClosePauseToday"
            | "automaticClosePauseForever"
            | "automaticCloseEnable15"
            | "automaticCloseEnable60"
            | "automaticCloseEnableToday"
            | "automaticCloseEnableForever"
            | "automaticCloseRestore"
            | "automaticCloseExtend60"
            | "automaticCloseExtendToday"
            | "menuOpened"
            | "menuClosed"
            | "acknowledgeDismiss"
    )
}

fn is_supported_quick_controls_state(state: &PetQuickControlsState) -> bool {
    let override_supported = state
        .automatic_close_override
        .as_ref()
        .map(|override_state| {
            matches!(
                override_state.kind.as_str(),
                "15" | "60" | "today" | "forever"
            ) && if override_state.kind == "forever" {
                override_state.ends_at_ms.is_none()
            } else {
                override_state
                    .ends_at_ms
                    .is_some_and(|ends_at_ms| ends_at_ms > 0)
            }
        })
        .unwrap_or(true);
    override_supported
        && matches!(state.language.as_str(), "en" | "ko")
        && matches!(state.theme.as_str(), "light" | "dark")
}

fn quick_controls_width(language: &str) -> f64 {
    if language == "en" {
        PET_QUICK_CONTROLS_EN_WIDTH
    } else {
        PET_QUICK_CONTROLS_KO_WIDTH
    }
}

fn layout_pet_quick_controls(
    pet_x: f64,
    pet_y: f64,
    pet_width: f64,
    pet_height: f64,
    work_x: f64,
    work_y: f64,
    work_width: f64,
    work_height: f64,
    controls_width: f64,
) -> PetQuickControlsLayout {
    let centered_x = pet_x + (pet_width - controls_width) / 2.0;
    let min_x = work_x + PET_QUICK_CONTROLS_SCREEN_INSET;
    let max_x = (work_x + work_width - controls_width - PET_QUICK_CONTROLS_SCREEN_INSET).max(min_x);
    let x = clamp(centered_x, min_x, max_x);

    let below_y = pet_y + pet_height + PET_QUICK_CONTROLS_GAP;
    let above_y = pet_y - PET_QUICK_CONTROLS_HEIGHT - PET_QUICK_CONTROLS_GAP;
    let min_y = work_y + PET_QUICK_CONTROLS_SCREEN_INSET;
    let max_y =
        (work_y + work_height - PET_QUICK_CONTROLS_HEIGHT - PET_QUICK_CONTROLS_SCREEN_INSET)
            .max(min_y);
    let fits_below = below_y <= max_y;
    let fits_above = above_y >= min_y;
    let placement = if fits_below || !fits_above {
        "below"
    } else {
        "above"
    };
    let unclamped_y = if placement == "below" {
        below_y
    } else {
        above_y
    };
    PetQuickControlsLayout {
        x,
        y: clamp(unclamped_y, min_y, max_y),
        placement,
    }
}

fn resolve_quick_controls_layout(
    app: &AppHandle,
    pet: &WebviewWindow,
    controls_width: f64,
) -> Result<PetQuickControlsLayout, String> {
    let position = current_pet_logical_position(pet)?;
    let scale_factor = pet.scale_factor().map_err(|error| error.to_string())?;
    let size = pet
        .outer_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale_factor);
    let monitor = pet
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "No monitor is available for Pet Mode quick controls".to_string())?;
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(monitor.scale_factor());
    let work_size = work_area.size.to_logical::<f64>(monitor.scale_factor());
    Ok(layout_pet_quick_controls(
        position.x,
        position.y,
        size.width,
        size.height,
        work_position.x,
        work_position.y,
        work_size.width,
        work_size.height,
        controls_width,
    ))
}

fn hide_pet_quick_controls_window(window: &WebviewWindow) -> Result<(), String> {
    let _ = window.set_ignore_cursor_events(true);
    window.hide().map_err(|error| error.to_string())
}

pub fn set_pet_quick_controls_acknowledgement_held(app: &AppHandle, held: bool) {
    let generation = PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_GENERATION
        .fetch_add(1, Ordering::Relaxed)
        .wrapping_add(1);
    PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_HELD.store(held, Ordering::Relaxed);
    if !held {
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(
            PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_FAILSAFE_MS,
        ));
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            if PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_GENERATION.load(Ordering::Relaxed) != generation
                || !PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_HELD.swap(false, Ordering::Relaxed)
            {
                return;
            }
            if let Some(window) = app_for_main.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) {
                let _ = hide_pet_quick_controls_window(&window);
            }
        });
    });
}

fn pet_quick_controls_acknowledgement_held() -> bool {
    PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_HELD.load(Ordering::Relaxed)
}

#[cfg(target_os = "macos")]
fn apply_pet_quick_controls_material(window: &WebviewWindow) {
    // This panel is exactly the visible pill size. Give only this panel a
    // rounded native material: adding it to `configure_pet_panel` would also
    // put a frosted rectangle behind the transparent cat window.
    let _ = window_vibrancy::clear_vibrancy(window);
    if let Err(error) = window_vibrancy::apply_vibrancy(
        window,
        window_vibrancy::NSVisualEffectMaterial::HudWindow,
        Some(window_vibrancy::NSVisualEffectState::Active),
        Some(PET_QUICK_CONTROLS_MATERIAL_RADIUS),
    ) {
        // Material is cosmetic. The near-opaque CSS surface remains a readable
        // fallback and the resident pet must still be able to start.
        eprintln!("[pet-quick-controls] native material unavailable: {error}");
    }
}

#[cfg(target_os = "macos")]
fn sync_pet_quick_controls_theme(app: &AppHandle, window: &WebviewWindow, dark: bool) {
    use objc2::MainThreadMarker;
    use tauri::Theme;

    let theme = Some(if dark { Theme::Dark } else { Theme::Light });
    if MainThreadMarker::new().is_some() {
        let _ = window.set_theme(theme);
        return;
    }

    let window = window.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let _ = window.set_theme(theme);
    }) {
        // Appearance is cosmetic and the CSS theme remains authoritative for
        // text and tint even if AppKit cannot update this frame.
        eprintln!("[pet-quick-controls] native theme sync unavailable: {error}");
    }
}

pub fn setup_pet_quick_controls_window(app: &tauri::App) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(
        app,
        PET_QUICK_CONTROLS_WINDOW_LABEL,
        WebviewUrl::App("index.html?driftySurface=pet-quick-controls".into()),
    )
    .title("Drifty Pet Controls")
    .inner_size(PET_QUICK_CONTROLS_KO_WIDTH, PET_QUICK_CONTROLS_HEIGHT)
    .min_inner_size(PET_QUICK_CONTROLS_KO_WIDTH, PET_QUICK_CONTROLS_HEIGHT)
    .max_inner_size(PET_QUICK_CONTROLS_EN_WIDTH, PET_QUICK_CONTROLS_HEIGHT)
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .focused(false)
    .focusable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .transparent(true)
    .accept_first_mouse(true)
    .visible(false)
    .build()?;

    configure_pet_panel(&window)?;
    #[cfg(target_os = "macos")]
    apply_pet_quick_controls_material(&window);
    let _ = window.set_ignore_cursor_events(true);
    Ok(())
}

pub fn hide_pet_quick_controls(app: &AppHandle) -> Result<(), String> {
    if pet_quick_controls_acknowledgement_held() {
        return Ok(());
    }
    let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) else {
        return Ok(());
    };
    hide_pet_quick_controls_window(&window)
}

#[tauri::command]
pub fn pet_quick_controls_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) else {
        return Ok(());
    };
    if !visible {
        if pet_quick_controls_acknowledgement_held() {
            return Ok(());
        }
        return hide_pet_quick_controls_window(&window);
    }

    let Some(pet) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return hide_pet_quick_controls_window(&window);
    };
    if !matches!(pet.is_visible(), Ok(true)) {
        return hide_pet_quick_controls_window(&window);
    }

    let controls_width = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|error| error.to_string())?)
        .width;
    let layout = resolve_quick_controls_layout(&app, &pet, controls_width)?;
    window
        .set_size(LogicalSize::new(controls_width, PET_QUICK_CONTROLS_HEIGHT))
        .map_err(|error| error.to_string())?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    let _ = window.emit(
        "pet-quick-controls-layout",
        json!({ "placement": layout.placement }),
    );
    show_pet_panel_at_position(&app, &window, LogicalPosition::new(layout.x, layout.y))
}

#[tauri::command]
pub fn pet_quick_controls_sync_state(
    app: AppHandle,
    state: PetQuickControlsState,
) -> Result<(), String> {
    if !is_supported_quick_controls_state(&state) {
        return Err("unsupported pet quick controls state".to_string());
    }
    let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) else {
        return Ok(());
    };
    #[cfg(target_os = "macos")]
    sync_pet_quick_controls_theme(&app, &window, state.theme == "dark");
    let controls_width = quick_controls_width(&state.language);
    window
        .set_size(LogicalSize::new(controls_width, PET_QUICK_CONTROLS_HEIGHT))
        .map_err(|error| error.to_string())?;
    if matches!(window.is_visible(), Ok(true)) {
        if let Some(pet) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
            if matches!(pet.is_visible(), Ok(true)) {
                let layout = resolve_quick_controls_layout(&app, &pet, controls_width)?;
                window
                    .set_position(LogicalPosition::new(layout.x, layout.y))
                    .map_err(|error| error.to_string())?;
                let _ = window.emit(
                    "pet-quick-controls-layout",
                    json!({ "placement": layout.placement }),
                );
            }
        }
    }
    window
        .emit("pet-quick-controls-state", state)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pet_quick_controls_cursor_inside(app: AppHandle) -> bool {
    let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) else {
        return false;
    };
    if !matches!(window.is_visible(), Ok(true)) {
        return false;
    }

    #[cfg(target_os = "macos")]
    {
        return macos_cursor_inside_window(&app, &window).unwrap_or(false);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let Ok(position) = window.outer_position() else {
            return false;
        };
        let Ok(size) = window.outer_size() else {
            return false;
        };
        let Ok(cursor) = app.cursor_position() else {
            return false;
        };
        point_inside_rect(
            cursor.x,
            cursor.y,
            position.x as f64,
            position.y as f64,
            size.width as f64,
            size.height as f64,
        )
    }
}

fn point_inside_rect(
    point_x: f64,
    point_y: f64,
    rect_x: f64,
    rect_y: f64,
    rect_width: f64,
    rect_height: f64,
) -> bool {
    point_x >= rect_x
        && point_y >= rect_y
        && point_x <= rect_x + rect_width
        && point_y <= rect_y + rect_height
}

#[cfg(target_os = "macos")]
fn macos_cursor_inside_window(app: &AppHandle, window: &WebviewWindow) -> Result<bool, String> {
    use objc2::MainThreadMarker;

    if MainThreadMarker::new().is_some() {
        return macos_cursor_inside_window_on_main_thread(window);
    }

    let window_for_main = window.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(macos_cursor_inside_window_on_main_thread(&window_for_main));
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(std::time::Duration::from_millis(250))
        .map_err(|_| "Pet quick-controls cursor sampling timed out".to_string())?
}

#[cfg(target_os = "macos")]
fn macos_cursor_inside_window_on_main_thread(window: &WebviewWindow) -> Result<bool, String> {
    use objc2_app_kit::{NSEvent, NSWindow};

    let ptr = window.ns_window().map_err(|error| error.to_string())?;
    // SAFETY: Tauri retains this NSWindow and the caller guarantees AppKit's
    // main thread. NSWindow.frame and NSEvent.mouseLocation share Cocoa's
    // global point space, including negative and mixed-scale displays.
    let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
    let frame = ns_window.frame();
    let cursor = NSEvent::mouseLocation();
    Ok(point_inside_rect(
        cursor.x,
        cursor.y,
        frame.origin.x,
        frame.origin.y,
        frame.size.width,
        frame.size.height,
    ))
}

#[tauri::command]
pub fn pet_quick_controls_action(app: AppHandle, action: String) -> Result<(), String> {
    if !is_supported_quick_controls_action(&action) {
        return Err(format!("unknown pet quick controls action: {action}"));
    }

    if action == "menuOpened" || action == "menuClosed" {
        if let Some(pet) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
            pet.emit(
                "pet-quick-controls-menu-state",
                json!({ "open": action == "menuOpened" }),
            )
            .map_err(|error| error.to_string())?;
        }
        return Ok(());
    }

    if action == "hideOneHour" || action == "turnOff" {
        hide_pet_quick_controls(&app)?;
    }

    if action == "acknowledgeDismiss" {
        set_pet_quick_controls_acknowledgement_held(&app, false);
        hide_pet_quick_controls(&app)?;
        if let Some(pet) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
            pet.emit("pet-quick-controls-action", json!({ "action": action }))
                .map_err(|error| error.to_string())?;
        }
        return Ok(());
    }

    if let Some(main) = app.get_webview_window("main") {
        main.emit("pet-quick-controls-action", json!({ "action": action }))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        is_supported_quick_controls_action, is_supported_quick_controls_state,
        layout_pet_quick_controls, point_inside_rect, PetQuickControlsAutomaticCloseOverride,
        PetQuickControlsState, PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_FAILSAFE_MS,
        PET_QUICK_CONTROLS_EN_WIDTH, PET_QUICK_CONTROLS_KO_WIDTH, PET_QUICK_CONTROLS_SCREEN_INSET,
    };
    use serde_json::json;

    #[test]
    fn serializes_quick_controls_state_for_the_webview_contract() {
        let state = PetQuickControlsState {
            automatic_close_enabled: true,
            automatic_close_saved_enabled: true,
            automatic_close_override: Some(PetQuickControlsAutomaticCloseOverride {
                enabled: false,
                kind: "15".to_string(),
                ends_at_ms: Some(1_800_000),
            }),
            language: "ko".to_string(),
            theme: "dark".to_string(),
        };

        assert_eq!(
            serde_json::to_value(state).expect("quick-controls state should serialize"),
            json!({
                "automaticCloseEnabled": true,
                "automaticCloseSavedEnabled": true,
                "automaticCloseOverride": {
                    "enabled": false,
                    "kind": "15",
                    "endsAtMs": 1_800_000,
                },
                "language": "ko",
                "theme": "dark",
            })
        );
    }

    #[test]
    fn accepts_only_supported_quick_controls_state_values() {
        let supported = PetQuickControlsState {
            automatic_close_enabled: false,
            automatic_close_saved_enabled: false,
            automatic_close_override: None,
            language: "en".to_string(),
            theme: "light".to_string(),
        };
        let unsupported_language = PetQuickControlsState {
            language: "ja".to_string(),
            ..supported.clone()
        };
        let unsupported_theme = PetQuickControlsState {
            theme: "sepia".to_string(),
            ..supported.clone()
        };
        let unsupported_timed_override = PetQuickControlsState {
            automatic_close_override: Some(PetQuickControlsAutomaticCloseOverride {
                enabled: false,
                kind: "15".to_string(),
                ends_at_ms: None,
            }),
            ..supported.clone()
        };
        let unsupported_forever_override = PetQuickControlsState {
            automatic_close_override: Some(PetQuickControlsAutomaticCloseOverride {
                enabled: false,
                kind: "forever".to_string(),
                ends_at_ms: Some(1_800_000),
            }),
            ..supported.clone()
        };

        assert!(is_supported_quick_controls_state(&supported));
        assert!(!is_supported_quick_controls_state(&unsupported_language));
        assert!(!is_supported_quick_controls_state(&unsupported_theme));
        assert!(!is_supported_quick_controls_state(
            &unsupported_timed_override
        ));
        assert!(!is_supported_quick_controls_state(
            &unsupported_forever_override
        ));
    }

    #[test]
    fn detects_cursor_inside_negative_origin_panel_bounds() {
        assert!(point_inside_rect(
            -960.0, 631.0, -1076.0, 613.0, 232.0, 36.0
        ));
        assert!(!point_inside_rect(
            -1080.0, 631.0, -1076.0, 613.0, 232.0, 36.0
        ));
        assert!(!point_inside_rect(
            -960.0, 650.0, -1076.0, 613.0, 232.0, 36.0
        ));
    }

    #[test]
    fn accepts_menu_hold_actions_without_opening_the_main_action_route() {
        assert!(is_supported_quick_controls_action("menuOpened"));
        assert!(is_supported_quick_controls_action("menuClosed"));
        assert!(is_supported_quick_controls_action("automaticClosePause15"));
        assert!(is_supported_quick_controls_action("automaticCloseRestore"));
        assert!(is_supported_quick_controls_action("acknowledgeDismiss"));
        assert!(!is_supported_quick_controls_action("menuMaybe"));
    }

    #[test]
    fn bounds_the_acknowledgement_hold_with_a_native_failsafe() {
        assert_eq!(PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_FAILSAFE_MS, 5_000);
    }

    #[test]
    fn places_the_bar_below_a_top_resident_cat() {
        let layout = layout_pet_quick_controls(
            1200.0,
            14.0,
            144.0,
            99.0,
            0.0,
            0.0,
            1440.0,
            900.0,
            PET_QUICK_CONTROLS_KO_WIDTH,
        );
        assert_eq!(layout.placement, "below");
        assert!((layout.y - 121.0).abs() < f64::EPSILON);
        assert!(layout.x + PET_QUICK_CONTROLS_KO_WIDTH <= 1440.0 - 8.0);
    }

    #[test]
    fn flips_above_when_the_cat_sits_near_the_bottom_edge() {
        let layout = layout_pet_quick_controls(
            200.0,
            860.0,
            144.0,
            99.0,
            0.0,
            0.0,
            1440.0,
            900.0,
            PET_QUICK_CONTROLS_KO_WIDTH,
        );
        assert_eq!(layout.placement, "above");
        assert!((layout.y - (860.0 - 36.0 - 8.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn clamps_the_widest_bar_inside_a_narrow_negative_origin_work_area() {
        let left = layout_pet_quick_controls(
            -638.0,
            160.0,
            144.0,
            99.0,
            -640.0,
            0.0,
            640.0,
            480.0,
            PET_QUICK_CONTROLS_EN_WIDTH,
        );
        let right = layout_pet_quick_controls(
            -100.0,
            160.0,
            144.0,
            99.0,
            -640.0,
            0.0,
            640.0,
            480.0,
            PET_QUICK_CONTROLS_EN_WIDTH,
        );

        assert!((left.x - (-632.0)).abs() < f64::EPSILON);
        assert!((right.x - (-308.0)).abs() < f64::EPSILON);
        for layout in [left, right] {
            assert!(layout.x >= -640.0 + PET_QUICK_CONTROLS_SCREEN_INSET);
            assert!(
                layout.x + PET_QUICK_CONTROLS_EN_WIDTH
                    <= -640.0 + 640.0 - PET_QUICK_CONTROLS_SCREEN_INSET
            );
        }
    }
}
