use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    async_runtime, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor,
    PhysicalPosition as Point, PhysicalSize as Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
#[cfg(target_os = "macos")]
use objc2_foundation::NSPoint;

use super::pet_panel::{configure_pet_panel, perform_pet_panel_drag, show_pet_panel};

#[cfg(target_os = "macos")]
#[path = "pet_mode_native_ax.rs"]
mod pet_mode_native_ax;

pub const PET_MODE_WINDOW_LABEL: &str = "pet-mode";
// Keep the approved 60% cat scale, but include the F12 action's transparent
// side gutters. The source contact point lands at local x ~= 143; the old
// 132-point panel clipped roughly five visible paw pixels at full extension.
const PET_MODE_WIDTH: f64 = 144.0;
const PET_MODE_HEIGHT: f64 = 99.0;
const PET_MODE_HOME_Y: f64 = 14.0;
// Manual placement stays completely free, but only a drop inside this upper
// screen band redefines the pet's long-term home. A lower drop is temporary:
// the next autonomous walk still targets the remembered upper resident lane.
const PET_MODE_RESIDENT_BAND_RATIO: f64 = 0.32;
const PET_MODE_RUN_SPEED: f64 = 300.0;
const PET_MODE_WALK_SPEED: f64 = 20.8;
const PET_MODE_RUN_MAX_SECONDS: f64 = 6.0;
const PET_MODE_WALK_MAX_SECONDS: f64 = 60.0;
// F12 source contact point (162.8751 / 150) scaled to the fixed 121.2-point
// cat viewport and centered in the 144-point native panel.
const PET_MODE_CONTACT_X_RIGHT: f64 = 143.0;
const PET_MODE_CONTACT_X_LEFT: f64 = 1.0;
const PET_MODE_CONTACT_Y: f64 = 40.0;
const PET_MODE_FALLBACK_TARGET_INSET: f64 = 28.0;
const PET_MODE_AX_SCAN_LIMIT: usize = 360;

static PET_MODE_ENABLED: AtomicBool = AtomicBool::new(false);
static PET_MODE_ROAM_RIGHT: AtomicBool = AtomicBool::new(true);
static PET_MODE_MOTION_REVISION: AtomicU64 = AtomicU64::new(0);
static PET_MODE_PREVIEW_RETURN: AtomicBool = AtomicBool::new(false);
static PET_MODE_PREFERRED_POSITION: Mutex<Option<LogicalPosition<f64>>> = Mutex::new(None);
/// The pet panel's current logical size. Every placement calculation needs the
/// real footprint: with a user-selectable size, treating the panel as a fixed
/// 144x99 would let a 125% pet clamp to a right edge computed for a smaller
/// window and hang off the screen.
static PET_MODE_SIZE: Mutex<(f64, f64)> = Mutex::new((PET_MODE_WIDTH, PET_MODE_HEIGHT));
static PET_MODE_PREVIEW_RETURN_POSITION: Mutex<Option<LogicalPosition<f64>>> = Mutex::new(None);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeInterventionTarget {
    pub id: String,
    pub app_name: String,
    pub browser_name: Option<String>,
    #[serde(default)]
    pub preview: bool,
    #[serde(default)]
    pub lab_target: Option<PetModeLabTargetKind>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PetModeLabTargetKind {
    BrowserTabX,
    DriftyWindowX,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeLabTarget {
    pub browser_name: Option<String>,
    pub lab_target: Option<PetModeLabTargetKind>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PetModePreviewAction {
    Stop,
    LifeLoop,
    Walk,
    Blink,
    Stretch,
    TailFlick,
    Sleep,
    Wake,
    Pet,
    Outing,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PetModeTargetKind {
    BrowserTabClose,
    WindowClose,
    Fallback,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PetModeTargetConfidence {
    High,
    Medium,
    Low,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeResolvedTarget {
    pub facing: &'static str,
    pub target_kind: PetModeTargetKind,
    pub confidence: PetModeTargetConfidence,
    pub diagnostic: String,
    pub target_x: f64,
    pub target_y: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeContactAlignmentRequest {
    pub target_x: f64,
    pub target_y: f64,
    pub anchor_x: f64,
    pub anchor_y: f64,
    pub diagnostic: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeContactAlignment {
    pub target_x: f64,
    pub target_y: f64,
    pub contact_x: f64,
    pub contact_y: f64,
    pub error_x: f64,
    pub error_y: f64,
    pub error_distance: f64,
    pub attempts: u8,
    pub diagnostic: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeInputBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub visible: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeNativeDragResult {
    moved: bool,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
}

#[derive(Clone, Debug)]
struct PetModeTargetPoint {
    x: f64,
    y: f64,
    kind: PetModeTargetKind,
    confidence: PetModeTargetConfidence,
    diagnostic: String,
}

/// Current pet panel width/height in logical points. Falls back to the base
/// geometry if the lock is poisoned so placement never panics.
fn pet_size() -> (f64, f64) {
    PET_MODE_SIZE
        .lock()
        .map(|size| *size)
        .unwrap_or((PET_MODE_WIDTH, PET_MODE_HEIGHT))
}

fn pet_width() -> f64 {
    pet_size().0
}

fn pet_height() -> f64 {
    pet_size().1
}

/// Contact points are authored against the base 144x99 panel. Scaling them by
/// the current size keeps the paw landing on its target when the pet is
/// rendered larger or smaller.
fn pet_contact_offsets(facing: &str) -> (f64, f64) {
    let (width, height) = pet_size();
    let x_ratio = if facing == "left" {
        PET_MODE_CONTACT_X_LEFT / PET_MODE_WIDTH
    } else {
        PET_MODE_CONTACT_X_RIGHT / PET_MODE_WIDTH
    };
    (
        width * x_ratio,
        height * (PET_MODE_CONTACT_Y / PET_MODE_HEIGHT),
    )
}

pub fn setup_pet_mode_window(app: &tauri::App) -> tauri::Result<()> {
    // The panel is always (re)created at the base geometry, so the tracked
    // size has to start there too. The webview re-applies the user's choice
    // once it mounts.
    if let Ok(mut current) = PET_MODE_SIZE.lock() {
        *current = (PET_MODE_WIDTH, PET_MODE_HEIGHT);
    }
    let window = WebviewWindowBuilder::new(
        app,
        PET_MODE_WINDOW_LABEL,
        WebviewUrl::App("index.html?driftySurface=pet-mode".into()),
    )
    .title("Drifty Pet Mode")
    .inner_size(PET_MODE_WIDTH, PET_MODE_HEIGHT)
    .min_inner_size(PET_MODE_WIDTH, PET_MODE_HEIGHT)
    .max_inner_size(PET_MODE_WIDTH, PET_MODE_HEIGHT)
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
    // Forward the first press even when another app is active. Combined with
    // the non-activating NSPanel below, the press reaches the cat without
    // bringing Drifty's dashboard forward.
    .accept_first_mouse(true)
    .visible(false)
    .build()?;

    configure_pet_panel(&window)?;
    // Keep hidden windows click-through. Once visible, this compact window owns
    // its input rectangle so the first press cannot reach the dashboard below.
    let _ = window.set_ignore_cursor_events(true);
    Ok(())
}

#[tauri::command]
pub fn pet_mode_set_enabled(
    app: AppHandle,
    enabled: bool,
    snapshot: Option<Value>,
) -> Result<(), String> {
    PET_MODE_ENABLED.store(enabled, Ordering::Relaxed);
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Err("Pet Mode window is not available".to_string());
    };

    if !enabled {
        let _ = window.set_ignore_cursor_events(true);
        return window.hide().map_err(|error| error.to_string());
    }

    position_pet_home(&app, &window, false)?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window
        .set_visible_on_all_workspaces(true)
        .map_err(|error| error.to_string())?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    show_pet_panel(&app, &window)?;
    if let Some(snapshot) = snapshot {
        emit_pet_event(&window, json!({ "kind": "snapshot", "snapshot": snapshot }))?;
    }
    Ok(())
}

#[tauri::command]
pub fn pet_mode_update(app: AppHandle, snapshot: Value) -> Result<(), String> {
    if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Ok(());
    }
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(());
    };
    // A visible enabled pet is always an input-owning surface. Reassert this
    // invariant on tracker snapshots so a WebView/HMR replacement cannot
    // leave the surviving native panel permanently click-through.
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    emit_pet_event(&window, json!({ "kind": "snapshot", "snapshot": snapshot }))
}

#[tauri::command]
pub fn pet_mode_intervene(app: AppHandle, target: PetModeInterventionTarget) -> Result<(), String> {
    if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Err("Pet Mode is disabled".to_string());
    }
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    show_pet_panel(&app, &window)?;
    emit_pet_event(&window, json!({ "kind": "intervention", "target": target }))
}

#[tauri::command]
pub fn pet_mode_preview_intervention(app: AppHandle) -> Result<(), String> {
    let preview_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    PET_MODE_PREVIEW_RETURN.store(true, Ordering::Relaxed);
    pet_mode_intervene(
        app,
        PetModeInterventionTarget {
            id: format!("pet-preview-{preview_id}"),
            app_name: "Preview target".to_string(),
            browser_name: None,
            preview: true,
            lab_target: None,
        },
    )
}

#[tauri::command]
pub async fn pet_mode_lab_apply_target(
    app: AppHandle,
    target: PetModeLabTarget,
) -> Result<String, String> {
    match target.lab_target {
        Some(PetModeLabTargetKind::DriftyWindowX) => {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "Drifty main window is not available".to_string())?;
            // This uses the same Tauri close lifecycle as the macOS traffic-light
            // X. The application's close handler intentionally hides the window.
            window.close().map_err(|error| error.to_string())?;
            Ok("drifty_window_close_requested".to_string())
        }
        Some(PetModeLabTargetKind::BrowserTabX) => {
            let browser_name = target
                .browser_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .ok_or_else(|| "No observed browser is available for the tab-X test".to_string())?
                .to_string();
            async_runtime::spawn_blocking(move || close_lab_browser_active_tab(&browser_name))
                .await
                .map_err(|error| error.to_string())?
        }
        None => Err("Pet Mode Lab target is missing".to_string()),
    }
}

#[tauri::command]
pub fn pet_mode_preview_action(app: AppHandle, action: PetModePreviewAction) -> Result<(), String> {
    if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Err("Pet Mode is disabled".to_string());
    }
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    if matches!(action, PetModePreviewAction::Stop) {
        cancel_pet_motion();
    }
    emit_pet_event(
        &window,
        json!({ "kind": "preview_action", "action": action }),
    )
}

#[tauri::command]
pub fn pet_mode_cancel_motion() {
    // Manual pickup needs to stop native travel immediately without emitting a
    // `stop` preview event back into the pet renderer. That event intentionally
    // invalidates action tokens and would cancel the delayed pickup handoff.
    cancel_pet_motion();
}

#[tauri::command]
pub async fn pet_mode_move_to_target(
    app: AppHandle,
    target: PetModeInterventionTarget,
) -> Result<PetModeResolvedTarget, String> {
    async_runtime::spawn_blocking(move || move_pet_to_target(&app, &target))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn pet_mode_align_contact(
    app: AppHandle,
    request: PetModeContactAlignmentRequest,
) -> Result<PetModeContactAlignment, String> {
    if ![
        request.target_x,
        request.target_y,
        request.anchor_x,
        request.anchor_y,
    ]
    .into_iter()
    .all(f64::is_finite)
    {
        return Err("Pet Mode contact alignment received non-finite coordinates".to_string());
    }
    if !(-4.0..=pet_width() + 4.0).contains(&request.anchor_x)
        || !(-4.0..=pet_height() + 4.0).contains(&request.anchor_y)
    {
        return Err("Pet Mode contact anchor is outside the native panel".to_string());
    }

    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let mut attempts = 0_u8;

    // `set_position(LogicalPosition)` still rounds at the target monitor's
    // backing scale. Read the real outer position back and correct the residual
    // instead of assuming the requested point was accepted pixel-for-pixel.
    for attempt in 1..=3 {
        attempts = attempt;
        let position = current_pet_logical_position(&window)?;
        let contact_x = position.x + request.anchor_x;
        let contact_y = position.y + request.anchor_y;
        let error_x = request.target_x - contact_x;
        let error_y = request.target_y - contact_y;
        if error_x.hypot(error_y) <= 0.5 {
            break;
        }
        window
            .set_position(LogicalPosition::new(
                position.x + error_x,
                position.y + error_y,
            ))
            .map_err(|error| error.to_string())?;
        thread::sleep(Duration::from_millis(8));

        // AppKit constrains ordinary window moves to the work area. Browser
        // tab close controls live inside the menu-bar strip, so a compact pet
        // panel can otherwise stop exactly one title-bar height too low. Only
        // bypass that constraint when the requested move still has a measured
        // residual after Tauri accepted it.
        #[cfg(target_os = "macos")]
        {
            let accepted = current_pet_logical_position(&window)?;
            let desired = LogicalPosition::new(position.x + error_x, position.y + error_y);
            if (accepted.x - desired.x).hypot(accepted.y - desired.y) > 0.5 {
                set_pet_position_unconstrained(&app, &window, desired)?;
                thread::sleep(Duration::from_millis(8));
            }
        }
    }

    let position = current_pet_logical_position(&window)?;
    let contact_x = position.x + request.anchor_x;
    let contact_y = position.y + request.anchor_y;
    let error_x = request.target_x - contact_x;
    let error_y = request.target_y - contact_y;
    let alignment = PetModeContactAlignment {
        target_x: request.target_x,
        target_y: request.target_y,
        contact_x,
        contact_y,
        error_x,
        error_y,
        error_distance: error_x.hypot(error_y),
        attempts,
        diagnostic: request.diagnostic,
    };
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("pet-mode-alignment", &alignment);
    }
    Ok(alignment)
}

#[cfg(target_os = "macos")]
fn set_pet_position_unconstrained(
    app: &AppHandle,
    window: &WebviewWindow,
    desired: LogicalPosition<f64>,
) -> Result<(), String> {
    let current = current_pet_logical_position(window)?;
    let delta_x = desired.x - current.x;
    let delta_y = desired.y - current.y;
    let window_for_main = window.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);

    app.run_on_main_thread(move || {
        let result = (|| {
            let ptr = window_for_main.ns_window().ok()?;
            // Safe: this runs on AppKit's main thread and Tauri retains the
            // NSWindow for the lifetime of `window_for_main`.
            let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
            let frame = ns_window.frame();
            ns_window.setFrameOrigin(NSPoint::new(
                frame.origin.x + delta_x,
                frame.origin.y - delta_y,
            ));
            Some(())
        })();
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv_timeout(Duration::from_millis(250))
        .map_err(|_| "Pet Mode native contact move timed out".to_string())?
        .ok_or_else(|| "Pet Mode native contact move is unavailable".to_string())
}

#[tauri::command]
pub fn pet_mode_report_contact(
    app: AppHandle,
    id: String,
    contacted: Option<bool>,
) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.emit(
            "pet-mode-contact",
            json!({ "id": id, "contacted": contacted.unwrap_or(true) }),
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pet_mode_report_pointer(app: AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        main.emit("pet-mode-pointer", json!({ "at": at }))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn pet_mode_return_home(app: AppHandle) -> Result<(), String> {
    async_runtime::spawn_blocking(move || {
        let window = app
            .get_webview_window(PET_MODE_WINDOW_LABEL)
            .ok_or_else(|| "Pet Mode window is not available".to_string())?;
        let is_preview_return = PET_MODE_PREVIEW_RETURN.swap(false, Ordering::Relaxed);
        if is_preview_return {
            let monitor = resolve_pet_home_monitor(&app)
                .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
            let target = PET_MODE_PREVIEW_RETURN_POSITION
                .lock()
                .map_err(|_| "Pet Mode preview position lock is unavailable".to_string())?
                .take()
                .unwrap_or_else(|| calculate_pet_home_position(&monitor));
            animate_pet_window_toward(&window, target, PET_MODE_RUN_SPEED, 0.8, "run")
        } else {
            position_pet_home(&app, &window, true)
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn pet_mode_set_presence(app: AppHandle, visible: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(());
    };
    if visible && PET_MODE_ENABLED.load(Ordering::Relaxed) {
        position_pet_home(&app, &window, false)?;
        window
            .set_ignore_cursor_events(false)
            .map_err(|error| error.to_string())?;
        show_pet_panel(&app, &window)
    } else {
        window
            .set_ignore_cursor_events(true)
            .map_err(|error| error.to_string())?;
        window.hide().map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn pet_mode_set_interactive(app: AppHandle, interactive: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(());
    };
    window
        .set_ignore_cursor_events(!interactive)
        .map_err(|error| error.to_string())
}

/// Resizes the pet panel so the user's size choice changes the pet's real
/// footprint on the desktop, not just how the cat is drawn inside a fixed
/// window. The panel is created with matching min/max bounds to keep it
/// unresizable by the user, so those have to be relaxed before the resize and
/// re-pinned to the new size afterwards.
#[tauri::command]
pub fn pet_mode_set_size(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(());
    };
    if !(width.is_finite() && height.is_finite()) || width <= 0.0 || height <= 0.0 {
        return Err("Pet Mode size must be a positive, finite size".to_string());
    }
    let size = LogicalSize::new(width, height);
    window
        .set_min_size(None::<LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(None::<LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window.set_size(size).map_err(|error| error.to_string())?;
    window
        .set_min_size(Some(size))
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(Some(size))
        .map_err(|error| error.to_string())?;
    // Placement math reads this rather than the base constants, so it has to
    // land before the next move, roam, or clamp runs.
    if let Ok(mut current) = PET_MODE_SIZE.lock() {
        *current = (width, height);
    }
    Ok(())
}

#[tauri::command]
pub async fn pet_mode_begin_drag(
    app: AppHandle,
    start_client_x: f64,
    start_client_y: f64,
    pickup_delay_ms: u64,
) -> Result<PetModeNativeDragResult, String> {
    // Capture and cancellation share one native command boundary. The
    // best-effort renderer-side cancellation may race this invoke; doing it
    // here guarantees an in-flight walk cannot fight the manual pointer.
    cancel_pet_motion();
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let before = current_pet_logical_position(&window)?;
    #[cfg(debug_assertions)]
    eprintln!(
        "[pet-mode-drag] begin client=({start_client_x:.1},{start_client_y:.1}) window={before:?}"
    );
    // Pointer tracking lasts for the full mouse gesture. Keep it off Tauri's
    // command/main execution path so WebKit can composite the reviewed pickup
    // frames while the native panel follows the cursor.
    let drag_app = app.clone();
    let drag_window = window.clone();
    let moved = tauri::async_runtime::spawn_blocking(move || {
        perform_pet_panel_drag(
            &drag_app,
            &drag_window,
            start_client_x,
            start_client_y,
            pickup_delay_ms,
        )
    })
    .await
    .map_err(|error| format!("Pet Mode drag task failed: {error}"))??;
    let after = current_pet_logical_position(&window)?;
    #[cfg(debug_assertions)]
    {
        eprintln!("[pet-mode-drag] end window={after:?} moved={moved}");
    }
    let result = PetModeNativeDragResult {
        moved,
        start_x: before.x,
        start_y: before.y,
        end_x: after.x,
        end_y: after.y,
    };
    // Emit from the native completion boundary as well as returning the
    // command result. A moved non-activating panel can delay the WebKit invoke
    // callback even though the global mouse button is already up; this event
    // lets the renderer begin its reviewed release immediately and is safe to
    // receive twice because the web state machine is idempotent.
    window
        .emit("pet-mode-drag-end", &result)
        .map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn pet_mode_report_drag_error(_error: String) {
    #[cfg(debug_assertions)]
    eprintln!("[pet-mode-drag] webview invoke failed: {_error}");
}

#[tauri::command]
pub fn pet_mode_cursor_inside(app: AppHandle) -> bool {
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return false;
    };
    matches!(window.is_visible(), Ok(true))
        && matches!(
            (
                app.cursor_position(),
                window.outer_position(),
                window.outer_size(),
            ),
            (Ok(cursor), Ok(position), Ok(size)) if is_cursor_inside_pet_rect(cursor, (position, size))
        )
}

#[tauri::command]
pub fn pet_mode_input_bounds(app: AppHandle) -> Result<PetModeInputBounds, String> {
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    Ok(PetModeInputBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        visible: window.is_visible().unwrap_or(false),
    })
}

#[tauri::command]
pub fn pet_mode_lab_place_center(app: AppHandle) -> Result<PetModeInputBounds, String> {
    if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Err("Pet Mode is disabled".to_string());
    }
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| resolve_pet_home_monitor(&app))
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(scale_factor);
    let work_size = work_area.size.to_logical::<f64>(scale_factor);
    let target = calculate_pet_center_position(work_position, work_size.width, work_size.height);
    cancel_pet_motion();
    window
        .set_position(target)
        .map_err(|error| error.to_string())?;
    // Exercise the same resident-home policy as a completed manual drag. The
    // center drop must remain temporary rather than replacing the upper lane.
    pet_mode_remember_position(app.clone())?;
    pet_mode_input_bounds(app)
}

#[tauri::command]
pub async fn pet_mode_roam(app: AppHandle) -> Result<(), String> {
    async_runtime::spawn_blocking(move || {
        if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
            return Ok(());
        }
        let window = app
            .get_webview_window(PET_MODE_WINDOW_LABEL)
            .ok_or_else(|| "Pet Mode window is not available".to_string())?;
        let monitor = resolve_pet_home_monitor(&app)
            .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
        let target = calculate_pet_roam_position(&monitor);
        animate_pet_window_toward(
            &window,
            target,
            PET_MODE_WALK_SPEED,
            PET_MODE_WALK_MAX_SECONDS,
            "walk",
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pet_mode_exit_screen(app: AppHandle) -> Result<String, String> {
    async_runtime::spawn_blocking(move || {
        if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
            return Err("Pet Mode is disabled".to_string());
        }
        let window = app
            .get_webview_window(PET_MODE_WINDOW_LABEL)
            .ok_or_else(|| "Pet Mode window is not available".to_string())?;
        let monitor = resolve_pet_home_monitor(&app)
            .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
        let start = current_pet_logical_position(&window)?;
        let (side, target) = calculate_pet_exit_position(&monitor, start);
        animate_pet_window_with_facing(
            &window,
            target,
            if side == "left" { "left" } else { "right" },
            PET_MODE_WALK_SPEED,
            PET_MODE_WALK_MAX_SECONDS,
            "walk",
        )?;
        Ok(side.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pet_mode_return_from_outing(app: AppHandle, side: String) -> Result<(), String> {
    async_runtime::spawn_blocking(move || {
        if side != "left" && side != "right" {
            return Err("Invalid Pet Mode outing side".to_string());
        }
        let window = app
            .get_webview_window(PET_MODE_WINDOW_LABEL)
            .ok_or_else(|| "Pet Mode window is not available".to_string())?;
        let monitor = resolve_pet_home_monitor(&app)
            .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
        let start = calculate_pet_outing_return_start(&monitor, &side);
        window
            .set_position(start)
            .map_err(|error| error.to_string())?;
        show_pet_panel(&app, &window)?;
        let target = calculate_pet_home_position(&monitor);
        animate_pet_window_with_facing(
            &window,
            target,
            if side == "left" { "right" } else { "left" },
            PET_MODE_WALK_SPEED,
            PET_MODE_WALK_MAX_SECONDS,
            "walk",
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn pet_mode_remember_position(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let position = current_pet_logical_position(&window)?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| resolve_pet_home_monitor(&app))
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(scale_factor);
    let work_size = work_area.size.to_logical::<f64>(scale_factor);
    let mut preferred = PET_MODE_PREFERRED_POSITION
        .lock()
        .map_err(|_| "Pet Mode position lock is unavailable".to_string())?;
    *preferred = preferred_pet_position_after_drop(
        *preferred,
        position,
        work_position,
        work_size.width,
        work_size.height,
    );
    Ok(())
}

fn move_pet_to_target(
    app: &AppHandle,
    target: &PetModeInterventionTarget,
) -> Result<PetModeResolvedTarget, String> {
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let home_monitor = resolve_pet_home_monitor(app)
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    if target.preview {
        return move_pet_to_preview_target(&window, &home_monitor);
    }
    if target.lab_target == Some(PetModeLabTargetKind::BrowserTabX) {
        activate_lab_target_app(&target.app_name)?;
    }
    let point = if target.lab_target == Some(PetModeLabTargetKind::DriftyWindowX) {
        resolve_drifty_lab_window_close_point(app)?
    } else {
        resolve_pet_target_point(&home_monitor, target)
    };
    let permits_visual_fallback = target.preview;
    if !should_animate_to_target(point.kind, permits_visual_fallback) {
        return Ok(PetModeResolvedTarget {
            facing: "right",
            target_kind: point.kind,
            confidence: point.confidence,
            diagnostic: point.diagnostic,
            target_x: point.x,
            target_y: point.y,
        });
    }
    let monitor = if point.kind == PetModeTargetKind::Fallback {
        home_monitor
    } else {
        app.monitor_from_point(point.x, point.y)
            .ok()
            .flatten()
            .unwrap_or(home_monitor)
    };
    let current = current_pet_logical_position(&window)?;
    let facing = if point.x >= current.x + pet_width() / 2.0 {
        "right"
    } else {
        "left"
    };
    let target_position = calculate_pet_contact_position(&monitor, &point, facing);

    // Unlike the old click-through overlay, the pet keeps owning pointer input
    // while it runs. The actual close action is performed by the native nudge
    // bridge after the contact frame, so the pet never needs to pass a user's
    // click into Drifty's main dashboard while crossing the target.
    animate_pet_window_with_facing(
        &window,
        target_position,
        facing,
        PET_MODE_RUN_SPEED,
        PET_MODE_RUN_MAX_SECONDS,
        "run",
    )?;

    Ok(PetModeResolvedTarget {
        facing,
        target_kind: point.kind,
        confidence: point.confidence,
        diagnostic: point.diagnostic,
        target_x: point.x,
        target_y: point.y,
    })
}

fn move_pet_to_preview_target(
    window: &WebviewWindow,
    monitor: &Monitor,
) -> Result<PetModeResolvedTarget, String> {
    let current = current_pet_logical_position(window)?;
    *PET_MODE_PREVIEW_RETURN_POSITION
        .lock()
        .map_err(|_| "Pet Mode preview position lock is unavailable".to_string())? = Some(current);
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(scale_factor);
    let work_size = work_area.size.to_logical::<f64>(scale_factor);
    let available_right = work_position.x + work_size.width - (current.x + pet_width());
    let available_left = current.x - work_position.x;
    let offset: f64 = if available_right >= 152.0 || available_right >= available_left {
        152.0
    } else {
        -152.0
    };
    let facing = if offset.is_sign_positive() {
        "right"
    } else {
        "left"
    };
    let target_position = clamp_pet_position(
        LogicalPosition::new(current.x + offset, current.y),
        work_position,
        work_size.width,
        work_size.height,
    );
    animate_pet_window_with_facing(
        window,
        target_position,
        facing,
        PET_MODE_RUN_SPEED,
        0.8,
        "run",
    )?;
    Ok(PetModeResolvedTarget {
        facing,
        target_kind: PetModeTargetKind::Fallback,
        confidence: PetModeTargetConfidence::Low,
        diagnostic: "preview_nearby_target".to_string(),
        target_x: target_position.x + pet_contact_offsets(facing).0,
        target_y: target_position.y + pet_contact_offsets(facing).1,
    })
}

fn resolve_pet_target_point(
    monitor: &Monitor,
    target: &PetModeInterventionTarget,
) -> PetModeTargetPoint {
    #[cfg(target_os = "macos")]
    {
        if let Some(point) = resolve_macos_accessibility_target(target) {
            // The Browser X Lab promises a tab-close target. Falling through
            // to the browser window's red traffic-light X makes the automatic
            // tab close succeed while the paw visibly points at the wrong UI.
            if target.lab_target == Some(PetModeLabTargetKind::BrowserTabX)
                && point.kind != PetModeTargetKind::BrowserTabClose
            {
                return fallback_target_point(monitor, "browser_tab_close_ax_unavailable");
            }
            return point;
        }
    }

    fallback_target_point(monitor, "accessibility_target_unavailable")
}

fn resolve_drifty_lab_window_close_point(app: &AppHandle) -> Result<PetModeTargetPoint, String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(point) = resolve_native_drifty_window_close_target(app) {
            return Ok(point);
        }
        let process_name = std::env::current_exe()
            .ok()
            .and_then(|path| {
                path.file_stem()
                    .map(|name| name.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "drifty".to_string());
        if let Some(point) = resolve_drifty_window_close_target(&process_name) {
            return Ok(point);
        }
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Drifty main window is not available".to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale_factor);
    Ok(PetModeTargetPoint {
        x: position.x + 14.0,
        y: position.y + 14.0,
        kind: PetModeTargetKind::WindowClose,
        confidence: PetModeTargetConfidence::High,
        diagnostic: "tauri_window_close_fallback".to_string(),
    })
}

#[cfg(target_os = "macos")]
fn resolve_native_drifty_window_close_target(app: &AppHandle) -> Option<PetModeTargetPoint> {
    let window = app.get_webview_window("main")?;
    let scale_factor = window.scale_factor().ok()?;
    let outer_position = window
        .outer_position()
        .ok()?
        .to_logical::<f64>(scale_factor);
    let window_for_main = window.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);

    app.run_on_main_thread(move || {
        let offsets = (|| {
            let ptr = window_for_main.ns_window().ok()?;
            // Safe: this closure runs on AppKit's main thread and Tauri keeps
            // the NSWindow alive for the lifetime of `window_for_main`.
            let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
            let button = ns_window.standardWindowButton(NSWindowButton::CloseButton)?;
            let button_rect_in_window = button.convertRect_toView(button.bounds(), None::<&NSView>);
            let button_rect_on_screen = ns_window.convertRectToScreen(button_rect_in_window);
            let window_frame = ns_window.frame();
            let center_x = button_rect_on_screen.origin.x + button_rect_on_screen.size.width / 2.0;
            let center_y = button_rect_on_screen.origin.y + button_rect_on_screen.size.height / 2.0;
            Some((
                center_x - window_frame.origin.x,
                window_frame.size.height - (center_y - window_frame.origin.y),
            ))
        })();
        let _ = sender.send(offsets);
    })
    .ok()?;

    let (offset_x, offset_y) = receiver.recv_timeout(Duration::from_millis(250)).ok()??;
    Some(PetModeTargetPoint {
        x: outer_position.x + offset_x,
        y: outer_position.y + offset_y,
        kind: PetModeTargetKind::WindowClose,
        confidence: PetModeTargetConfidence::High,
        diagnostic: "native_nswindow_close".to_string(),
    })
}

#[cfg(target_os = "macos")]
fn resolve_drifty_window_close_target(process_name: &str) -> Option<PetModeTargetPoint> {
    let script = drifty_window_close_geometry_script(process_name);
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_pet_target_output(String::from_utf8_lossy(&output.stdout).trim())
}

#[cfg(target_os = "macos")]
fn drifty_window_close_geometry_script(process_name: &str) -> String {
    let process_name = applescript_string_literal(process_name);
    format!(
        r#"tell application "System Events"
  if not (exists process "{process_name}") then return "not_found"
  tell process "{process_name}"
    repeat with candidateWindow in windows
      try
        set windowClose to first button of candidateWindow whose subrole is "AXCloseButton"
        set buttonPosition to position of windowClose
        set buttonSize to size of windowClose
        set centerX to (item 1 of buttonPosition) + ((item 1 of buttonSize) / 2)
        set centerY to (item 2 of buttonPosition) + ((item 2 of buttonSize) / 2)
        return "window_close|" & centerX & "|" & centerY & "|high|ax_drifty_window_close"
      end try
    end repeat
  end tell
end tell
return "not_found""#,
    )
}

fn fallback_target_point(monitor: &Monitor, diagnostic: &str) -> PetModeTargetPoint {
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    PetModeTargetPoint {
        x: position.x + size.width - PET_MODE_FALLBACK_TARGET_INSET,
        y: position.y + PET_MODE_FALLBACK_TARGET_INSET,
        kind: PetModeTargetKind::Fallback,
        confidence: PetModeTargetConfidence::Low,
        diagnostic: diagnostic.to_string(),
    }
}

fn is_cursor_inside_pet_rect(cursor: Point<f64>, rect: (Point<i32>, Size<u32>)) -> bool {
    let (rect_position, rect_size) = rect;
    let left = f64::from(rect_position.x);
    let top = f64::from(rect_position.y);
    let right = left + f64::from(rect_size.width);
    let bottom = top + f64::from(rect_size.height);
    (left..=right).contains(&cursor.x) && (top..=bottom).contains(&cursor.y)
}

#[cfg(target_os = "macos")]
fn resolve_macos_accessibility_target(
    target: &PetModeInterventionTarget,
) -> Option<PetModeTargetPoint> {
    let search_selected_tab = target.browser_name.as_deref().is_some()
        || target.lab_target == Some(PetModeLabTargetKind::BrowserTabX);
    if search_selected_tab {
        if let Some(point) = pet_mode_native_ax::resolve_selected_browser_tab_close(
            &target.app_name,
            target.browser_name.as_deref(),
        ) {
            return Some(point);
        }
    }

    let script = pet_target_geometry_script(&target.app_name, search_selected_tab, !target.preview);
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_pet_target_output(String::from_utf8_lossy(&output.stdout).trim())
}

#[cfg(target_os = "macos")]
fn pet_target_geometry_script(
    app_name: &str,
    search_selected_tab: bool,
    require_frontmost: bool,
) -> String {
    let infer_close_x = if app_name.to_ascii_lowercase().contains("safari") {
        "(item 1 of tabPosition) + 14"
    } else {
        "(item 1 of tabPosition) + (item 1 of tabSize) - 14"
    };
    let app_name = applescript_string_literal(app_name);
    let tab_scan = if search_selected_tab {
        "repeat with candidateWindow in windows\n        set visitedCount to 0\n        my scanForSelectedTabClose(candidateWindow, false)\n        if foundTarget is not \"\" then return foundTarget\n      end repeat\n      if inferredTarget is not \"\" then return inferredTarget"
    } else {
        ""
    };
    let frontmost_guard = if require_frontmost {
        "if frontmost is false then return \"not_frontmost\""
    } else {
        ""
    };
    format!(
        r#"property foundTarget : ""
property inferredTarget : ""
property visitedCount : 0
property maxVisited : {PET_MODE_AX_SCAN_LIMIT}

tell application "System Events"
  if not (exists process "{app_name}") then return "not_found"
  tell process "{app_name}"
    {frontmost_guard}
    if not (exists front window) then return "no_front_window"
    set foundTarget to ""
    set inferredTarget to ""
    set visitedCount to 0
    try
      {tab_scan}
    end try
    try
      set windowClose to first button of front window whose subrole is "AXCloseButton"
      set buttonPosition to position of windowClose
      set buttonSize to size of windowClose
      set centerX to (item 1 of buttonPosition) + ((item 1 of buttonSize) / 2)
      set centerY to (item 2 of buttonPosition) + ((item 2 of buttonSize) / 2)
      return "window_close|" & centerX & "|" & centerY & "|high|ax_window_close"
    end try
    try
      set windowPosition to position of front window
      return "window_close|" & ((item 1 of windowPosition) + 14) & "|" & ((item 2 of windowPosition) + 14) & "|medium|ax_window_origin_fallback"
    end try
  end tell
end tell
return "not_found"

on scanForSelectedTabClose(theElement, insideSelectedTab)
  if foundTarget is not "" then return
  if visitedCount is greater than maxVisited then return
  set visitedCount to visitedCount + 1
  tell application "System Events"
    set roleText to ""
    set descriptionText to ""
    set titleText to ""
    set selectedHere to insideSelectedTab
    set isSelectedTab to false
    try
      set roleText to role of theElement as text
    end try
    if roleText is "AXWebArea" or roleText is "AXMenuBar" or roleText is "AXMenu" or roleText is "AXMenuItem" then return
    if roleText is "AXRadioButton" or roleText is "AXTab" then
      try
        if value of attribute "AXSelected" of theElement is true then set isSelectedTab to true
      end try
      try
        set elementValue to value of theElement
        if elementValue is 1 or elementValue is "1" or elementValue is true or elementValue is "on" then set isSelectedTab to true
      end try
      if isSelectedTab is true then
        set selectedHere to true
        try
          set tabPosition to position of theElement
          set tabSize to size of theElement
          set inferredX to {infer_close_x}
          set inferredY to (item 2 of tabPosition) + ((item 2 of tabSize) / 2)
          set inferredTarget to "browser_tab_close|" & inferredX & "|" & inferredY & "|medium|ax_selected_tab_edge"
        end try
      end if
    end if
    if roleText is "AXButton" and selectedHere is true then
      try
        set descriptionText to description of theElement as text
      end try
      try
        set titleText to title of theElement as text
      end try
      if descriptionText contains "Close" or descriptionText contains "close" or descriptionText contains "닫기" or titleText contains "Close" or titleText contains "close" or titleText contains "닫기" then
        try
          set buttonPosition to position of theElement
          set buttonSize to size of theElement
          set centerX to (item 1 of buttonPosition) + ((item 1 of buttonSize) / 2)
          set centerY to (item 2 of buttonPosition) + ((item 2 of buttonSize) / 2)
          set foundTarget to "browser_tab_close|" & centerX & "|" & centerY & "|high|ax_selected_tab_close"
          return
        end try
      end if
    end if
    try
      repeat with childElement in UI elements of theElement
        my scanForSelectedTabClose(childElement, selectedHere)
        if foundTarget is not "" then exit repeat
        if visitedCount is greater than maxVisited then exit repeat
      end repeat
    end try
  end tell
end scanForSelectedTabClose"#,
    )
}

fn parse_pet_target_output(output: &str) -> Option<PetModeTargetPoint> {
    let mut parts = output.trim().split('|');
    let kind = match parts.next()? {
        "browser_tab_close" => PetModeTargetKind::BrowserTabClose,
        "window_close" => PetModeTargetKind::WindowClose,
        _ => return None,
    };
    let x = parts.next()?.parse::<f64>().ok()?;
    let y = parts.next()?.parse::<f64>().ok()?;
    if !x.is_finite() || !y.is_finite() {
        return None;
    }
    let confidence = match parts.next()? {
        "high" => PetModeTargetConfidence::High,
        "medium" => PetModeTargetConfidence::Medium,
        _ => PetModeTargetConfidence::Low,
    };
    let diagnostic = parts.next().unwrap_or("ax_target").trim().to_string();
    Some(PetModeTargetPoint {
        x,
        y,
        kind,
        confidence,
        diagnostic,
    })
}

fn calculate_pet_contact_position(
    monitor: &Monitor,
    point: &PetModeTargetPoint,
    facing: &str,
) -> LogicalPosition<f64> {
    let scale_factor = monitor.scale_factor();
    // Window and browser close controls live above the macOS work area. During
    // an intervention the panel may temporarily enter that title-bar strip;
    // clamping to `work_area()` leaves the paw roughly one menu-bar height below
    // every top-edge X even when AX resolved the button perfectly.
    let screen_position = monitor.position().to_logical::<f64>(scale_factor);
    let screen_size = monitor.size().to_logical::<f64>(scale_factor);
    calculate_pet_contact_position_in_bounds(
        point,
        facing,
        screen_position,
        screen_size.width,
        screen_size.height,
    )
}

fn calculate_pet_contact_position_in_bounds(
    point: &PetModeTargetPoint,
    facing: &str,
    screen_position: LogicalPosition<f64>,
    screen_width: f64,
    screen_height: f64,
) -> LogicalPosition<f64> {
    let (contact_x, contact_y) = pet_contact_offsets(facing);
    clamp_pet_position(
        LogicalPosition::new(point.x - contact_x, point.y - contact_y),
        screen_position,
        screen_width,
        screen_height,
    )
}

fn position_pet_home(
    app: &AppHandle,
    window: &WebviewWindow,
    animated: bool,
) -> Result<(), String> {
    let monitor = resolve_pet_home_monitor(app)
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    let target = calculate_pet_home_position(&monitor);
    if animated {
        animate_pet_window_toward(
            window,
            target,
            PET_MODE_WALK_SPEED,
            PET_MODE_WALK_MAX_SECONDS,
            "walk",
        )
    } else {
        window
            .set_position(target)
            .map_err(|error| error.to_string())
    }
}

fn calculate_pet_home_position(monitor: &Monitor) -> LogicalPosition<f64> {
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    if let Ok(preferred) = PET_MODE_PREFERRED_POSITION.lock() {
        if let Some(preferred) = *preferred {
            return clamp_pet_position(preferred, position, size.width, size.height);
        }
    }
    let x = position.x + ((size.width - pet_width()) * 0.28).max(0.0);
    clamp_pet_position(
        LogicalPosition::new(x, position.y + PET_MODE_HOME_Y),
        position,
        size.width,
        size.height,
    )
}

fn calculate_pet_roam_position(monitor: &Monitor) -> LogicalPosition<f64> {
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    let home = calculate_pet_home_position(monitor);
    let move_right = PET_MODE_ROAM_RIGHT.fetch_xor(true, Ordering::Relaxed);
    let direction = if move_right { 1.0 } else { -1.0 };
    let travel = (size.width * 0.22).clamp(180.0, 320.0);
    clamp_pet_position(
        LogicalPosition::new(home.x + direction * travel, home.y),
        position,
        size.width,
        size.height,
    )
}

fn calculate_pet_exit_position(
    monitor: &Monitor,
    start: LogicalPosition<f64>,
) -> (&'static str, LogicalPosition<f64>) {
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    let center = position.x + size.width / 2.0;
    let side = if start.x + pet_width() / 2.0 < center {
        "left"
    } else {
        "right"
    };
    let x = if side == "left" {
        position.x - pet_width() - 12.0
    } else {
        position.x + size.width + 12.0
    };
    let y = start.y.clamp(
        position.y,
        position.y + (size.height - pet_height()).max(0.0),
    );
    (side, LogicalPosition::new(x, y))
}

fn calculate_pet_outing_return_start(monitor: &Monitor, side: &str) -> LogicalPosition<f64> {
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    let home = calculate_pet_home_position(monitor);
    let x = if side == "left" {
        position.x - pet_width() - 12.0
    } else {
        position.x + size.width + 12.0
    };
    LogicalPosition::new(x, home.y)
}

fn clamp_pet_position(
    target: LogicalPosition<f64>,
    work_position: LogicalPosition<f64>,
    work_width: f64,
    work_height: f64,
) -> LogicalPosition<f64> {
    let max_x = work_position.x + (work_width - pet_width()).max(0.0);
    let max_y = work_position.y + (work_height - pet_height()).max(0.0);
    LogicalPosition::new(
        target.x.clamp(work_position.x, max_x),
        target.y.clamp(work_position.y, max_y),
    )
}

fn calculate_pet_center_position(
    work_position: LogicalPosition<f64>,
    work_width: f64,
    work_height: f64,
) -> LogicalPosition<f64> {
    clamp_pet_position(
        LogicalPosition::new(
            work_position.x + (work_width - pet_width()).max(0.0) / 2.0,
            work_position.y + (work_height - pet_height()).max(0.0) / 2.0,
        ),
        work_position,
        work_width,
        work_height,
    )
}

fn preferred_pet_position_after_drop(
    current: Option<LogicalPosition<f64>>,
    candidate: LogicalPosition<f64>,
    work_position: LogicalPosition<f64>,
    work_width: f64,
    work_height: f64,
) -> Option<LogicalPosition<f64>> {
    let candidate = clamp_pet_position(candidate, work_position, work_width, work_height);
    let candidate_center_y = candidate.y + pet_height() / 2.0;
    let resident_band_bottom = work_position.y + work_height * PET_MODE_RESIDENT_BAND_RATIO;
    if candidate_center_y <= resident_band_bottom {
        Some(candidate)
    } else {
        current
    }
}

fn current_pet_logical_position(window: &WebviewWindow) -> Result<LogicalPosition<f64>, String> {
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    Ok(position.to_logical::<f64>(scale_factor))
}

fn animate_pet_window_toward(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    speed: f64,
    max_duration_seconds: f64,
    motion: &'static str,
) -> Result<(), String> {
    let start = current_pet_logical_position(window)?;
    let facing = if target.x >= start.x { "right" } else { "left" };
    animate_pet_window_with_facing(window, target, facing, speed, max_duration_seconds, motion)
}

fn animate_pet_window_with_facing(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    facing: &'static str,
    speed: f64,
    max_duration_seconds: f64,
    motion: &'static str,
) -> Result<(), String> {
    let motion_revision = PET_MODE_MOTION_REVISION.fetch_add(1, Ordering::Relaxed) + 1;
    emit_pet_event(window, json!({ "kind": "facing", "facing": facing }))?;
    emit_pet_event(window, json!({ "kind": "motion", "motion": motion }))?;
    // Give the webview one paint boundary to flip before the native window moves.
    thread::sleep(Duration::from_millis(34));
    animate_pet_window(window, target, speed, max_duration_seconds, motion_revision)
}

fn animate_pet_window(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    speed: f64,
    max_duration_seconds: f64,
    motion_revision: u64,
) -> Result<(), String> {
    let start = current_pet_logical_position(window)?;
    let distance = ((target.x - start.x).powi(2) + (target.y - start.y).powi(2)).sqrt();
    if distance < 1.0 {
        return window
            .set_position(target)
            .map_err(|error| error.to_string());
    }
    let duration_seconds = movement_duration_seconds(distance, speed, max_duration_seconds);
    let duration = Duration::from_secs_f64(duration_seconds);
    let started_at = Instant::now();
    loop {
        if PET_MODE_MOTION_REVISION.load(Ordering::Relaxed) != motion_revision {
            return Ok(());
        }
        let progress = (started_at.elapsed().as_secs_f64() / duration_seconds).min(1.0);
        window
            .set_position(LogicalPosition::new(
                start.x + (target.x - start.x) * progress,
                start.y + (target.y - start.y) * progress,
            ))
            .map_err(|error| error.to_string())?;
        if progress >= 1.0 {
            break;
        }
        let elapsed = started_at.elapsed();
        let remaining = duration.saturating_sub(elapsed);
        thread::sleep(remaining.min(Duration::from_micros(16_667)));
    }
    Ok(())
}

fn cancel_pet_motion() {
    PET_MODE_MOTION_REVISION.fetch_add(1, Ordering::Relaxed);
}

fn movement_duration_seconds(distance: f64, speed: f64, max_duration_seconds: f64) -> f64 {
    (distance / speed).clamp(0.18, max_duration_seconds)
}

fn should_animate_to_target(kind: PetModeTargetKind, preview: bool) -> bool {
    preview || kind != PetModeTargetKind::Fallback
}

fn resolve_pet_home_monitor(app: &AppHandle) -> Option<Monitor> {
    if PET_MODE_PREFERRED_POSITION
        .lock()
        .map(|position| position.is_some())
        .unwrap_or(false)
    {
        if let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
            if let Ok(Some(monitor)) = window.current_monitor() {
                return Some(monitor);
            }
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = window.current_monitor() {
            return Some(monitor);
        }
    }
    if let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
        if let Ok(Some(monitor)) = window.current_monitor() {
            return Some(monitor);
        }
    }
    if let Ok(cursor) = app.cursor_position() {
        let scale_factor = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|monitor| monitor.scale_factor())
            .unwrap_or(1.0);
        let cursor = cursor.to_logical::<f64>(scale_factor);
        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            return Some(monitor);
        }
    }
    app.primary_monitor().ok().flatten()
}

fn emit_pet_event(window: &WebviewWindow, payload: Value) -> Result<(), String> {
    window
        .emit("pet-mode-event", payload)
        .map_err(|error| error.to_string())
}

fn applescript_string_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn activate_lab_target_app(app_name: &str) -> Result<(), String> {
    let app_name = applescript_string_literal(app_name);
    let script = format!(
        r#"tell application "{app_name}" to activate
delay 0.12
return "activated""#
    );
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|error| format!("Unable to activate Pet Mode Lab browser: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Unable to activate Pet Mode Lab browser: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn close_lab_browser_active_tab(browser_name: &str) -> Result<String, String> {
    let script = lab_browser_tab_close_script(browser_name)?;
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|error| format!("Unable to press browser tab X: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Unable to press browser tab X: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if result == "closed_browser_tab" {
        Ok(result)
    } else {
        Err(format!("Browser tab X did not report closure: {result}"))
    }
}

fn lab_browser_tab_close_script(browser_name: &str) -> Result<String, String> {
    let browser_name = applescript_string_literal(browser_name);
    Ok(match browser_name.as_str() {
        "Google Chrome"
        | "Google Chrome Canary"
        | "Microsoft Edge"
        | "Arc"
        | "Aside"
        | "Brave Browser"
        | "Chromium" => format!(
            r#"tell application "{browser_name}"
  if not (exists front window) then error "no_front_window"
  close active tab of front window
end tell
return "closed_browser_tab""#
        ),
        "Safari" | "Safari Technology Preview" => format!(
            r#"tell application "{browser_name}"
  if not (exists front window) then error "no_front_window"
  close current tab of front window
end tell
return "closed_browser_tab""#
        ),
        "Firefox" => format!(
            r#"tell application "System Events"
  tell process "{browser_name}"
    if not (exists front window) then error "no_front_window"
    set frontmost to true
    keystroke "w" using command down
  end tell
end tell
return "closed_browser_tab""#
        ),
        _ => {
            return Err(format!(
                "Unsupported browser for the tab-X test: {browser_name}"
            ))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_selected_browser_tab_close_geometry() {
        let point =
            parse_pet_target_output("browser_tab_close|612.5|74|high|ax_selected_tab_close")
                .unwrap();
        assert_eq!(point.kind, PetModeTargetKind::BrowserTabClose);
        assert_eq!(point.confidence, PetModeTargetConfidence::High);
        assert_eq!(point.x, 612.5);
        assert_eq!(point.y, 74.0);
    }

    #[test]
    fn rejects_non_finite_or_unstructured_target_output() {
        assert!(parse_pet_target_output("not_found").is_none());
        assert!(parse_pet_target_output("window_close|NaN|40|high|bad").is_none());
    }

    #[test]
    fn clamps_compact_pet_window_inside_work_area() {
        let position = clamp_pet_position(
            LogicalPosition::new(1400.0, -100.0),
            LogicalPosition::new(0.0, 25.0),
            1440.0,
            775.0,
        );
        assert_eq!(position.x, 1296.0);
        assert_eq!(position.y, 25.0);
    }

    #[test]
    fn only_upper_band_drops_redefine_the_resident_home() {
        let work_position = LogicalPosition::new(0.0, 25.0);
        let original_home = Some(LogicalPosition::new(320.0, 60.0));
        let upper_drop = LogicalPosition::new(520.0, 180.0);
        let middle_drop = LogicalPosition::new(700.0, 410.0);

        assert_eq!(
            preferred_pet_position_after_drop(
                original_home,
                upper_drop,
                work_position,
                1440.0,
                775.0,
            ),
            Some(upper_drop),
        );
        assert_eq!(
            preferred_pet_position_after_drop(
                original_home,
                middle_drop,
                work_position,
                1440.0,
                775.0,
            ),
            original_home,
        );
        assert_eq!(
            preferred_pet_position_after_drop(None, middle_drop, work_position, 1440.0, 775.0,),
            None,
        );

        let center = calculate_pet_center_position(work_position, 1440.0, 775.0);
        assert_eq!(center, LogicalPosition::new(648.0, 363.0));
        assert_eq!(
            preferred_pet_position_after_drop(original_home, center, work_position, 1440.0, 775.0,),
            original_home,
        );
    }

    #[test]
    fn cursor_hit_test_includes_pet_edges_and_rejects_points_outside() {
        let rect = (Point::new(100, 24), Size::new(144, 99));
        assert!(is_cursor_inside_pet_rect(Point::new(100.0, 24.0), rect));
        assert!(is_cursor_inside_pet_rect(Point::new(244.0, 123.0), rect));
        assert!(!is_cursor_inside_pet_rect(Point::new(99.9, 24.0), rect));
        assert!(!is_cursor_inside_pet_rect(Point::new(244.1, 123.0), rect));
    }

    #[test]
    fn accessibility_script_prefers_selected_tab_then_window_close() {
        let script = pet_target_geometry_script("Google Chrome", true, true);
        assert!(script.contains("repeat with candidateWindow in windows"));
        assert!(script.contains("scanForSelectedTabClose(candidateWindow, false)"));
        assert!(script.contains("AXSelected"));
        assert!(script.contains("ax_selected_tab_edge"));
        assert!(script.contains("(item 1 of tabPosition) + (item 1 of tabSize) - 14"));
        assert!(script.contains("AXCloseButton"));
        assert!(script.contains(&format!("property maxVisited : {PET_MODE_AX_SCAN_LIMIT}")));
        assert!(script.contains("if frontmost is false then return \"not_frontmost\""));
        assert!(!script.contains("keystroke"));
    }

    #[test]
    fn accessibility_preview_can_inspect_a_background_browser_without_closing_it() {
        let script = pet_target_geometry_script("Aside", true, false);
        assert!(!script.contains("if frontmost is false then return \"not_frontmost\""));
        assert!(script.contains("scanForSelectedTabClose(candidateWindow, false)"));
        assert!(!script.contains("keystroke"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn drifty_close_geometry_scans_all_windows_instead_of_the_pet_front_window() {
        let script = drifty_window_close_geometry_script("drifty");
        assert!(script.contains("repeat with candidateWindow in windows"));
        assert!(script.contains("first button of candidateWindow"));
        assert!(script.contains("ax_drifty_window_close"));
        assert!(!script.contains("front window"));
    }

    #[test]
    fn safari_infers_its_left_edge_tab_close_position() {
        let script = pet_target_geometry_script("Safari", true, true);
        assert!(script.contains("set inferredX to (item 1 of tabPosition) + 14"));
    }

    #[test]
    fn accessibility_script_escapes_process_name() {
        let process_name = "Odd \"Browser";
        let escaped = applescript_string_literal(process_name);
        let script = pet_target_geometry_script(process_name, false, true);
        assert_eq!(escaped, "Odd \\\"Browser");
        assert!(script.contains(&format!("process \"{escaped}\"")));
    }

    #[test]
    fn lab_browser_x_scripts_close_only_the_active_tab_for_supported_browsers() {
        let chromium = lab_browser_tab_close_script("Aside").unwrap();
        assert!(chromium.contains("close active tab of front window"));
        assert!(!chromium.contains("quit"));

        let safari = lab_browser_tab_close_script("Safari").unwrap();
        assert!(safari.contains("close current tab of front window"));

        let firefox = lab_browser_tab_close_script("Firefox").unwrap();
        assert!(firefox.contains("keystroke \"w\" using command down"));
        assert!(lab_browser_tab_close_script("Unknown Browser").is_err());
    }

    #[test]
    fn sixty_percent_cat_keeps_contact_anchor_on_the_scaled_paw() {
        assert!((PET_MODE_WIDTH - 144.0).abs() < f64::EPSILON);
        assert!((PET_MODE_HEIGHT - 99.0).abs() < f64::EPSILON);
        assert!((PET_MODE_CONTACT_X_RIGHT - 143.0).abs() < f64::EPSILON);
        assert!((PET_MODE_CONTACT_X_LEFT - 1.0).abs() < f64::EPSILON);
        assert!((PET_MODE_CONTACT_Y - 40.0).abs() < f64::EPSILON);
    }

    #[test]
    fn clamping_follows_the_selected_pet_size() {
        // Placement used to assume a fixed 144x99 panel. Once size became a
        // user setting that let an enlarged pet clamp against a right edge
        // computed for a smaller window and hang off the screen.
        let work_position = LogicalPosition::new(0.0, 0.0);
        let (work_width, work_height) = (1512.0, 982.0);
        let far_off_screen = LogicalPosition::new(9999.0, 9999.0);

        for (width, height) in [(72.0, 50.0), (144.0, 99.0), (180.0, 124.0)] {
            *PET_MODE_SIZE.lock().unwrap() = (width, height);
            let clamped =
                clamp_pet_position(far_off_screen, work_position, work_width, work_height);
            assert!(
                clamped.x + width <= work_width + f64::EPSILON,
                "{width}x{height} pet overflows the right edge by {}",
                clamped.x + width - work_width
            );
            assert!(
                clamped.y + height <= work_height + f64::EPSILON,
                "{width}x{height} pet overflows the bottom edge by {}",
                clamped.y + height - work_height
            );
        }

        *PET_MODE_SIZE.lock().unwrap() = (PET_MODE_WIDTH, PET_MODE_HEIGHT);
    }

    #[test]
    fn top_edge_x_targets_land_under_the_visible_paw_tip() {
        let bounds = LogicalPosition::new(0.0, 0.0);
        let browser_x = PetModeTargetPoint {
            x: 1200.0,
            y: 57.0,
            kind: PetModeTargetKind::BrowserTabClose,
            confidence: PetModeTargetConfidence::High,
            diagnostic: "browser_x".to_string(),
        };
        let browser_position =
            calculate_pet_contact_position_in_bounds(&browser_x, "right", bounds, 1440.0, 900.0);
        assert!((browser_position.x + PET_MODE_CONTACT_X_RIGHT - browser_x.x).abs() < f64::EPSILON);
        assert!((browser_position.y + PET_MODE_CONTACT_Y - browser_x.y).abs() < f64::EPSILON);

        let window_x = PetModeTargetPoint {
            x: 14.0,
            y: PET_MODE_CONTACT_Y,
            kind: PetModeTargetKind::WindowClose,
            confidence: PetModeTargetConfidence::High,
            diagnostic: "window_x".to_string(),
        };
        let window_position =
            calculate_pet_contact_position_in_bounds(&window_x, "left", bounds, 1440.0, 900.0);
        assert!((window_position.x + PET_MODE_CONTACT_X_LEFT - window_x.x).abs() < f64::EPSILON);
        assert!((window_position.y + PET_MODE_CONTACT_Y - window_x.y).abs() < f64::EPSILON);
    }

    #[test]
    fn real_interventions_never_animate_to_a_fake_fallback_target() {
        assert!(!should_animate_to_target(
            PetModeTargetKind::Fallback,
            false
        ));
        assert!(should_animate_to_target(PetModeTargetKind::Fallback, true));
        assert!(should_animate_to_target(
            PetModeTargetKind::BrowserTabClose,
            false
        ));
    }

    #[test]
    fn approved_walk_speed_uses_wall_clock_duration_without_step_rounding() {
        assert!(
            (movement_duration_seconds(208.0, PET_MODE_WALK_SPEED, 60.0) - 10.0).abs()
                < f64::EPSILON
        );
        assert!(
            (movement_duration_seconds(2.08, PET_MODE_WALK_SPEED, 60.0) - 0.18).abs()
                < f64::EPSILON
        );
    }

    #[test]
    fn preview_actions_accept_active_life_loop_and_tail_wire_values() {
        let life_loop: PetModePreviewAction = serde_json::from_str("\"life_loop\"").unwrap();
        let tail: PetModePreviewAction = serde_json::from_str("\"tail_flick\"").unwrap();
        assert!(matches!(life_loop, PetModePreviewAction::LifeLoop));
        assert!(matches!(tail, PetModePreviewAction::TailFlick));
    }
}
