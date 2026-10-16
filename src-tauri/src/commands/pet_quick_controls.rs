use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
#[cfg(not(target_os = "windows"))]
use tauri::LogicalSize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[cfg(not(target_os = "windows"))]
use super::pet_mode::current_pet_logical_position;
use super::pet_mode::PET_MODE_WINDOW_LABEL;
use super::pet_panel::configure_pet_panel;
#[cfg(not(target_os = "macos"))]
use super::windows_overlay::hide_windows_overlay;
use super::windows_overlay::{is_windows_overlay_visible, set_windows_overlay_click_through};
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use {super::pet_panel::show_pet_panel_at_position, tauri::LogicalPosition};

#[cfg(target_os = "macos")]
mod motion;

pub const PET_QUICK_CONTROLS_WINDOW_LABEL: &str = "pet-quick-controls";
/* The panel is sized to its content instead of one constant per language. A
paused auto-close spells out when it lifts, so that state needs its own
width; each value is the widest string the state can render (for English,
"Paused until 10:48pm"). Slack inside a narrower reading is absorbed by the
two auto grid tracks. */
/* Each non-Windows value is the widest measured reading plus a three-point margin. The
tracks ellipsize rather than overflow, so a width rounded flush to the
longest string truncates it: the first pass rounded English "Off" to its
exact 281.2pt and lost the last letter. WebKit and Chromium measure these
strings within 0.03pt of each other, so the margin covers font revisions
and subpixel rounding rather than an engine gap. WebView2 uses the Windows
Segoe UI Variable Text/Malgun Gothic fallback for Korean; those glyphs are
wider than the macOS reading, so Windows keeps a measured platform-specific
frame instead of squeezing either button into an ellipsis. */
#[cfg(target_os = "windows")]
const PET_QUICK_CONTROLS_KO_IDLE_WIDTH: f64 = 300.0;
#[cfg(not(target_os = "windows"))]
const PET_QUICK_CONTROLS_KO_IDLE_WIDTH: f64 = 255.0;
const PET_QUICK_CONTROLS_EN_IDLE_WIDTH: f64 = 285.0;
#[cfg(target_os = "windows")]
const PET_QUICK_CONTROLS_KO_PAUSED_WIDTH: f64 = 330.0;
#[cfg(not(target_os = "windows"))]
const PET_QUICK_CONTROLS_KO_PAUSED_WIDTH: f64 = 290.0;
const PET_QUICK_CONTROLS_EN_PAUSED_WIDTH: f64 = 330.0;
#[cfg(target_os = "windows")]
const PET_QUICK_CONTROLS_MIN_WIDTH: f64 = PET_QUICK_CONTROLS_EN_IDLE_WIDTH;
#[cfg(not(target_os = "windows"))]
const PET_QUICK_CONTROLS_MIN_WIDTH: f64 = PET_QUICK_CONTROLS_KO_IDLE_WIDTH;
const PET_QUICK_CONTROLS_HEIGHT: f64 = 36.0;
#[cfg(target_os = "macos")]
const PET_QUICK_CONTROLS_MATERIAL_RADIUS: f64 = PET_QUICK_CONTROLS_HEIGHT / 2.0;
const PET_QUICK_CONTROLS_GAP: f64 = 8.0;
const PET_QUICK_CONTROLS_SCREEN_INSET: f64 = 8.0;
const PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_FAILSAFE_MS: u64 = 5_000;
static PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_HELD: AtomicBool = AtomicBool::new(false);
static PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_GENERATION: AtomicU64 = AtomicU64::new(0);
// One native movement hold survives hover, menu tracking, feedback and exit.
// Only the actual hidden frame releases it, including failed presentations.
static PET_QUICK_CONTROLS_INTERACTION: AtomicU64 = AtomicU64::new(0);
static PET_QUICK_CONTROLS_MENU_OPEN: AtomicBool = AtomicBool::new(false);
// Session state remains available to a newly mounted pet even when the main
// webview could not persist its temporary override.
static PET_QUICK_CONTROLS_STATE: Mutex<Option<PetQuickControlsState>> = Mutex::new(None);
// Keep the presented content width in points while a menu or feedback owns it.
// Dividing a transitional physical frame by a cached DPI would change that
// width during a live scale change. This value never stores a DPI or position.
#[cfg(target_os = "windows")]
static PET_QUICK_CONTROLS_PRESENTED_WIDTH: AtomicU64 =
    AtomicU64::new(PET_QUICK_CONTROLS_KO_IDLE_WIDTH.to_bits());

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetQuickControlsState {
    pub automatic_close_enabled: bool,
    pub automatic_close_saved_enabled: bool,
    pub automatic_close_override: Option<PetQuickControlsAutomaticCloseOverride>,
    pub language: String,
    pub theme: String,
    #[serde(default)]
    pub follow_system: bool,
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

fn is_automatic_close_pause_action(action: &str) -> bool {
    matches!(
        action,
        "automaticClosePause15"
            | "automaticClosePause60"
            | "automaticClosePauseToday"
            | "automaticClosePauseForever"
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
        && matches!(state.language.as_str(), "en" | "ko" | "es")
        && matches!(state.theme.as_str(), "light" | "dark")
}

fn quick_controls_paused(state: &PetQuickControlsState) -> bool {
    state
        .automatic_close_override
        .as_ref()
        .is_some_and(|override_state| !override_state.enabled)
}

fn quick_controls_width(language: &str, paused: bool) -> f64 {
    match (language == "en", paused) {
        (true, false) => PET_QUICK_CONTROLS_EN_IDLE_WIDTH,
        (true, true) => PET_QUICK_CONTROLS_EN_PAUSED_WIDTH,
        (false, false) => PET_QUICK_CONTROLS_KO_IDLE_WIDTH,
        (false, true) => PET_QUICK_CONTROLS_KO_PAUSED_WIDTH,
    }
}

fn quick_controls_resize_needed(
    visible: bool,
    interaction_held: bool,
    current: f64,
    desired: f64,
) -> bool {
    // The complete native material and WebView share this frame. Resizing it
    // during a confirmation produces two different presentation boundaries.
    (!visible || !interaction_held) && (current - desired).abs() > 0.5
}

pub(super) fn release_pet_quick_controls_interaction(app: &AppHandle) {
    PET_QUICK_CONTROLS_MENU_OPEN.store(false, Ordering::Relaxed);
    let generation = PET_QUICK_CONTROLS_INTERACTION.swap(0, Ordering::Relaxed);
    if generation != 0 {
        let _ = super::pet_mode::end_pet_quick_controls_interaction(app, generation);
    }
}

pub(super) fn revoke_pet_quick_controls_interaction(app: &AppHandle) {
    set_pet_quick_controls_acknowledgement_held(app, false);
    if let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) {
        let _ = hide_pet_quick_controls_window(&window);
    } else {
        release_pet_quick_controls_interaction(app);
    }
}

fn prepare_pet_quick_controls_size(
    window: &WebviewWindow,
    state: &PetQuickControlsState,
) -> Result<f64, String> {
    #[cfg(target_os = "windows")]
    let current = f64::from_bits(PET_QUICK_CONTROLS_PRESENTED_WIDTH.load(Ordering::Relaxed));
    #[cfg(not(target_os = "windows"))]
    let current = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|error| error.to_string())?)
        .width;
    let desired = quick_controls_width(&state.language, quick_controls_paused(state));
    let held = pet_quick_controls_acknowledgement_held()
        || PET_QUICK_CONTROLS_MENU_OPEN.load(Ordering::Relaxed);
    if quick_controls_resize_needed(is_windows_overlay_visible(window), held, current, desired) {
        // Windows applies the whole frame at the pet's current native DPI below.
        // A hidden toolbar's cached scale can still belong to the previous DPI.
        #[cfg(not(target_os = "windows"))]
        window
            .set_size(LogicalSize::new(desired, PET_QUICK_CONTROLS_HEIGHT))
            .map_err(|error| error.to_string())?;
        return Ok(desired);
    }
    Ok(current)
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
    #[cfg(target_os = "windows")]
    let scale = windows_pet_scale(pet)?;
    #[cfg(target_os = "windows")]
    let position = super::pet_mode::current_pet_render_geometry().window_to_scene(
        pet.outer_position()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale),
    );
    #[cfg(not(target_os = "windows"))]
    let position = current_pet_logical_position(pet)?;
    let (body_width, body_height) = super::pet_mode::pet_size();
    let monitor = super::pet_mode::resolve_pet_scene_monitor(pet)
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "No monitor is available for Pet Mode quick controls".to_string())?;
    let work_area = monitor.work_area();
    #[cfg(not(target_os = "windows"))]
    let scale = monitor.scale_factor();
    let work_position = work_area.position.to_logical::<f64>(scale);
    let work_size = work_area.size.to_logical::<f64>(scale);
    Ok(layout_pet_quick_controls(
        position.x,
        position.y,
        body_width,
        body_height,
        work_position.x,
        work_position.y,
        work_size.width,
        work_size.height,
        controls_width,
    ))
}

#[cfg(target_os = "windows")]
fn windows_pet_scale(pet: &WebviewWindow) -> Result<f64, String> {
    super::pet_cursor_windows::window_scale_factor(pet)
}

#[cfg(any(target_os = "windows", test))]
fn quick_controls_physical_frame(
    layout: PetQuickControlsLayout,
    width: f64,
    scale: f64,
) -> Result<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>), String> {
    let values = [
        layout.x * scale,
        layout.y * scale,
        width * scale,
        PET_QUICK_CONTROLS_HEIGHT * scale,
    ];
    if !scale.is_finite()
        || scale <= 0.0
        || !values.into_iter().all(f64::is_finite)
        || values[..2]
            .iter()
            .any(|value| value.round() < i32::MIN as f64 || value.round() > i32::MAX as f64)
        || values[2..]
            .iter()
            .any(|value| value.round() < 1.0 || value.round() > i32::MAX as f64)
    {
        return Err("Pet quick-controls frame is outside the physical desktop".into());
    }
    Ok((
        tauri::PhysicalPosition::new(values[0].round() as i32, values[1].round() as i32),
        tauri::PhysicalSize::new(values[2].round() as u32, values[3].round() as u32),
    ))
}

#[cfg(target_os = "windows")]
fn position_windows_quick_controls(
    window: &WebviewWindow,
    pet: &WebviewWindow,
    layout: PetQuickControlsLayout,
    width: f64,
) -> Result<(), String> {
    let scale = windows_pet_scale(pet)?;
    let (position, size) = quick_controls_physical_frame(layout, width, scale)?;
    // Position first so Windows can deliver the real monitor DPI change to a
    // previously hidden toolbar. All calls run on the window's owner thread.
    // Physical coordinates and constraints never reuse the toolbar's old scale.
    window
        .set_position(position)
        .map_err(|error| error.to_string())?;
    let (_, minimum) = quick_controls_physical_frame(layout, PET_QUICK_CONTROLS_MIN_WIDTH, scale)?;
    let (_, maximum) =
        quick_controls_physical_frame(layout, PET_QUICK_CONTROLS_EN_PAUSED_WIDTH, scale)?;
    window
        .set_min_size(Some(minimum))
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(Some(maximum))
        .map_err(|error| error.to_string())?;
    window.set_size(size).map_err(|error| error.to_string())?;
    PET_QUICK_CONTROLS_PRESENTED_WIDTH.store(width.to_bits(), Ordering::Relaxed);
    Ok(())
}

#[cfg(target_os = "windows")]
pub(super) fn refresh_windows_quick_controls_dpi(app: AppHandle) {
    // ScaleFactorChanged arrives before Tao finishes its suggested frame.
    // Read the latest pet/state in a later owner-thread transaction. A queued
    // refresh cannot reveal a toolbar that was hidden in the meantime.
    drop(tauri::async_runtime::spawn_blocking(move || {
        let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) else {
            return;
        };
        let result = super::pet_mode::run_pet_native_transaction(
            &window,
            "pet_quick_controls::refresh_windows_dpi",
            move |window| {
                if !is_windows_overlay_visible(&window) {
                    return Ok(());
                }
                let Some(pet) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
                    return Ok(());
                };
                if !is_windows_overlay_visible(&pet) {
                    return hide_pet_quick_controls_window(&window);
                }
                let Some(state) = pet_quick_controls_get_state()? else {
                    return Ok(());
                };
                let width = prepare_pet_quick_controls_size(&window, &state)?;
                let layout = resolve_quick_controls_layout(&app, &pet, width)?;
                position_windows_quick_controls(&window, &pet, layout, width)
            },
        );
        if let Err(error) = result {
            eprintln!("Could not refresh pet quick controls DPI: {error}");
        }
    }));
}

fn hide_pet_quick_controls_window(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if !super::pet_mode::pet_native_thread_is_current(window)? {
        return super::pet_mode::run_pet_native_transaction(
            window,
            "pet_quick_controls::hide",
            |window| hide_pet_quick_controls_window(&window),
        );
    }
    #[cfg(target_os = "macos")]
    return motion::hide_immediately(window);
    // Off macOS the bar is a layered overlay: drop its click-through state and
    // hide it through the same helper, which falls back to a plain hide on
    // platforms without the native overlay.
    #[cfg(not(target_os = "macos"))]
    {
        let _ = set_windows_overlay_click_through(window, true);
        hide_windows_overlay(window)?;
        release_pet_quick_controls_interaction(window.app_handle());
        Ok(())
    }
}

pub fn set_pet_quick_controls_acknowledgement_held(app: &AppHandle, held: bool) {
    let generation = PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_GENERATION
        .fetch_add(1, Ordering::Relaxed)
        .wrapping_add(1);
    PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_HELD.store(held, Ordering::Relaxed);
    if !held {
        return;
    }
    #[cfg(target_os = "macos")]
    if let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) {
        let _ = motion::hold_visible(&window);
    }

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(
            PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_FAILSAFE_MS,
        ));
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(crate::panic_guard::contained("pet_quick_controls::set_pet_quick_controls_acknowledgement_held", move || {
            if PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_GENERATION.load(Ordering::Relaxed) != generation
                || !PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_HELD.swap(false, Ordering::Relaxed)
            {
                return;
            }
            if let Some(window) = app_for_main.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) {
                let _ = hide_pet_quick_controls_window(&window);
            }
        }));
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
fn sync_pet_quick_controls_theme(
    app: &AppHandle,
    window: &WebviewWindow,
    dark: bool,
    follow_system: bool,
) {
    use objc2::MainThreadMarker;
    let theme = super::window_chrome::native_theme_choice(dark, follow_system);
    if MainThreadMarker::new().is_some() {
        let _ = window.set_theme(theme);
        return;
    }

    let window = window.clone();
    if let Err(error) = app.run_on_main_thread(crate::panic_guard::contained(
        "pet_quick_controls::sync_pet_quick_controls_theme",
        move || {
            let _ = window.set_theme(theme);
        },
    )) {
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
    .inner_size(PET_QUICK_CONTROLS_KO_IDLE_WIDTH, PET_QUICK_CONTROLS_HEIGHT)
    .min_inner_size(PET_QUICK_CONTROLS_MIN_WIDTH, PET_QUICK_CONTROLS_HEIGHT)
    .max_inner_size(
        PET_QUICK_CONTROLS_EN_PAUSED_WIDTH,
        PET_QUICK_CONTROLS_HEIGHT,
    )
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
    #[cfg(target_os = "windows")]
    {
        let app = window.app_handle().clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. }) {
                refresh_windows_quick_controls_dpi(app.clone());
            }
        });
    }
    #[cfg(target_os = "macos")]
    apply_pet_quick_controls_material(&window);
    let _ = set_windows_overlay_click_through(&window, true);
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
pub fn pet_quick_controls_set_visible(app: AppHandle, visible: bool) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) else {
            return Ok(false);
        };
        // Acquisition, publication, and presentation share the same AppKit
        // boundary as hide/revoke. A hide cannot observe a half-published
        // interaction and leave the motion hold behind or reopen stale UI.
        return motion::on_main(&window, move |_| {
            set_pet_quick_controls_visible(&app, visible)
        });
    }
    #[cfg(target_os = "windows")]
    {
        let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) else {
            return Ok(false);
        };
        return super::pet_mode::run_pet_native_transaction(
            &window,
            "pet_quick_controls::set_visible",
            move |_| set_pet_quick_controls_visible(&app, visible),
        );
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    set_pet_quick_controls_visible(&app, visible)
}

fn set_pet_quick_controls_visible(app: &AppHandle, visible: bool) -> Result<bool, String> {
    // Feedback owns the panel in both directions. A stale hover-open request
    // must not hide it because hideOneHour has already hidden the cat.
    if pet_quick_controls_acknowledgement_held() {
        return Ok(true);
    }
    if PET_QUICK_CONTROLS_MENU_OPEN.load(Ordering::Relaxed) {
        return Ok(true);
    }
    let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) else {
        return Ok(false);
    };
    if !visible {
        #[cfg(target_os = "macos")]
        {
            motion::hide(&window)?;
            return Ok(false);
        }
        #[cfg(not(target_os = "macos"))]
        {
            hide_pet_quick_controls_window(&window)?;
            return Ok(false);
        }
    }

    let Some(pet) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        hide_pet_quick_controls_window(&window)?;
        return Ok(false);
    };
    if !is_windows_overlay_visible(&pet) {
        hide_pet_quick_controls_window(&window)?;
        return Ok(false);
    }

    if PET_QUICK_CONTROLS_INTERACTION.load(Ordering::Relaxed) == 0 {
        let Some(generation) = super::pet_mode::begin_pet_quick_controls_interaction(&app)? else {
            return Ok(false);
        };
        PET_QUICK_CONTROLS_INTERACTION.store(generation, Ordering::Relaxed);
    }
    let result = (|| {
        // A deferred state change must be applied before measuring the next show,
        // not after its first visible frame. Reentry retains the current geometry.
        let state = pet_quick_controls_get_state()?;
        let controls_width = if let Some(state) = state.as_ref() {
            prepare_pet_quick_controls_size(&window, state)?
        } else {
            PET_QUICK_CONTROLS_KO_IDLE_WIDTH
        };
        let layout = resolve_quick_controls_layout(&app, &pet, controls_width)?;
        // The layered overlay carries WS_EX_TRANSPARENT on Windows. Clearing it
        // here is what makes the bar clickable; without it the bar is visible
        // but every click falls through to the window beneath it.
        set_windows_overlay_click_through(&window, false)?;
        let _ = window.emit(
            "pet-quick-controls-layout",
            json!({ "placement": layout.placement }),
        );
        #[cfg(target_os = "macos")]
        motion::show(&window, layout)?;
        #[cfg(target_os = "windows")]
        {
            position_windows_quick_controls(&window, &pet, layout, controls_width)?;
            super::windows_overlay::show_windows_overlay(&window)?;
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        show_pet_panel_at_position(&app, &window, LogicalPosition::new(layout.x, layout.y))?;
        Ok(true)
    })();
    if result.is_err() {
        let _ = hide_pet_quick_controls_window(&window);
    }
    result
}

#[tauri::command]
pub fn pet_quick_controls_sync_state(
    app: AppHandle,
    state: PetQuickControlsState,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) {
        return super::pet_mode::run_pet_native_transaction(
            &window,
            "pet_quick_controls::sync_state",
            move |_| sync_pet_quick_controls_state(&app, state),
        );
    }
    sync_pet_quick_controls_state(&app, state)
}

fn sync_pet_quick_controls_state(
    app: &AppHandle,
    state: PetQuickControlsState,
) -> Result<(), String> {
    if !is_supported_quick_controls_state(&state) {
        return Err("unsupported pet quick controls state".to_string());
    }
    let previous_state = PET_QUICK_CONTROLS_STATE
        .lock()
        .map_err(|error| error.to_string())?
        .replace(state.clone());
    #[cfg(not(target_os = "macos"))]
    let _ = previous_state;
    if let Some(pet) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
        pet.emit("pet-quick-controls-state", &state)
            .map_err(|error| error.to_string())?;
    }
    let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) else {
        return Ok(());
    };
    #[cfg(target_os = "macos")]
    if previous_state
        .as_ref()
        .map(|previous| (&previous.theme, previous.follow_system))
        != Some((&state.theme, state.follow_system))
    {
        sync_pet_quick_controls_theme(&app, &window, state.theme == "dark", state.follow_system);
    }
    let controls_width = prepare_pet_quick_controls_size(&window, &state)?;
    // Settings changed elsewhere may require a wider resting toolbar. Own
    // button/menu feedback retains its frame; apply its new width hidden at
    // the next presentation. This also keeps external locale changes readable.
    if !pet_quick_controls_acknowledgement_held()
        && !PET_QUICK_CONTROLS_MENU_OPEN.load(Ordering::Relaxed)
        && is_windows_overlay_visible(&window)
    {
        if let Some(pet) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
            let layout = resolve_quick_controls_layout(&app, &pet, controls_width)?;
            #[cfg(target_os = "macos")]
            motion::relocate(&window, layout)?;
            #[cfg(target_os = "windows")]
            position_windows_quick_controls(&window, &pet, layout, controls_width)?;
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            window
                .set_position(LogicalPosition::new(layout.x, layout.y))
                .map_err(|error| error.to_string())?;
        }
    }
    window
        .emit("pet-quick-controls-state", state)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pet_quick_controls_get_state() -> Result<Option<PetQuickControlsState>, String> {
    PET_QUICK_CONTROLS_STATE
        .lock()
        .map(|state| state.clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pet_quick_controls_cursor_inside(app: AppHandle) -> bool {
    let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) else {
        return false;
    };
    if !is_windows_overlay_visible(&window) {
        return false;
    }

    #[cfg(target_os = "macos")]
    {
        return macos_cursor_inside_window(&app, &window).unwrap_or(false);
    }

    #[cfg(target_os = "windows")]
    {
        return super::pet_mode::run_pet_native_transaction(
            &window,
            "pet_quick_controls::cursor_inside",
            |window| {
                if !is_windows_overlay_visible(&window) {
                    return Ok(false);
                }
                let position = window.outer_position().map_err(|error| error.to_string())?;
                let size = window.outer_size().map_err(|error| error.to_string())?;
                let cursor = super::pet_cursor_windows::cursor_position()?;
                Ok(point_inside_rect(
                    cursor.x,
                    cursor.y,
                    position.x as f64,
                    position.y as f64,
                    size.width as f64,
                    size.height as f64,
                ))
            },
        )
        .unwrap_or(false);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
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
    app.run_on_main_thread(crate::panic_guard::contained(
        "pet_quick_controls::macos_cursor_inside_window",
        move || {
            let _ = sender.send(macos_cursor_inside_window_on_main_thread(&window_for_main));
        },
    ))
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
pub async fn pet_quick_controls_action(app: AppHandle, action: String) -> Result<(), String> {
    if !is_supported_quick_controls_action(&action) {
        return Err(format!("unknown pet quick controls action: {action}"));
    }

    if action == "menuOpened" || action == "menuClosed" {
        PET_QUICK_CONTROLS_MENU_OPEN.store(action == "menuOpened", Ordering::Relaxed);
        #[cfg(target_os = "macos")]
        if action == "menuOpened" {
            if let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) {
                motion::hold_visible(&window)?;
            }
        }
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
        // Keep the native hold until the final exit frame, and notify the pet
        // first so a stationary hover cannot reopen the panel after dismissal.
        let cooldown_result = if let Some(pet) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
            pet.emit("pet-quick-controls-action", json!({ "action": action }))
                .map_err(|error| error.to_string())
        } else {
            Ok(())
        };
        return tauri::async_runtime::spawn_blocking(move || {
            let result =
                if let Some(window) = app.get_webview_window(PET_QUICK_CONTROLS_WINDOW_LABEL) {
                    #[cfg(target_os = "macos")]
                    let result = motion::hide_and_wait(&window);
                    #[cfg(not(target_os = "macos"))]
                    let result = hide_pet_quick_controls_window(&window);
                    // Even if presentation failed, never expose idle buttons in
                    // the renderer while an old confirmation panel stays visible.
                    if result.is_err() {
                        let _ = hide_pet_quick_controls_window(&window);
                    }
                    result
                } else {
                    Ok(())
                };
            set_pet_quick_controls_acknowledgement_held(&app, false);
            result.and(cooldown_result)
        })
        .await
        .map_err(|error| error.to_string())?;
    }

    // Acquire before emitting the pause, including its asynchronous state
    // confirmation. Otherwise the hover poll can dismiss the success message
    // after just its 250ms leave grace while the renderer still counts 1.1s.
    if is_automatic_close_pause_action(&action) {
        set_pet_quick_controls_acknowledgement_held(&app, true);
    }
    if let Some(main) = app.get_webview_window("main") {
        if let Err(error) = main.emit("pet-quick-controls-action", json!({ "action": action })) {
            if is_automatic_close_pause_action(&action) {
                set_pet_quick_controls_acknowledgement_held(&app, false);
            }
            return Err(error.to_string());
        }
    } else if is_automatic_close_pause_action(&action) {
        set_pet_quick_controls_acknowledgement_held(&app, false);
        return Err("Pet quick-controls action window is unavailable".to_string());
    }
    if action == "openDashboard" || action == "openSettings" {
        // Changing the hidden renderer's tab is not enough for an explicit
        // open. Use the normal tray/reopen path to restore and focus the main
        // window; background pet actions continue to leave it in place.
        crate::reveal_main_window(&app);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        is_automatic_close_pause_action, is_supported_quick_controls_action,
        is_supported_quick_controls_state, layout_pet_quick_controls, point_inside_rect,
        quick_controls_paused, quick_controls_width, PetQuickControlsAutomaticCloseOverride,
        PetQuickControlsState, PET_QUICK_CONTROLS_ACKNOWLEDGEMENT_FAILSAFE_MS,
        PET_QUICK_CONTROLS_EN_IDLE_WIDTH, PET_QUICK_CONTROLS_EN_PAUSED_WIDTH,
        PET_QUICK_CONTROLS_KO_IDLE_WIDTH, PET_QUICK_CONTROLS_KO_PAUSED_WIDTH,
        PET_QUICK_CONTROLS_MIN_WIDTH, PET_QUICK_CONTROLS_SCREEN_INSET,
    };
    use serde_json::json;

    #[test]
    fn toolbar_stays_centered_below_the_pet_at_each_live_dpi() {
        // Independent physical pet fixture. Its canonical width is 144 and
        // feet are at y=249; a 300-point toolbar has an 8-point gap below it.
        for (scale, expected) in [
            (1.0, (372, 257, 300, 36)),
            (2.0, (744, 514, 600, 72)),
            (2.25, (837, 578, 675, 81)),
        ] {
            let layout = layout_pet_quick_controls(
                450.0, 150.0, 144.0, 99.0, 0.0, 0.0, 1280.0, 720.0, 300.0,
            );
            let (position, size) =
                super::quick_controls_physical_frame(layout, 300.0, scale).unwrap();
            assert_eq!((position.x, position.y, size.width, size.height), expected);
            assert!((position.x as f64 + size.width as f64 / 2.0 - 522.0 * scale).abs() <= 0.5);
            assert!((position.y as f64 - 249.0 * scale - 8.0 * scale).abs() <= 0.5);
        }
    }

    #[test]
    fn toolbar_physical_frame_preserves_negative_desktop_origins() {
        let layout = layout_pet_quick_controls(
            -900.0, -200.0, 144.0, 99.0, -1280.0, -720.0, 1280.0, 720.0, 300.0,
        );
        let (position, size) = super::quick_controls_physical_frame(layout, 300.0, 2.25).unwrap();
        assert_eq!(
            (position.x, position.y, size.width, size.height),
            (-2201, -209, 675, 81)
        );
        assert!(point_inside_rect(
            -1900.0,
            -180.0,
            position.x as f64,
            position.y as f64,
            size.width as f64,
            size.height as f64
        ));
    }

    #[test]
    fn toolbar_rejects_invalid_physical_frames_before_native_calls() {
        let layout = super::PetQuickControlsLayout {
            x: 0.0,
            y: 0.0,
            placement: "below",
        };
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::MAX] {
            assert!(super::quick_controls_physical_frame(layout, 300.0, scale).is_err());
        }
        for width in [0.0, -300.0, f64::NAN, f64::INFINITY, i32::MAX as f64] {
            assert!(super::quick_controls_physical_frame(layout, width, 2.25).is_err());
        }
        for x in [f64::NAN, f64::INFINITY, i32::MAX as f64, i32::MIN as f64] {
            assert!(super::quick_controls_physical_frame(
                super::PetQuickControlsLayout { x, ..layout },
                300.0,
                2.25
            )
            .is_err());
        }
    }

    fn state_with_override(
        language: &str,
        override_state: Option<PetQuickControlsAutomaticCloseOverride>,
    ) -> PetQuickControlsState {
        PetQuickControlsState {
            automatic_close_enabled: override_state.is_none(),
            automatic_close_saved_enabled: true,
            automatic_close_override: override_state,
            language: language.to_string(),
            theme: "light".to_string(),
            follow_system: false,
        }
    }

    #[test]
    fn widens_the_panel_only_while_the_pause_spells_out_its_end() {
        let paused = Some(PetQuickControlsAutomaticCloseOverride {
            enabled: false,
            kind: "60".to_string(),
            ends_at_ms: Some(1_800_000),
        });
        let temporarily_on = Some(PetQuickControlsAutomaticCloseOverride {
            enabled: true,
            kind: "60".to_string(),
            ends_at_ms: Some(1_800_000),
        });

        // A temporary enable still reads as "On", so it keeps the resting width.
        assert!(!quick_controls_paused(&state_with_override(
            "en",
            temporarily_on.clone()
        )));
        assert!(quick_controls_paused(&state_with_override(
            "en",
            paused.clone()
        )));

        assert_eq!(
            quick_controls_width("en", false),
            PET_QUICK_CONTROLS_EN_IDLE_WIDTH
        );
        assert_eq!(
            quick_controls_width("en", true),
            PET_QUICK_CONTROLS_EN_PAUSED_WIDTH
        );
        assert_eq!(
            quick_controls_width("ko", false),
            PET_QUICK_CONTROLS_KO_IDLE_WIDTH
        );
        assert_eq!(
            quick_controls_width("ko", true),
            PET_QUICK_CONTROLS_KO_PAUSED_WIDTH
        );

        // Every reading has to fit between the creation minimum and maximum,
        // even though the widest idle language differs by platform.
        for width in [
            PET_QUICK_CONTROLS_KO_IDLE_WIDTH,
            PET_QUICK_CONTROLS_EN_IDLE_WIDTH,
            PET_QUICK_CONTROLS_KO_PAUSED_WIDTH,
            PET_QUICK_CONTROLS_EN_PAUSED_WIDTH,
        ] {
            assert!(width >= PET_QUICK_CONTROLS_MIN_WIDTH);
            assert!(width <= PET_QUICK_CONTROLS_EN_PAUSED_WIDTH);
        }
    }

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
            follow_system: false,
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
                "followSystem": false,
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
            follow_system: false,
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
    fn holds_all_pause_confirmations_but_not_enable_or_navigation_actions() {
        for action in [
            "automaticClosePause15",
            "automaticClosePause60",
            "automaticClosePauseToday",
            "automaticClosePauseForever",
        ] {
            assert!(is_automatic_close_pause_action(action), "{action}");
        }
        for action in [
            "automaticCloseEnable15",
            "automaticCloseRestore",
            "automaticCloseExtend60",
            "openSettings",
            "menuClosed",
            "acknowledgeDismiss",
        ] {
            assert!(!is_automatic_close_pause_action(action), "{action}");
        }
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
            PET_QUICK_CONTROLS_KO_IDLE_WIDTH,
        );
        assert_eq!(layout.placement, "below");
        assert!((layout.y - 121.0).abs() < f64::EPSILON);
        assert!(layout.x + PET_QUICK_CONTROLS_KO_IDLE_WIDTH <= 1440.0 - 8.0);
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
            PET_QUICK_CONTROLS_KO_IDLE_WIDTH,
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
            PET_QUICK_CONTROLS_EN_PAUSED_WIDTH,
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
            PET_QUICK_CONTROLS_EN_PAUSED_WIDTH,
        );

        assert!((left.x - (-632.0)).abs() < f64::EPSILON);
        assert!((right.x - (-338.0)).abs() < f64::EPSILON);
        for layout in [left, right] {
            assert!(layout.x >= -640.0 + PET_QUICK_CONTROLS_SCREEN_INSET);
            assert!(
                layout.x + PET_QUICK_CONTROLS_EN_PAUSED_WIDTH
                    <= -640.0 + 640.0 - PET_QUICK_CONTROLS_SCREEN_INSET
            );
        }
    }
    #[test]
    fn feedback_updates_wait_for_a_hidden_frame_before_resizing() {
        for (idle, paused) in [
            (
                PET_QUICK_CONTROLS_KO_IDLE_WIDTH,
                PET_QUICK_CONTROLS_KO_PAUSED_WIDTH,
            ),
            (
                PET_QUICK_CONTROLS_EN_IDLE_WIDTH,
                PET_QUICK_CONTROLS_EN_PAUSED_WIDTH,
            ),
        ] {
            assert!(!super::quick_controls_resize_needed(
                true, true, idle, paused
            ));
            assert!(!super::quick_controls_resize_needed(
                true, true, paused, idle
            ));
            assert!(super::quick_controls_resize_needed(
                false, true, idle, paused
            ));
            assert!(!super::quick_controls_resize_needed(
                false, false, paused, paused
            ));
            assert!(super::quick_controls_resize_needed(
                true, false, idle, paused
            ));
        }
    }
}
