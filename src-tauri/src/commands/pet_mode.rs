use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    async_runtime, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor,
    PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[cfg(target_os = "macos")]
use core_graphics::{
    display::CGDisplay,
    event::CGEvent,
    event_source::{CGEventSource, CGEventSourceStateID},
    geometry::CGPoint,
};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
#[cfg(target_os = "macos")]
use objc2_foundation::NSPoint;

use super::pet_drop::{
    clamp_floor_home_pt, plan_pet_drop_with_floor_home, plan_pet_shake_floor_drop, PetDropKind,
    PetDropPlan, PetRect, PET_DROP_FLOOR_HOME_PT,
};
use super::pet_drop_windows::{inferred_bottom_dock, list_on_screen_ledges};
use super::pet_hit_region::{
    install_pet_hit_region_monitor, pet_hit_region_pointer_inside,
    refresh_pet_hit_region_for_window, reset_pet_hit_region, set_pet_window_interactive,
};
use super::pet_panel::{
    configure_pet_panel, perform_pet_panel_drag, show_pet_panel, show_pet_panel_at_position,
};

#[cfg(target_os = "macos")]
#[path = "pet_mode_native_ax.rs"]
mod pet_mode_native_ax;
#[cfg(target_os = "macos")]
#[path = "pet_fullscreen.rs"]
mod pet_fullscreen;

pub const PET_MODE_WINDOW_LABEL: &str = "pet-mode";
// Keep the approved 60% cat scale, but include the F12 action's transparent
// side gutters. The source contact point lands at local x ~= 143; the old
// 132-point panel clipped roughly five visible paw pixels at full extension.
const PET_MODE_WIDTH: f64 = 144.0;
const PET_MODE_HEIGHT: f64 = 99.0;
const PET_MODE_HOME_Y: f64 = 14.0;
const PET_MODE_HOME_EDGE_INSET: f64 = 24.0;
// Manual placement stays completely free, but only a drop inside this upper
// screen band redefines the pet's long-term home. A lower drop is temporary:
// the next autonomous walk still targets the remembered upper resident lane.
// This band defines which manual drops become the remembered long-term home.
// AX obstacle safety is intentionally evaluated across the full work area.
const PET_MODE_RESIDENT_BAND_RATIO: f64 = 0.32;
const PET_MODE_RUN_SPEED: f64 = 300.0;
const PET_MODE_WALK_SPEED: f64 = 20.8;
// Manual drops get one compact, same-level walk. At the approved walk speed
// this is just over four seconds, long enough to read without becoming roam.
const PET_MODE_POST_DROP_WALK_DISTANCE: f64 = 84.0;
const PET_MODE_POST_DROP_WALK_MAX_SECONDS: f64 = 5.0;
const PET_MODE_STALK_MIN_DURATION_MS: u64 = 600;
const PET_MODE_STALK_MAX_DURATION_MS: u64 = 8_000;
// Hard ceiling for a distance-scaled chase. The grace above is what the user
// picks; this bounds what the predicted travel may add to it, so no pointer
// geometry can turn one hunt into a minutes-long pursuit.
const PET_MODE_STALK_MAX_TOTAL_DURATION_MS: u64 = 20_000;
const PET_MODE_STALK_MIN_SPEED: f64 = 80.0;
const PET_MODE_STALK_MAX_SPEED: f64 = 360.0;
const PET_MODE_STALK_MIN_BITE_GAP: f64 = 0.0;
const PET_MODE_STALK_MAX_BITE_GAP: f64 = 12.0;
const PET_MODE_STALK_MAX_TURN_HYSTERESIS: f64 = 120.0;
const PET_MODE_STALK_MAX_TURN_COOLDOWN_MS: u64 = 1_500;
const PET_MODE_CARRY_MIN_DURATION_MS: u64 = 400;
const PET_MODE_CARRY_MAX_DURATION_MS: u64 = 8_000;
const PET_MODE_CARRY_MIN_DISTANCE: f64 = 48.0;
const PET_MODE_CARRY_MAX_DISTANCE: f64 = 128.0;
const PET_MODE_CARRY_MIN_CAPTURE_RADIUS: f64 = 8.0;
const PET_MODE_CARRY_MAX_CAPTURE_RADIUS: f64 = 32.0;
const PET_MODE_CARRY_MAX_CURSOR_LAG_MS: u64 = 240;
const PET_MODE_CARRY_MIN_ESCAPE_TOLERANCE: f64 = 2.0;
const PET_MODE_CARRY_MAX_ESCAPE_TOLERANCE: f64 = 16.0;
const PET_MODE_CARRY_MIN_YANK_DISTANCE: f64 = 20.0;
const PET_MODE_CARRY_MAX_YANK_DISTANCE: f64 = 64.0;
const PET_MODE_CARRY_MIN_GRIP_MS: u64 = 80;
const PET_MODE_CARRY_MAX_GRIP_LIMIT_MS: u64 = 1_500;
const PET_MODE_CARRY_DEFAULT_CURSOR_LAG_MS: u64 = 0;
// How far the pointer may stray from what the carry last commanded before the
// cat starts losing its grip, in logical points.
//
// This is not a hard cutoff. Past it the grip decays with how hard the pointer
// is actually being pulled, so a nudge is resisted for a moment and a real yank
// is released almost at once. A single threshold made every one of those feel
// identical: any twitch past 7pt ended the carry in the same frame.
const PET_MODE_CARRY_ESCAPE_TOLERANCE: f64 = 7.0;
// Beyond this the pointer is being pulled away outright and the grip is dropped
// on the spot, with no grace at all.
const PET_MODE_CARRY_YANK_DISTANCE: f64 = 34.0;
// Longest the cat will hold on while the pointer resists just past tolerance.
// Short enough that fighting the cat always wins quickly.
const PET_MODE_CARRY_MAX_GRIP_MS: f64 = 420.0;
const PET_MODE_RUN_MAX_SECONDS: f64 = 6.0;
const PET_MODE_WALK_MAX_SECONDS: f64 = 60.0;
// Native translation duration only. The hidden pre-paint hold and renderer
// handoff below happen before this clock starts. Default-home travel at the
// 144-point panel is one short run at PET_MODE_RUN_SPEED; remembered homes
// farther inland still finish inside the max so Show Pet never becomes a
// cross-screen walk.
const PET_MODE_ENTRY_MIN_DURATION_MS: u64 = 180;
const PET_MODE_ENTRY_MAX_DURATION_MS: u64 = 700;
// Documented 100% default-home duration. Live travel uses distance / run speed,
// which equals this value at the reviewed 144-point panel.
#[allow(dead_code)]
const PET_MODE_ENTRY_DURATION_MS: u64 = 482;
const PET_MODE_ENTRY_ACCELERATION_RATIO: f64 = 0.10;
const PET_MODE_ENTRY_DECELERATION_RATIO: f64 = 0.18;
// Alpha-bound measurement across the idle PNG and all registered gait frames
// leaves 24.329 base points of transparent leading-edge gutter in the 144-point
// panel. Keep one extra base point outside the display so even antialiased edge
// pixels begin hidden. Both values scale with the selected native panel size.
const PET_MODE_ENTRY_TRANSPARENT_GUTTER_PX: f64 = 24.329;
const PET_MODE_ENTRY_HIDDEN_SAFETY_PX: f64 = 1.0;
// AppKit can defer the first NSPanel composite while the settings toggle's
// accessibility action is still unwinding. The WebView paints during this
// short hold, but every opaque cat pixel remains outside the display.
const PET_MODE_ENTRY_PAINT_DELAY_MS: u64 = 120;
// Web/document AX trees can briefly omit a control between otherwise stable
// scans. Keep the displaced safe seat until the original anchor has remained
// clear for two seconds; obstacle hits still move away immediately.
const PET_MODE_ANCHOR_CLEAR_MIN_CONFIRM_MS: u64 = 2_000;
// F12 source contact point (162.8751 / 150) scaled to the fixed 121.2-point
// cat viewport and centered in the 144-point native panel.
const PET_MODE_CONTACT_X_RIGHT: f64 = 143.0;
const PET_MODE_CONTACT_X_LEFT: f64 = 1.0;
const PET_MODE_CONTACT_Y: f64 = 40.0;
// Walk SVG mouth centre after preserveAspectRatio fitting and the reviewed
// gait registration, expressed in the base 144 x 99 native panel.
const PET_MODE_CURSOR_MOUTH_X_RIGHT: f64 = 109.2;
const PET_MODE_CURSOR_MOUTH_X_LEFT: f64 = 34.8;
const PET_MODE_CURSOR_MOUTH_Y: f64 = 47.8;
const PET_MODE_FALLBACK_TARGET_INSET: f64 = 28.0;
const PET_MODE_AX_SCAN_LIMIT: usize = 360;

static PET_MODE_ENABLED: AtomicBool = AtomicBool::new(false);
static PET_MODE_ENTRY_ACTIVE: AtomicBool = AtomicBool::new(false);
static PET_MODE_VISIBILITY_TRANSITION: Mutex<()> = Mutex::new(());
// Every explicit visibility request starts a new ownership generation. Outing
// commands carry the generation they began under, so a late hide or return
// from an older residence can never overwrite a newer Off -> On request.
static PET_MODE_VISIBILITY_GENERATION: AtomicU64 = AtomicU64::new(0);
// A generation becomes settled only after its visibility transaction has
// finished every native window mutation. Stale outing work can then repair the
// panel against a complete state instead of sampling an in-progress toggle.
static PET_MODE_SETTLED_VISIBILITY_GENERATION: AtomicU64 = AtomicU64::new(0);
static PET_MODE_ROAM_RIGHT: AtomicBool = AtomicBool::new(true);
static PET_MODE_MOTION_REVISION: AtomicU64 = AtomicU64::new(0);
// Motion starts are tiny critical sections: claim a revision and emit the
// matching renderer pose as one ordered operation. This prevents a stale
// background seat scan from publishing `walk` after a newer intervention has
// already published `run`.
static PET_MODE_MOTION_START: Mutex<()> = Mutex::new(());
static PET_MODE_PREVIEW_RETURN: AtomicBool = AtomicBool::new(false);
static PET_MODE_PREFERRED_POSITION: Mutex<Option<LogicalPosition<f64>>> = Mutex::new(None);
static PET_MODE_ANCHOR_CLEAR_CONFIRMATION: Mutex<Option<PetModeAnchorClearConfirmation>> =
    Mutex::new(None);
/// The pet panel's current logical size. Every placement calculation needs the
/// real footprint: with a user-selectable size, treating the panel as a fixed
/// 144x99 would let a 125% pet clamp to a right edge computed for a smaller
/// window and hang off the screen.
static PET_MODE_SIZE: Mutex<(f64, f64)> = Mutex::new((PET_MODE_WIDTH, PET_MODE_HEIGHT));
static PET_MODE_FLOOR_HOME_PT: Mutex<f64> = Mutex::new(PET_DROP_FLOOR_HOME_PT);
static PET_MODE_PREVIEW_RETURN_POSITION: Mutex<Option<LogicalPosition<f64>>> = Mutex::new(None);

#[derive(Clone, Copy, Debug, PartialEq)]
struct PetModeAnchorClearConfirmation {
    target: LogicalPosition<f64>,
    visible: LogicalPosition<f64>,
    first_seen: Instant,
}

fn positions_match(a: LogicalPosition<f64>, b: LogicalPosition<f64>) -> bool {
    (a.x - b.x).abs() < 1.0 && (a.y - b.y).abs() < 1.0
}

fn confirm_anchor_clear_return(
    pending: &mut Option<PetModeAnchorClearConfirmation>,
    visible: LogicalPosition<f64>,
    resolution: super::pet_mode_ax_control_veto::SeatResolution,
    observed_at: Instant,
) -> super::pet_mode_ax_control_veto::SeatResolution {
    use super::pet_mode_ax_control_veto::{SeatDecisionReason, SeatResolution};

    let target = LogicalPosition::new(resolution.x, resolution.y);
    let returning_to_anchor = !positions_match(target, visible)
        && matches!(
            resolution.reason,
            SeatDecisionReason::NoControlOverlap | SeatDecisionReason::NoCandidateWindow
        );
    if !returning_to_anchor {
        *pending = None;
        return resolution;
    }

    let confirmed = pending.is_some_and(|previous| {
        positions_match(previous.target, target)
            && positions_match(previous.visible, visible)
            && observed_at.saturating_duration_since(previous.first_seen)
                >= Duration::from_millis(PET_MODE_ANCHOR_CLEAR_MIN_CONFIRM_MS)
    });
    if confirmed {
        *pending = None;
        return resolution;
    }

    let same_candidate = pending.is_some_and(|previous| {
        positions_match(previous.target, target) && positions_match(previous.visible, visible)
    });
    if !same_candidate {
        *pending = Some(PetModeAnchorClearConfirmation {
            target,
            visible,
            first_seen: observed_at,
        });
    }
    SeatResolution::unchanged(visible.x, visible.y, SeatDecisionReason::AnchorClearPending)
}

fn reset_anchor_clear_confirmation() {
    if let Ok(mut pending) = PET_MODE_ANCHOR_CLEAR_CONFIRMATION.lock() {
        *pending = None;
    }
}

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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeOutingTicket {
    side: String,
    generation: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeOutingHuntEntry {
    facing: &'static str,
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
    MusicNote,
    StretchWithNote,
    TailFlickWithNote,
    SleepAngryWake,
    Sleep,
    Sit,
    Wake,
    Pet,
    Outing,
    SleepDriftNotice,
    SleepDriftFullPreview,
    CursorHuntSingle,
    CursorHuntChase,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PetModeTargetMotionOutcome {
    Completed,
    Cancelled,
    NotAttempted,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeResolvedTarget {
    pub facing: &'static str,
    pub target_kind: PetModeTargetKind,
    pub motion_outcome: PetModeTargetMotionOutcome,
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
pub struct PetModeCursorSample {
    pub cursor_x: f64,
    pub cursor_y: f64,
    pub window_x: f64,
    pub window_y: f64,
    pub window_width: f64,
    pub window_height: f64,
    pub visible: bool,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeStalkRequest {
    duration_ms: u64,
    bite_gap: f64,
    capture_radius: f64,
    speed: f64,
    retarget_cursor: bool,
    turn_hysteresis: f64,
    turn_cooldown_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[cfg_attr(target_os = "macos", allow(dead_code))]
#[serde(rename_all = "snake_case")]
pub enum PetModeStalkOutcome {
    Completed,
    TimedOut,
    Cancelled,
    PointerPressed,
    DifferentDisplay,
    Disabled,
    Hidden,
    UnsupportedPlatform,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeStalkResult {
    outcome: PetModeStalkOutcome,
    facing: &'static str,
    cursor_x: Option<f64>,
    cursor_y: Option<f64>,
    cursor_movement_distance: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeCursorCarryRequest {
    target_x: f64,
    target_y: f64,
    approach_facing: String,
    distance: f64,
    duration_ms: u64,
    capture_radius: f64,
    #[serde(default = "pet_mode_carry_default_cursor_lag_ms")]
    cursor_lag_ms: u64,
    #[serde(default = "pet_mode_carry_default_grip_tolerance")]
    grip_tolerance: f64,
    #[serde(default = "pet_mode_carry_default_yank_distance")]
    yank_distance: f64,
    #[serde(default = "pet_mode_carry_default_max_grip_ms")]
    max_grip_ms: u64,
}

fn pet_mode_carry_default_cursor_lag_ms() -> u64 {
    PET_MODE_CARRY_DEFAULT_CURSOR_LAG_MS
}

fn pet_mode_carry_default_grip_tolerance() -> f64 {
    PET_MODE_CARRY_ESCAPE_TOLERANCE
}

fn pet_mode_carry_default_yank_distance() -> f64 {
    PET_MODE_CARRY_YANK_DISTANCE
}

fn pet_mode_carry_default_max_grip_ms() -> u64 {
    PET_MODE_CARRY_MAX_GRIP_MS as u64
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[cfg_attr(target_os = "macos", allow(dead_code))]
#[serde(rename_all = "snake_case")]
pub enum PetModeCursorCarryOutcome {
    Completed,
    Cancelled,
    CursorEscaped,
    PointerPressed,
    DifferentDisplay,
    Disabled,
    Hidden,
    UnsupportedPlatform,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeCursorCarryResult {
    outcome: PetModeCursorCarryOutcome,
    moved_distance: f64,
}

#[derive(Clone, Copy, Debug)]
struct PetModePhysicalRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl PetModePhysicalRect {
    fn contains(self, point: (f64, f64)) -> bool {
        point.0 >= self.x
            && point.0 < self.x + self.width
            && point.1 >= self.y
            && point.1 < self.y + self.height
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeNativeDragResult {
    moved: bool,
    shake_detected: bool,
    #[serde(default)]
    stroke_detected: bool,
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

fn advance_pet_visibility_generation() -> u64 {
    PET_MODE_VISIBILITY_GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

struct PetModeVisibilityTransition {
    _guard: MutexGuard<'static, ()>,
    generation: u64,
}

impl Drop for PetModeVisibilityTransition {
    fn drop(&mut self) {
        PET_MODE_SETTLED_VISIBILITY_GENERATION.store(self.generation, Ordering::SeqCst);
    }
}

fn begin_pet_visibility_transition() -> Result<PetModeVisibilityTransition, String> {
    let guard = PET_MODE_VISIBILITY_TRANSITION
        .lock()
        .map_err(|_| "Pet Mode visibility transition lock is unavailable".to_string())?;
    Ok(PetModeVisibilityTransition {
        _guard: guard,
        generation: advance_pet_visibility_generation(),
    })
}

fn pet_outing_generation_matches(expected: u64, current: u64, settled: u64, enabled: bool) -> bool {
    enabled && expected == current && expected == settled
}

fn pet_outing_is_current(expected: u64) -> bool {
    pet_outing_generation_matches(
        expected,
        PET_MODE_VISIBILITY_GENERATION.load(Ordering::SeqCst),
        PET_MODE_SETTLED_VISIBILITY_GENERATION.load(Ordering::SeqCst),
        PET_MODE_ENABLED.load(Ordering::Relaxed),
    )
}

fn should_reconcile_pet_home(enabled: bool, entry_active: bool) -> bool {
    enabled && !entry_active
}

fn reconcile_pet_visibility(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    for _ in 0..125 {
        let generation = PET_MODE_VISIBILITY_GENERATION.load(Ordering::SeqCst);
        if PET_MODE_SETTLED_VISIBILITY_GENERATION.load(Ordering::SeqCst) != generation {
            thread::sleep(Duration::from_millis(2));
            continue;
        }

        let enabled = PET_MODE_ENABLED.load(Ordering::Relaxed);
        let entry_active = PET_MODE_ENTRY_ACTIVE.load(Ordering::Relaxed);
        if enabled {
            // A current reveal entry owns native X until it lands. Snapping it
            // home here would let stale outing cleanup fight the new entrance.
            if should_reconcile_pet_home(enabled, entry_active) {
                position_pet_home(app, window, false)?;
            }
            refresh_pet_hit_region_for_window(window)?;
            show_pet_panel(app, window)?;
        } else {
            reset_pet_hit_region();
            set_pet_window_interactive(window, false)?;
            window.hide().map_err(|error| error.to_string())?;
        }

        if PET_MODE_VISIBILITY_GENERATION.load(Ordering::SeqCst) == generation
            && PET_MODE_SETTLED_VISIBILITY_GENERATION.load(Ordering::SeqCst) == generation
        {
            return Ok(());
        }
    }

    // The active visibility transaction remains authoritative and will finish
    // its own final show/hide mutation. Avoid blocking indefinitely if AppKit
    // itself is delayed.
    Ok(())
}

fn schedule_pet_visibility_reconciliation(app: AppHandle, window: WebviewWindow) {
    drop(async_runtime::spawn_blocking(move || {
        let _ = reconcile_pet_visibility(&app, &window);
    }));
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
    #[cfg(target_os = "macos")]
    pet_fullscreen::monitor_resident_visibility(app.handle().clone());
    install_pet_hit_region_monitor(app.handle())
        .map_err(|error| tauri::Error::Io(std::io::Error::other(error)))?;
    let hit_region_window = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            // The panel can walk underneath a stationary pointer, so mouse
            // monitors alone are insufficient. Refresh at every native frame
            // movement and size transition as well.
            let _ = refresh_pet_hit_region_for_window(&hit_region_window);
        }
    });
    // configure_pet_panel already leaves the hidden window click-through. Do
    // not queue a second Tauri mutation that could race the first WebView mask.
    Ok(())
}

#[tauri::command]
pub async fn pet_mode_set_enabled(
    app: AppHandle,
    enabled: bool,
    snapshot: Option<Value>,
    reduced_motion: bool,
    width: f64,
    height: f64,
    force_reveal: bool,
) -> Result<(), String> {
    // AX can synchronously message Drifty's own window. Keep both the scan
    // and the visibility-lock wait off AppKit so it can answer those messages
    // and service this worker's window mutations.
    async_runtime::spawn_blocking(move || {
        set_pet_mode_enabled(app, enabled, snapshot, reduced_motion, width, height, force_reveal)
    })
    .await
    .map_err(|error| format!("Pet Mode visibility task failed: {error}"))?
}

fn set_pet_mode_enabled(
    app: AppHandle,
    enabled: bool,
    snapshot: Option<Value>,
    reduced_motion: bool,
    width: f64,
    height: f64,
    force_reveal: bool,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Err("Pet Mode window is not available".to_string());
    };
    // The JS bridge serializes its own calls, but the command is also exposed
    // to both WebViews. Keep native visibility transitions transactional even
    // if two callers arrive concurrently.
    let _visibility_transition = begin_pet_visibility_transition()?;
    reset_anchor_clear_confirmation();

    if !enabled {
        #[cfg(target_os = "macos")]
        pet_fullscreen::clear(&app);
        PET_MODE_ENABLED.store(false, Ordering::Relaxed);
        PET_MODE_ENTRY_ACTIVE.store(false, Ordering::Relaxed);
        cancel_pet_motion();
        let (width, height) = pet_size();
        let _ = window.set_min_size(Some(LogicalSize::new(width, height)));
        reset_pet_hit_region();
        let _ = set_pet_window_interactive(&window, false);
        let _ = super::pet_quick_controls::hide_pet_quick_controls(&app);
        return window.hide().map_err(|error| error.to_string());
    }

    // Size and placement form one presentation transaction. Applying the
    // persisted size here prevents a cold launch from calculating the entry
    // offset at the default panel size and resizing halfway through the step.
    let size_changed = apply_pet_mode_size(&window, width, height)?;
    let was_enabled = PET_MODE_ENABLED.load(Ordering::Relaxed);

    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window
        .set_visible_on_all_workspaces(true)
        .map_err(|error| error.to_string())?;
    refresh_pet_hit_region_for_window(&window)?;

    // React can legitimately re-send the enabled state while the panel is
    // already active (notably under Strict Mode). Reassert presentation without
    // snapping an in-flight entrance back home or replaying the choreography.
    if !should_replay_pet_entry(was_enabled, force_reveal) {
        let entry_active = PET_MODE_ENTRY_ACTIVE.load(Ordering::Relaxed);
        if (reduced_motion && entry_active) || size_changed {
            PET_MODE_ENTRY_ACTIVE.store(false, Ordering::Relaxed);
            cancel_pet_motion();
            if reduced_motion {
                let (final_width, final_height) = pet_size();
                window
                    .set_size(LogicalSize::new(final_width, final_height))
                    .map_err(|error| error.to_string())?;
            }
            position_pet_home(&app, &window, false)?;
        }
        show_pet_panel(&app, &window)?;
        if !PET_MODE_ENTRY_ACTIVE.load(Ordering::Relaxed) {
            // A renderer can remount while the native panel survives. Reassert
            // the settled state so persisted enabled storage cannot fabricate
            // a second entry pose in the replacement WebView.
            emit_pet_event(&window, json!({ "kind": "entry_complete" }))?;
        }
        if let Some(snapshot) = snapshot {
            emit_pet_event(&window, json!({ "kind": "snapshot", "snapshot": snapshot }))?;
        }
        return Ok(());
    }

    cancel_pet_motion();
    let monitor = resolve_pet_home_monitor(&app)
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    let remembered_home = calculate_pet_home_position_with_nudge(Some(&app), &monitor);
    let (final_width, final_height) = pet_size();
    let scale_factor = monitor.scale_factor();
    let screen_position = monitor.position().to_logical::<f64>(scale_factor);
    let screen_size = monitor.size().to_logical::<f64>(scale_factor);
    let home = clamp_pet_entry_destination(
        remembered_home,
        screen_position.x,
        screen_size.width,
        final_width,
    );
    let entry = pet_entry_geometry(screen_position.x, screen_size.width, home.x, final_width);
    let entry_travel = pet_entry_travel_distance(entry.start_x, home.x);
    let entry_duration_ms = pet_entry_duration_ms(entry_travel);
    emit_pet_event(&window, json!({ "kind": "facing", "facing": entry.facing }))?;

    if reduced_motion {
        window
            .set_size(LogicalSize::new(final_width, final_height))
            .map_err(|error| error.to_string())?;
        show_pet_panel_at_position(&app, &window, home)?;
        PET_MODE_ENABLED.store(true, Ordering::Relaxed);
        PET_MODE_ENTRY_ACTIVE.store(false, Ordering::Relaxed);
        if force_reveal {
            emit_pet_event(&window, json!({ "kind": "reveal" }))?;
        }
        emit_pet_event(&window, json!({ "kind": "entry_complete" }))?;
    } else {
        window
            .set_size(LogicalSize::new(final_width, final_height))
            .map_err(|error| error.to_string())?;
        show_pet_panel_at_position(&app, &window, LogicalPosition::new(entry.start_x, home.y))?;
        PET_MODE_ENABLED.store(true, Ordering::Relaxed);
        PET_MODE_ENTRY_ACTIVE.store(true, Ordering::Relaxed);
        if force_reveal {
            emit_pet_event(&window, json!({ "kind": "reveal" }))?;
        }
    }

    if !reduced_motion {
        let entry_window = window.clone();
        let entry_start_x = entry.start_x;
        let motion_revision = PET_MODE_MOTION_REVISION.fetch_add(1, Ordering::Relaxed) + 1;
        drop(async_runtime::spawn_blocking(move || {
            // The display edge is the reveal mask. Only the panel's transparent
            // leading gutter starts onscreen; the first opaque cat pixel appears
            // after native movement begins instead of holding as a static peek.
            thread::sleep(Duration::from_millis(PET_MODE_ENTRY_PAINT_DELAY_MS));
            if !pet_entry_motion_is_current(motion_revision) {
                return;
            }
            let _ = emit_pet_event(
                &entry_window,
                json!({
                    "kind": "motion",
                    "motion": "entry",
                    "travelDistance": entry_travel,
                    "durationMs": entry_duration_ms,
                }),
            );
            // Give the WebView one frame to switch from its held inward-facing
            // idle pose to the first gait frame before native movement begins.
            thread::sleep(Duration::from_millis(16));
            if !pet_entry_motion_is_current(motion_revision) {
                return;
            }
            let _ = animate_pet_entry_window(
                &entry_window,
                entry_start_x,
                home,
                entry_duration_ms,
                motion_revision,
            );
            if !pet_entry_motion_is_current(motion_revision)
                || !PET_MODE_ENTRY_ACTIVE.swap(false, Ordering::Relaxed)
            {
                return;
            }
            let _ = emit_pet_event(&entry_window, json!({ "kind": "entry_complete" }));
        }));
    }

    if let Some(snapshot) = snapshot {
        emit_pet_event(&window, json!({ "kind": "snapshot", "snapshot": snapshot }))?;
    }
    Ok(())
}

fn animate_pet_entry_window(
    window: &WebviewWindow,
    start_x: f64,
    home: LogicalPosition<f64>,
    duration_ms: u64,
    motion_revision: u64,
) -> Result<(), String> {
    let started_at = Instant::now();
    let duration = Duration::from_millis(duration_ms);
    loop {
        if !pet_entry_motion_is_current(motion_revision) {
            return Ok(());
        }
        let progress = (started_at.elapsed().as_secs_f64() / duration.as_secs_f64()).min(1.0);
        // Reach walking speed quickly, cruise for most of the visible trip, and
        // come fully to rest before the renderer freezes the exact walk SVG.
        let travel_progress = pet_entry_travel_progress(progress);
        let x = start_x + (home.x - start_x) * travel_progress;
        window
            .set_position(LogicalPosition::new(x, home.y))
            .map_err(|error| error.to_string())?;
        if progress >= 1.0 {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(16));
    }
}

fn pet_entry_travel_progress(progress: f64) -> f64 {
    let progress = progress.clamp(0.0, 1.0);
    let acceleration_duration = PET_MODE_ENTRY_ACCELERATION_RATIO;
    let deceleration_duration = PET_MODE_ENTRY_DECELERATION_RATIO;
    let deceleration_start = 1.0 - deceleration_duration;
    let cruise_duration = deceleration_start - acceleration_duration;
    let travel_area = acceleration_duration / 2.0 + cruise_duration + deceleration_duration / 2.0;

    if progress < acceleration_duration {
        return progress * progress / (2.0 * acceleration_duration * travel_area);
    }
    if progress < deceleration_start {
        let distance = acceleration_duration / 2.0 + progress - acceleration_duration;
        return distance / travel_area;
    }

    let deceleration_elapsed = progress - deceleration_start;
    let distance_before_deceleration = acceleration_duration / 2.0 + cruise_duration;
    let deceleration_distance = deceleration_elapsed
        - deceleration_elapsed * deceleration_elapsed / (2.0 * deceleration_duration);
    (distance_before_deceleration + deceleration_distance) / travel_area
}

fn pet_entry_motion_is_current(motion_revision: u64) -> bool {
    pet_entry_motion_matches(
        motion_revision,
        PET_MODE_MOTION_REVISION.load(Ordering::Relaxed),
        PET_MODE_ENABLED.load(Ordering::Relaxed),
        PET_MODE_ENTRY_ACTIVE.load(Ordering::Relaxed),
    )
}

fn pet_entry_motion_matches(
    expected_revision: u64,
    current_revision: u64,
    enabled: bool,
    entry_active: bool,
) -> bool {
    expected_revision == current_revision && enabled && entry_active
}

fn should_replay_pet_entry(was_enabled: bool, force_reveal: bool) -> bool {
    !was_enabled || force_reveal
}

#[derive(Clone, Copy, Debug)]
struct PetEntryGeometry {
    facing: &'static str,
    start_x: f64,
}

fn pet_entry_geometry(
    screen_x: f64,
    screen_width: f64,
    home_x: f64,
    pet_width: f64,
) -> PetEntryGeometry {
    let visible_width = pet_entry_transparent_visible_width(pet_width);
    let screen_center = screen_x + screen_width / 2.0;
    let pet_center = home_x + pet_width / 2.0;
    if pet_center < screen_center {
        PetEntryGeometry {
            facing: "right",
            start_x: screen_x - pet_width + visible_width,
        }
    } else {
        PetEntryGeometry {
            facing: "left",
            start_x: screen_x + screen_width - visible_width,
        }
    }
}

fn pet_entry_transparent_visible_width(pet_width: f64) -> f64 {
    let base_visible_width = PET_MODE_ENTRY_TRANSPARENT_GUTTER_PX - PET_MODE_ENTRY_HIDDEN_SAFETY_PX;
    pet_width * base_visible_width / PET_MODE_WIDTH
}

fn pet_entry_travel_distance(start_x: f64, home_x: f64) -> f64 {
    (home_x - start_x).abs()
}

fn pet_entry_max_travel_distance(pet_width: f64) -> f64 {
    pet_entry_default_travel_distance(pet_width)
        .max(PET_MODE_RUN_SPEED * PET_MODE_ENTRY_MAX_DURATION_MS as f64 / 1000.0)
}

fn pet_entry_duration_ms(travel_distance: f64) -> u64 {
    if !travel_distance.is_finite() || travel_distance <= 0.0 {
        return PET_MODE_ENTRY_MIN_DURATION_MS;
    }
    ((travel_distance / PET_MODE_RUN_SPEED) * 1000.0)
        .round()
        .clamp(
            PET_MODE_ENTRY_MIN_DURATION_MS as f64,
            PET_MODE_ENTRY_MAX_DURATION_MS as f64,
        ) as u64
}

#[tauri::command]
pub fn pet_mode_update(app: AppHandle, snapshot: Value) -> Result<(), String> {
    if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Ok(());
    }
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(());
    };
    // Tracker snapshots must preserve the current silhouette ownership rather
    // than restoring the old full rectangular hit surface.
    refresh_pet_hit_region_for_window(&window)?;
    emit_pet_event(&window, json!({ "kind": "snapshot", "snapshot": snapshot }))
}

fn validate_pet_visibility_action(action: &str) -> Result<(), String> {
    match action {
        "hideOneHour" | "turnOff" => Ok(()),
        _ => Err(format!("unknown pet visibility action: {action}")),
    }
}

/// Hide the pet immediately, then let the main window persist the user's choice
/// and own the one-hour restore timer. A one-hour hide may retain only the
/// quick-controls panel long enough to acknowledge success. Like the Companion
/// path this never reveals the dashboard: dismissing the cat from its own
/// context menu should not replace one interruption with a bigger one.
#[tauri::command]
pub async fn pet_mode_visibility_action(
    app: AppHandle,
    action: String,
    keep_quick_controls_visible: Option<bool>,
) -> Result<(), String> {
    // This shares the enable transaction's mutex. Waiting on it from AppKit
    // would deadlock a worker that is waiting for a main-thread window update.
    async_runtime::spawn_blocking(move || {
        apply_pet_visibility_action(app, action, keep_quick_controls_visible)
    })
    .await
    .map_err(|error| format!("Pet Mode visibility action failed: {error}"))?
}

fn apply_pet_visibility_action(
    app: AppHandle,
    action: String,
    keep_quick_controls_visible: Option<bool>,
) -> Result<(), String> {
    validate_pet_visibility_action(&action)?;
    let _visibility_transition = begin_pet_visibility_transition()?;
    reset_anchor_clear_confirmation();
    let keep_quick_controls_visible =
        action == "hideOneHour" && keep_quick_controls_visible.unwrap_or(false);
    super::pet_quick_controls::set_pet_quick_controls_acknowledgement_held(
        &app,
        keep_quick_controls_visible,
    );

    if let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
        #[cfg(target_os = "macos")]
        pet_fullscreen::clear(&app);
        PET_MODE_ENABLED.store(false, Ordering::Relaxed);
        PET_MODE_ENTRY_ACTIVE.store(false, Ordering::Relaxed);
        cancel_pet_motion();
        reset_pet_hit_region();
        let _ = set_pet_window_interactive(&window, false);
        window.hide().map_err(|error| error.to_string())?;
    }
    if !keep_quick_controls_visible {
        let _ = super::pet_quick_controls::hide_pet_quick_controls(&app);
    }

    if let Some(main) = app.get_webview_window("main") {
        main.emit("pet-visibility-action", json!({ "action": action }))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
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
        let entry_was_active = cancel_pet_motion();
        recover_cancelled_pet_entry(&app, &window, entry_was_active)?;
    }
    emit_pet_event(
        &window,
        json!({ "kind": "preview_action", "action": action }),
    )
}

#[tauri::command]
pub fn pet_mode_cancel_motion(app: AppHandle) -> Result<(), String> {
    // Manual pickup needs to stop native travel immediately without emitting a
    // `stop` preview event back into the pet renderer. That event intentionally
    // invalidates action tokens and would cancel the delayed pickup handoff.
    let entry_was_active = cancel_pet_motion();
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(());
    };
    recover_cancelled_pet_entry(&app, &window, entry_was_active)
}

#[tauri::command]
pub async fn pet_mode_move_to_target(
    app: AppHandle,
    target: PetModeInterventionTarget,
    reduced_motion: Option<bool>,
) -> Result<PetModeResolvedTarget, String> {
    async_runtime::spawn_blocking(move || {
        move_pet_to_target(&app, &target, reduced_motion.unwrap_or(false))
    })
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
    reason: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !pet_fullscreen::accept_contact(&id, contacted.unwrap_or(true)) {
            return Ok(());
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        main.emit(
            "pet-mode-contact",
            json!({
                "id": id,
                "contacted": contacted.unwrap_or(true),
                "reason": reason,
            }),
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
pub fn pet_mode_complete_fullscreen_close(id: String) {
    #[cfg(target_os = "macos")]
    pet_fullscreen::close_completed(&id);
    #[cfg(not(target_os = "macos"))]
    let _ = id;
}

#[tauri::command]
pub async fn pet_mode_finish_fullscreen_intervention(
    app: AppHandle,
    id: String,
    interrupted: bool,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    return async_runtime::spawn_blocking(move || pet_fullscreen::finish(&app, &id, interrupted))
        .await
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, id, interrupted);
        Ok(false)
    }
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
                .unwrap_or_else(|| calculate_pet_home_position_with_nudge(Some(&app), &monitor));
            animate_pet_window_toward(&window, target, PET_MODE_RUN_SPEED, 0.8, "run")
        } else {
            position_pet_home(&app, &window, true)
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn pet_mode_set_presence(
    app: AppHandle,
    visible: bool,
    outing_generation: Option<u64>,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(());
    };
    reset_anchor_clear_confirmation();
    let command_generation = if visible {
        let generation = PET_MODE_VISIBILITY_GENERATION.load(Ordering::SeqCst);
        if !pet_outing_is_current(generation) {
            return Ok(());
        }
        generation
    } else {
        let generation = outing_generation.ok_or_else(|| {
            "Pet Mode outing generation is required when hiding presence".to_string()
        })?;
        if !pet_outing_is_current(generation) {
            return Ok(());
        }
        generation
    };

    if visible {
        position_pet_home(&app, &window, false)?;
        refresh_pet_hit_region_for_window(&window)?;
        show_pet_panel(&app, &window)?;
    } else {
        // Presence changes are a native lifecycle boundary. Clear the region
        // as well as the current AppKit flag so a missed renderer update cannot
        // resurrect a stale pose when the panel is shown again.
        reset_pet_hit_region();
        set_pet_window_interactive(&window, false)?;
        window.hide().map_err(|error| error.to_string())?;
    }

    if !pet_outing_is_current(command_generation) {
        schedule_pet_visibility_reconciliation(app, window);
    }
    Ok(())
}

#[tauri::command]
pub fn pet_mode_set_interactive(app: AppHandle, interactive: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(());
    };
    // Compatibility command for older WebViews: `true` now recomputes the
    // published silhouette instead of reopening the complete panel rectangle.
    if interactive {
        refresh_pet_hit_region_for_window(&window)
    } else {
        set_pet_window_interactive(&window, false)
    }
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
    apply_pet_mode_size(&window, width, height).map(|_| ())
}

fn current_floor_home_pt() -> f64 {
    PET_MODE_FLOOR_HOME_PT
        .lock()
        .map(|value| *value)
        .unwrap_or(PET_DROP_FLOOR_HOME_PT)
}

/// Dev-only floor-home override used while calibrating the stay band. Production
/// drops keep the shipped 20pt default unless this command is called.
#[tauri::command]
pub fn pet_mode_set_floor_home(points: f64) -> Result<f64, String> {
    let next = clamp_floor_home_pt(points);
    if let Ok(mut current) = PET_MODE_FLOOR_HOME_PT.lock() {
        *current = next;
    }
    Ok(next)
}

fn apply_pet_mode_size(window: &WebviewWindow, width: f64, height: f64) -> Result<bool, String> {
    if !(width.is_finite() && height.is_finite()) || width <= 0.0 || height <= 0.0 {
        return Err("Pet Mode size must be a positive, finite size".to_string());
    }
    let changed = PET_MODE_SIZE
        .lock()
        .map(|current| {
            (current.0 - width).abs() > f64::EPSILON || (current.1 - height).abs() > f64::EPSILON
        })
        .unwrap_or(true);
    // A repeated enabled sync must not disturb a native entrance already in
    // flight. If the requested final footprint is current, leave the live
    // panel untouched.
    if !changed {
        return Ok(false);
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
    refresh_pet_hit_region_for_window(window)?;
    Ok(true)
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
    let drag = tauri::async_runtime::spawn_blocking(move || {
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
        eprintln!(
            "[pet-mode-drag] end window={after:?} moved={} shake_detected={} stroke_detected={}",
            drag.moved, drag.shake_detected, drag.stroke_detected
        );
    }
    let result = PetModeNativeDragResult {
        moved: drag.moved,
        shake_detected: drag.shake_detected,
        stroke_detected: drag.stroke_detected,
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
    if !matches!(window.is_visible(), Ok(true)) {
        return false;
    }
    refresh_pet_hit_region_for_window(&window).is_ok() && pet_hit_region_pointer_inside()
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
pub fn pet_mode_cursor_sample(app: AppHandle) -> Result<PetModeCursorSample, String> {
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let visible = window.is_visible().unwrap_or(false);
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale_factor);
    let size = window
        .outer_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale_factor);
    let cursor = app
        .cursor_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale_factor);
    Ok(PetModeCursorSample {
        cursor_x: cursor.x,
        cursor_y: cursor.y,
        window_x: position.x,
        window_y: position.y,
        window_width: size.width,
        window_height: size.height,
        visible,
    })
}

#[tauri::command]
pub async fn pet_mode_stalk_cursor(
    app: AppHandle,
    request: PetModeStalkRequest,
) -> Result<PetModeStalkResult, String> {
    validate_pet_mode_stalk_request(request)?;

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, request);
        return Ok(PetModeStalkResult {
            outcome: PetModeStalkOutcome::UnsupportedPlatform,
            facing: "right",
            cursor_x: None,
            cursor_y: None,
            cursor_movement_distance: 0.0,
        });
    }

    #[cfg(target_os = "macos")]
    async_runtime::spawn_blocking(move || stalk_pet_toward_cursor(&app, request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pet_mode_carry_cursor(
    app: AppHandle,
    request: PetModeCursorCarryRequest,
) -> Result<PetModeCursorCarryResult, String> {
    validate_pet_mode_cursor_carry_request(&request)?;

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, request);
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::UnsupportedPlatform,
            moved_distance: 0.0,
        });
    }

    #[cfg(target_os = "macos")]
    async_runtime::spawn_blocking(move || carry_pet_mode_cursor(&app, request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pet_mode_lab_place_center(app: AppHandle) -> Result<PetModeInputBounds, String> {
    async_runtime::spawn_blocking(move || place_pet_mode_at_center_for_lab(app))
        .await
        .map_err(|error| format!("Pet Mode lab placement failed: {error}"))?
}

fn place_pet_mode_at_center_for_lab(app: AppHandle) -> Result<PetModeInputBounds, String> {
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
    let _ = remember_and_resolve_pet_position(&app, true)?;
    pet_mode_input_bounds(app)
}

#[tauri::command]
pub async fn pet_mode_roam(app: AppHandle, post_drop: Option<bool>) -> Result<(), String> {
    async_runtime::spawn_blocking(move || {
        if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
            return Ok(());
        }
        let window = app
            .get_webview_window(PET_MODE_WINDOW_LABEL)
            .ok_or_else(|| "Pet Mode window is not available".to_string())?;
        if post_drop.unwrap_or(false) {
            let monitor = window
                .current_monitor()
                .map_err(|error| error.to_string())?
                .or_else(|| resolve_pet_home_monitor(&app))
                .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
            let scale_factor = monitor.scale_factor();
            let work_area = monitor.work_area();
            let work_position = work_area.position.to_logical::<f64>(scale_factor);
            let work_size = work_area.size.to_logical::<f64>(scale_factor);
            let start = current_pet_logical_position(&window)?;
            // The pointer has just released the cat. Walking away from that
            // side reads as a response to the user; at a screen edge, choose
            // the side with enough room instead of shortening the animation.
            let prefer_right = app
                .cursor_position()
                .ok()
                .map(|cursor| {
                    cursor.to_logical::<f64>(scale_factor).x < start.x + pet_width() / 2.0
                })
                .unwrap_or_else(|| PET_MODE_ROAM_RIGHT.fetch_xor(true, Ordering::Relaxed));
            let (target, facing) = calculate_pet_post_drop_walk_position(
                start,
                work_position,
                work_size.width,
                work_size.height,
                prefer_right,
                pet_width(),
                pet_height(),
            );
            animate_pet_window_with_facing(
                &window,
                target,
                facing,
                PET_MODE_WALK_SPEED,
                PET_MODE_POST_DROP_WALK_MAX_SECONDS,
                "walk",
            )
        } else {
            let monitor = resolve_pet_home_monitor(&app)
                .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
            let target = calculate_pet_roam_position_with_nudge(Some(&app), &monitor);
            animate_pet_window_toward(
                &window,
                target,
                PET_MODE_WALK_SPEED,
                PET_MODE_WALK_MAX_SECONDS,
                "walk",
            )
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pet_mode_exit_screen(app: AppHandle) -> Result<PetModeOutingTicket, String> {
    async_runtime::spawn_blocking(move || {
        if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
            return Err("Pet Mode is disabled".to_string());
        }
        let generation = PET_MODE_VISIBILITY_GENERATION.load(Ordering::SeqCst);
        if !pet_outing_is_current(generation) {
            return Err("Pet Mode visibility is changing".to_string());
        }
        let window = app
            .get_webview_window(PET_MODE_WINDOW_LABEL)
            .ok_or_else(|| "Pet Mode window is not available".to_string())?;
        let monitor = resolve_pet_home_monitor(&app)
            .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
        let start = current_pet_logical_position(&window)?;
        let (side, target) = calculate_pet_exit_position(&monitor, start);
        let completed = animate_pet_window_with_facing_guarded(
            &window,
            target,
            if side == "left" { "left" } else { "right" },
            PET_MODE_WALK_SPEED,
            PET_MODE_WALK_MAX_SECONDS,
            "walk",
            Some(generation),
        )?;
        if !completed {
            reconcile_pet_visibility(&app, &window)?;
        }
        Ok(PetModeOutingTicket {
            side: side.to_string(),
            generation,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Re-enters a naturally-outing pet on the display that currently owns the
/// cursor, without first snapping through its remembered home. The outing
/// generation is the ownership boundary: an explicit Hide/Off/Show that wins
/// while this is queued makes the request a no-op instead of resurrecting an
/// older residence.
#[tauri::command]
pub async fn pet_mode_prepare_outing_hunt(
    app: AppHandle,
    side: String,
    outing_generation: u64,
) -> Result<Option<PetModeOutingHuntEntry>, String> {
    async_runtime::spawn_blocking(move || {
        if side != "left" && side != "right" {
            return Err("Invalid Pet Mode outing side".to_string());
        }
        if !pet_outing_is_current(outing_generation) {
            return Ok(None);
        }
        let window = app
            .get_webview_window(PET_MODE_WINDOW_LABEL)
            .ok_or_else(|| "Pet Mode window is not available".to_string())?;
        let monitor = resolve_pet_cursor_monitor(&app)
            .or_else(|| resolve_pet_home_monitor(&app))
            .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
        let start = calculate_pet_outing_return_start(&monitor, &side);
        cancel_pet_motion();
        if !pet_outing_is_current(outing_generation) {
            return Ok(None);
        }
        window
            .set_position(start)
            .map_err(|error| error.to_string())?;
        if !pet_outing_is_current(outing_generation) {
            reconcile_pet_visibility(&app, &window)?;
            return Ok(None);
        }
        show_pet_panel(&app, &window)?;
        if !pet_outing_is_current(outing_generation) {
            reconcile_pet_visibility(&app, &window)?;
            return Ok(None);
        }
        Ok(Some(PetModeOutingHuntEntry {
            facing: if side == "left" { "right" } else { "left" },
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pet_mode_return_from_outing(
    app: AppHandle,
    side: String,
    outing_generation: u64,
) -> Result<(), String> {
    async_runtime::spawn_blocking(move || {
        if side != "left" && side != "right" {
            return Err("Invalid Pet Mode outing side".to_string());
        }
        if !pet_outing_is_current(outing_generation) {
            return Ok(());
        }
        let window = app
            .get_webview_window(PET_MODE_WINDOW_LABEL)
            .ok_or_else(|| "Pet Mode window is not available".to_string())?;
        let monitor = resolve_pet_home_monitor(&app)
            .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
        let start = calculate_pet_outing_return_start(&monitor, &side);
        if !pet_outing_is_current(outing_generation) {
            return Ok(());
        }
        window
            .set_position(start)
            .map_err(|error| error.to_string())?;
        if !pet_outing_is_current(outing_generation) {
            reconcile_pet_visibility(&app, &window)?;
            return Ok(());
        }
        show_pet_panel(&app, &window)?;
        if !pet_outing_is_current(outing_generation) {
            reconcile_pet_visibility(&app, &window)?;
            return Ok(());
        }
        let target = calculate_pet_home_position_with_nudge(Some(&app), &monitor);
        let completed = animate_pet_window_with_facing_guarded(
            &window,
            target,
            if side == "left" { "right" } else { "left" },
            PET_MODE_WALK_SPEED,
            PET_MODE_WALK_MAX_SECONDS,
            "walk",
            Some(outing_generation),
        )?;
        if !completed {
            reconcile_pet_visibility(&app, &window)?;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn current_pet_logical_position(
    window: &WebviewWindow,
) -> Result<LogicalPosition<f64>, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    Ok(position.to_logical(scale_factor))
}

pub fn probe_pet_drop_plan(
    app: &AppHandle,
    window: &WebviewWindow,
    pos: LogicalPosition<f64>,
    force_floor: bool,
) -> Result<PetDropPlan, String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| resolve_pet_home_monitor(app))
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(scale_factor);
    let work_size = work_area.size.to_logical::<f64>(scale_factor);
    let (width, height) = pet_size();
    let pet = PetRect {
        x: pos.x,
        y: pos.y,
        width,
        height,
    };
    let work = PetRect {
        x: work_position.x,
        y: work_position.y,
        width: work_size.width,
        height: work_size.height,
    };
    if force_floor {
        return Ok(plan_pet_shake_floor_drop(&pet, &work));
    }
    let pet_window_number = macos_window_number(window);
    let screen_position = monitor.position().to_logical::<f64>(scale_factor);
    let screen_size = monitor.size().to_logical::<f64>(scale_factor);
    let screen = PetRect {
        x: screen_position.x,
        y: screen_position.y,
        width: screen_size.width,
        height: screen_size.height,
    };
    let inferred_dock = inferred_bottom_dock(&work, &screen);
    let listed = list_on_screen_ledges(pet_window_number);
    let plan = match &listed {
        Ok((rects, dock)) => {
            let named: Vec<(&str, PetRect)> = rects
                .iter()
                .map(|(name, rect)| (name.as_str(), rect.clone()))
                .collect();
            plan_pet_drop_with_floor_home(
                false,
                &pet,
                &work,
                &named,
                dock.as_ref().or(inferred_dock.as_ref()),
                current_floor_home_pt(),
            )
        }
        Err(_) => plan_pet_drop_with_floor_home(
            false,
            &pet,
            &work,
            &[],
            inferred_dock.as_ref(),
            current_floor_home_pt(),
        ),
    };
    Ok(plan)
}

#[tauri::command]
pub async fn pet_mode_resolve_drop(
    app: AppHandle,
    force_floor: bool,
) -> Result<PetDropPlan, String> {
    if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Err("Pet Mode is disabled".to_string());
    }
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let start = current_pet_logical_position(&window)?;
    let plan = probe_pet_drop_plan(&app, &window, start, force_floor)?;

    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| resolve_pet_home_monitor(&app))
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(scale_factor);
    let work_size = work_area.size.to_logical::<f64>(scale_factor);
    let screen_position = monitor.position().to_logical::<f64>(scale_factor);
    let screen_size = monitor.size().to_logical::<f64>(scale_factor);

    #[cfg(debug_assertions)]
    {
        eprintln!(
            "[pet-drop] kind={:?} ledge={} air={:.1} target_y={:.1} pet=({:.1},{:.1})",
            plan.kind, plan.ledge, plan.distance, plan.target_y, start.x, start.y,
        );
    }
    let dock_landing = plan.ledge == "Dock";
    let (clamp_position, clamp_width, clamp_height) = if dock_landing {
        (screen_position, screen_size.width, screen_size.height)
    } else {
        (work_position, work_size.width, work_size.height)
    };
    let target = clamp_pet_position(
        LogicalPosition::new(start.x, plan.target_y),
        clamp_position,
        clamp_width,
        clamp_height,
    );
    if matches!(plan.kind, PetDropKind::AlreadyOn) && (target.y - start.y).abs() >= 1.0 {
        window
            .set_position(target)
            .map_err(|error| error.to_string())?;
    }
    let should_animate = matches!(plan.kind, PetDropKind::Catch | PetDropKind::Hop)
        && (target.y - start.y).abs() >= 1.0;
    if should_animate {
        cancel_pet_motion();
        let motion_revision = PET_MODE_MOTION_REVISION.fetch_add(1, Ordering::Relaxed) + 1;
        let duration_ms = plan.duration_ms;
        let drop_window = window.clone();
        // Keep native travel on this command so the renderer cannot start the
        // next life beat while the window is still falling. The standing pose
        // is owned by the webview for the whole duration; sitting waits until
        // this animation returns.
        async_runtime::spawn_blocking(move || {
            animate_pet_window_drop(&drop_window, start, target, duration_ms, motion_revision)
        })
        .await
        .map_err(|error| format!("Pet Mode drop task failed: {error}"))??;
    }
    Ok(plan)
}

fn animate_pet_window_drop(
    window: &WebviewWindow,
    start: LogicalPosition<f64>,
    target: LogicalPosition<f64>,
    duration_ms: u64,
    motion_revision: u64,
) -> Result<(), String> {
    let duration = Duration::from_millis(duration_ms.max(1));
    let started = Instant::now();
    loop {
        if PET_MODE_MOTION_REVISION.load(Ordering::Relaxed) != motion_revision {
            return Ok(());
        }
        let t = (started.elapsed().as_secs_f64() / duration.as_secs_f64()).clamp(0.0, 1.0);
        let eased = t * t;
        window
            .set_position(LogicalPosition::new(
                start.x + (target.x - start.x) * eased,
                start.y + (target.y - start.y) * eased,
            ))
            .map_err(|error| error.to_string())?;
        if t >= 1.0 {
            break;
        }
        thread::sleep(Duration::from_millis(16));
    }
    Ok(())
}

fn macos_window_number(window: &WebviewWindow) -> i64 {
    #[cfg(target_os = "macos")]
    {
        window
            .ns_window()
            .ok()
            .and_then(|ptr| unsafe {
                let ns_window: &NSWindow = &*ptr.cast::<NSWindow>();
                Some(ns_window.windowNumber() as i64)
            })
            .unwrap_or(-1)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        -1
    }
}

#[tauri::command]
pub async fn pet_mode_remember_position(
    app: AppHandle,
    reduced_motion: Option<bool>,
) -> Result<super::pet_mode_ax_control_veto::SeatResolution, String> {
    async_runtime::spawn_blocking(move || {
        remember_and_resolve_pet_position(&app, reduced_motion.unwrap_or(false))
    })
    .await
    .map_err(|error| format!("Pet Mode seat task failed: {error}"))?
}

#[tauri::command]
pub async fn pet_mode_reconcile_position(
    app: AppHandle,
    reduced_motion: Option<bool>,
) -> Result<super::pet_mode_ax_control_veto::SeatResolution, String> {
    async_runtime::spawn_blocking(move || {
        reconcile_resident_pet_position(&app, reduced_motion.unwrap_or(false))
    })
    .await
    .map_err(|error| format!("Pet Mode seat reconcile task failed: {error}"))?
}

#[tauri::command]
pub async fn pet_mode_probe_ax_seat(
    app: AppHandle,
) -> Result<super::pet_mode_ax_control_veto::SeatResolution, String> {
    async_runtime::spawn_blocking(move || probe_current_pet_ax_seat(&app))
        .await
        .map_err(|error| format!("Pet Mode AX seat probe failed: {error}"))?
}

fn remember_and_resolve_pet_position(
    app: &AppHandle,
    reduced_motion: bool,
) -> Result<super::pet_mode_ax_control_veto::SeatResolution, String> {
    reset_anchor_clear_confirmation();
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
    // AX safety applies to every manual drop on the work area. Only the durable
    // home preference is restricted to the upper resident band: a lower drop
    // stays temporary, but it must still walk off a control immediately.
    let anchor = clamp_pet_position(position, work_position, work_size.width, work_size.height);
    {
        let mut preferred = PET_MODE_PREFERRED_POSITION
            .lock()
            .map_err(|_| "Pet Mode position lock is unavailable".to_string())?;
        *preferred = preferred_pet_position_after_drop(
            *preferred,
            anchor,
            work_position,
            work_size.width,
            work_size.height,
        );
    }
    let resolution = resolve_resident_seat(
        app,
        anchor,
        position,
        work_position,
        work_size.width,
        work_size.height,
    );
    apply_pet_seat_resolution(&window, position, resolution, reduced_motion, None)
}

fn reconcile_resident_pet_position(
    app: &AppHandle,
    reduced_motion: bool,
) -> Result<super::pet_mode_ax_control_veto::SeatResolution, String> {
    use super::pet_mode_ax_control_veto::{SeatDecisionReason, SeatResolution};

    // Capture before sampling geometry. Any foreground motion that starts
    // while AX is scanning invalidates both that sample and its correction.
    let observed_motion_revision = PET_MODE_MOTION_REVISION.load(Ordering::Relaxed);
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let current = current_pet_logical_position(&window)?;
    if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Ok(SeatResolution::unchanged(
            current.x,
            current.y,
            SeatDecisionReason::PetDisabled,
        ));
    }
    if !window.is_visible().unwrap_or(false) {
        return Ok(SeatResolution::unchanged(
            current.x,
            current.y,
            SeatDecisionReason::PetHidden,
        ));
    }
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| resolve_pet_home_monitor(app))
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(scale_factor);
    let work_size = work_area.size.to_logical::<f64>(scale_factor);
    let resident_home = calculate_pet_home_position_with_nudge(None, &monitor);
    // In the upper resident band we continue checking whether the remembered
    // home has become clear. Elsewhere, the current temporary seat is the AX
    // target so a surface change can move the cat off a new button without
    // pulling it vertically back to its long-term home.
    let anchor = resident_seat_anchor_for_current_position(
        current,
        resident_home,
        work_position,
        work_size.width,
        work_size.height,
    );
    let resolution = resolve_resident_seat(
        app,
        anchor,
        current,
        work_position,
        work_size.width,
        work_size.height,
    );
    apply_pet_seat_resolution(
        &window,
        current,
        resolution,
        reduced_motion,
        Some(observed_motion_revision),
    )
}

fn probe_current_pet_ax_seat(
    app: &AppHandle,
) -> Result<super::pet_mode_ax_control_veto::SeatResolution, String> {
    use super::pet_mode_ax_control_veto::{SeatDecisionReason, SeatResolution};

    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let current = current_pet_logical_position(&window)?;
    if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Ok(SeatResolution::unchanged(
            current.x,
            current.y,
            SeatDecisionReason::PetDisabled,
        ));
    }
    if !window.is_visible().unwrap_or(false) {
        return Ok(SeatResolution::unchanged(
            current.x,
            current.y,
            SeatDecisionReason::PetHidden,
        ));
    }
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| resolve_pet_home_monitor(app))
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(scale_factor);
    let work_size = work_area.size.to_logical::<f64>(scale_factor);
    let target = clamp_pet_position(current, work_position, work_size.width, work_size.height);

    // Diagnostic only: share the production AX resolver, but never mutate the
    // window or the anchor-clear confirmation state while the pointer is down.
    Ok(resolve_resident_seat(
        app,
        target,
        current,
        work_position,
        work_size.width,
        work_size.height,
    ))
}

fn move_pet_to_target(
    app: &AppHandle,
    target: &PetModeInterventionTarget,
    _reduced_motion: bool,
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
    #[cfg(target_os = "macos")]
    if target.lab_target.is_none() {
        if let Some(frame) = pet_mode_native_ax::fullscreen_target_frame(
            &target.app_name, target.browser_name.as_deref(),
        ) {
            return pet_fullscreen::approach(
                app, &window, target, frame, _reduced_motion,
            );
        }
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
            motion_outcome: PetModeTargetMotionOutcome::NotAttempted,
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
    let motion_completed = animate_pet_window_with_facing_guarded(
        &window,
        target_position,
        facing,
        PET_MODE_RUN_SPEED,
        PET_MODE_RUN_MAX_SECONDS,
        "run",
        None,
    )?;

    Ok(PetModeResolvedTarget {
        facing,
        target_kind: point.kind,
        motion_outcome: if motion_completed {
            PetModeTargetMotionOutcome::Completed
        } else {
            PetModeTargetMotionOutcome::Cancelled
        },
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
    let motion_completed = animate_pet_window_with_facing_guarded(
        window,
        target_position,
        facing,
        PET_MODE_RUN_SPEED,
        0.8,
        "run",
        None,
    )?;
    Ok(PetModeResolvedTarget {
        facing,
        target_kind: PetModeTargetKind::Fallback,
        motion_outcome: if motion_completed {
            PetModeTargetMotionOutcome::Completed
        } else {
            PetModeTargetMotionOutcome::Cancelled
        },
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

#[cfg(target_os = "macos")]
fn resolve_macos_accessibility_target(
    target: &PetModeInterventionTarget,
) -> Option<PetModeTargetPoint> {
    let search_selected_tab = target.browser_name.as_deref().is_some()
        || target.lab_target == Some(PetModeLabTargetKind::BrowserTabX);
    if search_selected_tab {
        if let Some(resolved) = pet_mode_native_ax::resolve_selected_browser_tab_close(
            &target.app_name,
            target.browser_name.as_deref(),
        ) {
            // The tab strip's selected radio button is only a hotspot
            // candidate. The automatic close acts on the browser's scripted
            // active tab, and Chromium forks such as Aside can leave the strip
            // highlighting a different tab while an Agent Tab or side-panel
            // session is the page actually showing. Observed 2026-09-08: the
            // strip reported "StayFree" selected while the active tab was an
            // admin page, so the paw ran to the far-right tab edge and then
            // wore the proud face for a close it never touched. Only a
            // hotspot proven to belong to the active tab may be pointed at.
            if let Some(mismatch) = selected_tab_mismatch_diagnostic(
                &target.app_name,
                target.browser_name.as_deref(),
                resolved.selected_tab_label.as_deref(),
            ) {
                return Some(PetModeTargetPoint {
                    x: resolved.point.x,
                    y: resolved.point.y,
                    kind: PetModeTargetKind::Fallback,
                    confidence: PetModeTargetConfidence::Low,
                    diagnostic: mismatch,
                });
            }
            return Some(resolved.point);
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

/// Cross-checks the AX selected-tab label against the browser's own scripted
/// active tab. Returns a fail-closed diagnostic when the two disagree or when
/// the active tab cannot be read at all. `None` means the hotspot is safe to
/// use. Only Chromium-class browsers expose `active tab` through AppleScript
/// under that name; Safari (`current tab`) and the Firefox family keep
/// today's AX-only behaviour until they get their own verified adapter.
#[cfg(target_os = "macos")]
fn selected_tab_mismatch_diagnostic(
    app_name: &str,
    browser_name: Option<&str>,
    selected_tab_label: Option<&str>,
) -> Option<String> {
    let scripted_name = [browser_name, Some(app_name)]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|name| supports_scripted_active_tab(name))?;
    let script = format!(
        r#"tell application "{}"
  try
    if not (exists front window) then return "no_front_window"
    return "title:" & (title of active tab of front window as text)
  on error
    return "unavailable"
  end try
end tell"#,
        applescript_string_literal(scripted_name),
    );
    let output = run_osascript_with_timeout(&script, Duration::from_millis(1500));
    classify_selected_tab_cross_check(output.as_deref(), selected_tab_label)
}

/// Browsers whose scripting dictionary exposes `active tab of front window`
/// with a `title`. This mirrors the Chromium adapter used by the automatic
/// close. Safari names the same thing `current tab` and is deliberately not
/// listed until its own live probe has been run.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn supports_scripted_active_tab(app_name: &str) -> bool {
    matches!(
        app_name,
        "Google Chrome"
            | "Google Chrome Canary"
            | "Microsoft Edge"
            | "Arc"
            | "Aside"
            | "Brave Browser"
            | "Chromium"
            | "Opera"
            | "Vivaldi"
            | "Whale"
    )
}

/// Pure decision for the cross-check so it can be unit tested without AX.
/// `scripted` is the raw osascript stdout (`None` when the script failed or
/// timed out); `selected_tab_label` is the AX label of the tab that claimed
/// selection. Titles are compared after trimming, and a browser that appends
/// a window suffix (`" - Aside"`) still matches on the shared prefix.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn classify_selected_tab_cross_check(
    scripted: Option<&str>,
    selected_tab_label: Option<&str>,
) -> Option<String> {
    let scripted = scripted.map(str::trim);
    let active_title = match scripted {
        Some(value) if value.starts_with("title:") => value["title:".len()..].trim(),
        Some("no_front_window") => return Some("browser_tab_active_no_front_window".to_string()),
        _ => return Some("browser_tab_active_unavailable".to_string()),
    };
    let selected = selected_tab_label.map(str::trim).unwrap_or_default();
    if selected.is_empty() {
        return Some("browser_tab_selected_label_missing".to_string());
    }
    if active_title.is_empty() {
        // A blank active title is common on new-tab pages; the strip label is
        // then the only identity available and both usually read the same.
        // Keep today's behaviour rather than inventing a mismatch.
        return None;
    }
    let matches = active_title == selected
        || active_title.starts_with(selected)
        || selected.starts_with(active_title);
    if matches {
        None
    } else {
        Some("browser_tab_selected_mismatch".to_string())
    }
}

/// Runs an AppleScript with a hard deadline. The pet target resolver sits on
/// the contact-timeout critical path, so a hung browser must not turn a
/// cross-check into an 8-second silence.
#[cfg(target_os = "macos")]
fn run_osascript_with_timeout(script: &str, timeout: Duration) -> Option<String> {
    use std::process::Stdio;
    let mut child = Command::new("osascript")
        .args(["-e", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().ok()?;
                if !status.success() {
                    return None;
                }
                return Some(String::from_utf8_lossy(&output.stdout).into_owned());
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
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
    let target = calculate_pet_home_position_with_nudge(Some(app), &monitor);
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

fn pet_excluded_window_ids(app: &AppHandle) -> Vec<i64> {
    [
        // Exclude only transparent/auxiliary surfaces that belong to the pet
        // itself. The Drifty main window remains eligible so its controls are
        // protected exactly like controls in every other app.
        PET_MODE_WINDOW_LABEL,
        "pet-quick-controls",
        "watcher-peek",
        "companion-pill",
    ]
    .into_iter()
    .filter_map(|label| app.get_webview_window(label))
    .filter_map(|window| super::pet_mode_ax_control_veto::native_window_number(&window))
    .collect()
}

fn nudge_resident_seat(
    app: &AppHandle,
    seat: LogicalPosition<f64>,
    work_position: LogicalPosition<f64>,
    work_width: f64,
    work_height: f64,
) -> LogicalPosition<f64> {
    let resolution = resolve_resident_seat(app, seat, seat, work_position, work_width, work_height);
    LogicalPosition::new(resolution.x, resolution.y)
}

fn resolve_resident_seat(
    app: &AppHandle,
    seat: LogicalPosition<f64>,
    visible_seat: LogicalPosition<f64>,
    work_position: LogicalPosition<f64>,
    work_width: f64,
    work_height: f64,
) -> super::pet_mode_ax_control_veto::SeatResolution {
    let (width, height) = pet_size();
    let mut resolution = super::pet_mode_ax_control_veto::resolve_seat_off_ax_controls(
        pet_excluded_window_ids(app),
        seat.x,
        seat.y,
        width,
        height,
        work_position.x,
        work_width,
        visible_seat.x,
        visible_seat.y,
    );
    let clamped = clamp_pet_position(
        LogicalPosition::new(resolution.x, resolution.y),
        work_position,
        work_width,
        work_height,
    );
    resolution.x = clamped.x;
    resolution.y = clamped.y;
    resolution
}

fn apply_pet_seat_resolution(
    window: &WebviewWindow,
    visible_origin: LogicalPosition<f64>,
    resolution: super::pet_mode_ax_control_veto::SeatResolution,
    reduced_motion: bool,
    expected_motion_revision: Option<u64>,
) -> Result<super::pet_mode_ax_control_veto::SeatResolution, String> {
    if expected_motion_revision
        .is_some_and(|expected| PET_MODE_MOTION_REVISION.load(Ordering::Relaxed) != expected)
    {
        return Ok(motion_superseded_seat_resolution(window, visible_origin));
    }
    let resolution = {
        let mut pending = PET_MODE_ANCHOR_CLEAR_CONFIRMATION
            .lock()
            .map_err(|_| "Pet Mode anchor-clear confirmation lock is unavailable".to_string())?;
        confirm_anchor_clear_return(&mut pending, visible_origin, resolution, Instant::now())
    };
    let resolution = resolution.with_visible_origin(visible_origin.x, visible_origin.y);
    if expected_motion_revision
        .is_some_and(|expected| PET_MODE_MOTION_REVISION.load(Ordering::Relaxed) != expected)
    {
        return Ok(motion_superseded_seat_resolution(window, visible_origin));
    }
    #[cfg(debug_assertions)]
    eprintln!(
        "[pet-mode-seat] reason={:?} moved={} visible=({:.1},{:.1}) resolved=({:.1},{:.1})",
        resolution.reason,
        resolution.moved,
        visible_origin.x,
        visible_origin.y,
        resolution.x,
        resolution.y,
    );
    if !resolution.moved {
        return Ok(resolution);
    }
    let target = LogicalPosition::new(resolution.x, resolution.y);
    if let Some(expected) = expected_motion_revision {
        let completed = if reduced_motion {
            set_pet_window_position_if_motion_current(window, target, expected)?
        } else {
            animate_pet_window_toward_with_purpose_if_current(
                window,
                target,
                PET_MODE_WALK_SPEED,
                PET_MODE_WALK_MAX_SECONDS,
                "walk",
                "seat_correction",
                expected,
            )?
        };
        return if completed {
            Ok(resolution)
        } else {
            Ok(motion_superseded_seat_resolution(window, visible_origin))
        };
    }
    cancel_pet_motion();
    if reduced_motion {
        window
            .set_position(target)
            .map_err(|error| error.to_string())?;
    } else {
        animate_pet_window_toward_with_purpose(
            window,
            target,
            PET_MODE_WALK_SPEED,
            PET_MODE_WALK_MAX_SECONDS,
            "walk",
            "seat_correction",
        )?;
    }
    Ok(resolution)
}

fn motion_superseded_seat_resolution(
    window: &WebviewWindow,
    fallback: LogicalPosition<f64>,
) -> super::pet_mode_ax_control_veto::SeatResolution {
    use super::pet_mode_ax_control_veto::{SeatDecisionReason, SeatResolution};

    reset_anchor_clear_confirmation();
    let current = current_pet_logical_position(window).unwrap_or(fallback);
    SeatResolution::unchanged(current.x, current.y, SeatDecisionReason::MotionSuperseded)
}

fn calculate_pet_home_position(monitor: &Monitor) -> LogicalPosition<f64> {
    calculate_pet_home_position_with_nudge(None, monitor)
}

fn calculate_pet_home_position_with_nudge(
    app: Option<&AppHandle>,
    monitor: &Monitor,
) -> LogicalPosition<f64> {
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    let raw = if let Ok(preferred) = PET_MODE_PREFERRED_POSITION.lock() {
        if let Some(preferred) = *preferred {
            clamp_pet_position(preferred, position, size.width, size.height)
        } else {
            let x = default_pet_home_x(position.x, size.width, pet_width());
            clamp_pet_position(
                LogicalPosition::new(x, position.y + PET_MODE_HOME_Y),
                position,
                size.width,
                size.height,
            )
        }
    } else {
        let x = default_pet_home_x(position.x, size.width, pet_width());
        clamp_pet_position(
            LogicalPosition::new(x, position.y + PET_MODE_HOME_Y),
            position,
            size.width,
            size.height,
        )
    };
    match app {
        Some(app) => nudge_resident_seat(app, raw, position, size.width, size.height),
        None => raw,
    }
}

fn pet_entry_default_travel_distance(pet_width: f64) -> f64 {
    pet_width + PET_MODE_HOME_EDGE_INSET - pet_entry_transparent_visible_width(pet_width)
}

fn clamp_pet_entry_destination(
    preferred: LogicalPosition<f64>,
    screen_x: f64,
    screen_width: f64,
    pet_width: f64,
) -> LogicalPosition<f64> {
    let unconstrained = pet_entry_geometry(screen_x, screen_width, preferred.x, pet_width);
    let max_travel = pet_entry_max_travel_distance(pet_width);
    let travel = pet_entry_travel_distance(unconstrained.start_x, preferred.x);
    if travel <= max_travel {
        return preferred;
    }
    let direction = if unconstrained.facing == "left" {
        -1.0
    } else {
        1.0
    };
    // Show Pet stays a short run from the nearest edge. Remembered inland homes
    // remain the resident target for later walks; they just do not stretch this
    // entrance into a cross-screen slide.
    LogicalPosition::new(unconstrained.start_x + direction * max_travel, preferred.y)
}

fn default_pet_home_x(work_x: f64, work_width: f64, pet_width: f64) -> f64 {
    work_x + (work_width - pet_width - PET_MODE_HOME_EDGE_INSET).max(0.0)
}

fn calculate_pet_roam_position_with_nudge(
    app: Option<&AppHandle>,
    monitor: &Monitor,
) -> LogicalPosition<f64> {
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    let home = calculate_pet_home_position(monitor);
    let move_right = PET_MODE_ROAM_RIGHT.fetch_xor(true, Ordering::Relaxed);
    let direction = if move_right { 1.0 } else { -1.0 };
    let travel = (size.width * 0.22).clamp(180.0, 320.0);
    let raw = clamp_pet_position(
        LogicalPosition::new(home.x + direction * travel, home.y),
        position,
        size.width,
        size.height,
    );
    match app {
        Some(app) => nudge_resident_seat(app, raw, position, size.width, size.height),
        None => raw,
    }
}

fn calculate_pet_post_drop_walk_position(
    start: LogicalPosition<f64>,
    work_position: LogicalPosition<f64>,
    work_width: f64,
    work_height: f64,
    prefer_right: bool,
    pet_width: f64,
    pet_height: f64,
) -> (LogicalPosition<f64>, &'static str) {
    let min_x = work_position.x;
    let max_x = work_position.x + (work_width - pet_width).max(0.0);
    let left_space = (start.x - min_x).max(0.0);
    let right_space = (max_x - start.x).max(0.0);
    let preferred_space = if prefer_right {
        right_space
    } else {
        left_space
    };
    let alternate_space = if prefer_right {
        left_space
    } else {
        right_space
    };
    let use_preferred = preferred_space >= PET_MODE_POST_DROP_WALK_DISTANCE * 0.55
        || preferred_space >= alternate_space;
    let move_right = if use_preferred {
        prefer_right
    } else {
        !prefer_right
    };
    let available = if move_right { right_space } else { left_space };
    let travel = available.min(PET_MODE_POST_DROP_WALK_DISTANCE);
    let raw = LogicalPosition::new(start.x + if move_right { travel } else { -travel }, start.y);
    let target = clamp_pet_position_for_size(
        raw,
        work_position,
        work_width,
        work_height,
        pet_width,
        pet_height,
    );
    (target, if move_right { "right" } else { "left" })
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

fn resolve_pet_cursor_monitor(app: &AppHandle) -> Option<Monitor> {
    let cursor = app.cursor_position().ok()?;
    app.available_monitors().ok()?.into_iter().find(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        PetModePhysicalRect {
            x: position.x as f64,
            y: position.y as f64,
            width: size.width as f64,
            height: size.height as f64,
        }
        .contains((cursor.x, cursor.y))
    })
}

fn clamp_pet_position(
    target: LogicalPosition<f64>,
    work_position: LogicalPosition<f64>,
    work_width: f64,
    work_height: f64,
) -> LogicalPosition<f64> {
    let (width, height) = pet_size();
    clamp_pet_position_for_size(
        target,
        work_position,
        work_width,
        work_height,
        width,
        height,
    )
}

fn clamp_pet_position_for_size(
    target: LogicalPosition<f64>,
    work_position: LogicalPosition<f64>,
    work_width: f64,
    work_height: f64,
    pet_width: f64,
    pet_height: f64,
) -> LogicalPosition<f64> {
    let max_x = work_position.x + (work_width - pet_width).max(0.0);
    let max_y = work_position.y + (work_height - pet_height).max(0.0);
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
    if is_pet_position_in_resident_band(candidate, work_position, work_height) {
        Some(candidate)
    } else {
        current
    }
}

fn is_pet_position_in_resident_band(
    position: LogicalPosition<f64>,
    work_position: LogicalPosition<f64>,
    work_height: f64,
) -> bool {
    let center_y = position.y + pet_height() / 2.0;
    let resident_band_bottom = work_position.y + work_height * PET_MODE_RESIDENT_BAND_RATIO;
    center_y <= resident_band_bottom
}

fn resident_seat_anchor_for_current_position(
    current: LogicalPosition<f64>,
    resident_home: LogicalPosition<f64>,
    work_position: LogicalPosition<f64>,
    work_width: f64,
    work_height: f64,
) -> LogicalPosition<f64> {
    let current = clamp_pet_position(current, work_position, work_width, work_height);
    if is_pet_position_in_resident_band(current, work_position, work_height) {
        clamp_pet_position(resident_home, work_position, work_width, work_height)
    } else {
        current
    }
}

fn validate_pet_mode_stalk_request(request: PetModeStalkRequest) -> Result<(), String> {
    if !(PET_MODE_STALK_MIN_DURATION_MS..=PET_MODE_STALK_MAX_DURATION_MS)
        .contains(&request.duration_ms)
    {
        return Err("Pet Mode stalk duration is outside the safe range".to_string());
    }
    if !request.bite_gap.is_finite()
        || !(PET_MODE_STALK_MIN_BITE_GAP..=PET_MODE_STALK_MAX_BITE_GAP).contains(&request.bite_gap)
    {
        return Err("Pet Mode stalk bite gap is outside the safe range".to_string());
    }
    if !request.speed.is_finite()
        || !(PET_MODE_STALK_MIN_SPEED..=PET_MODE_STALK_MAX_SPEED).contains(&request.speed)
    {
        return Err("Pet Mode stalk speed is outside the safe range".to_string());
    }
    if !request.capture_radius.is_finite()
        || !(PET_MODE_CARRY_MIN_CAPTURE_RADIUS..=PET_MODE_CARRY_MAX_CAPTURE_RADIUS)
            .contains(&request.capture_radius)
    {
        return Err("Pet Mode stalk capture radius is outside the safe range".to_string());
    }
    if !request.turn_hysteresis.is_finite()
        || !(0.0..=PET_MODE_STALK_MAX_TURN_HYSTERESIS).contains(&request.turn_hysteresis)
    {
        return Err("Pet Mode stalk turn hysteresis is outside the safe range".to_string());
    }
    if request.turn_cooldown_ms > PET_MODE_STALK_MAX_TURN_COOLDOWN_MS {
        return Err("Pet Mode stalk turn cooldown is outside the safe range".to_string());
    }
    Ok(())
}

fn validate_pet_mode_cursor_carry_request(
    request: &PetModeCursorCarryRequest,
) -> Result<(), String> {
    if !request.target_x.is_finite() || !request.target_y.is_finite() {
        return Err("Pet Mode cursor target is invalid".to_string());
    }
    if request.approach_facing != "left" && request.approach_facing != "right" {
        return Err("Pet Mode cursor approach facing is invalid".to_string());
    }
    if !(PET_MODE_CARRY_MIN_DURATION_MS..=PET_MODE_CARRY_MAX_DURATION_MS)
        .contains(&request.duration_ms)
    {
        return Err("Pet Mode cursor carry duration is outside the safe range".to_string());
    }
    if !request.distance.is_finite()
        || !(PET_MODE_CARRY_MIN_DISTANCE..=PET_MODE_CARRY_MAX_DISTANCE).contains(&request.distance)
    {
        return Err("Pet Mode cursor carry distance is outside the safe range".to_string());
    }
    if !request.capture_radius.is_finite()
        || !(PET_MODE_CARRY_MIN_CAPTURE_RADIUS..=PET_MODE_CARRY_MAX_CAPTURE_RADIUS)
            .contains(&request.capture_radius)
    {
        return Err("Pet Mode cursor capture radius is outside the safe range".to_string());
    }
    if request.cursor_lag_ms > PET_MODE_CARRY_MAX_CURSOR_LAG_MS {
        return Err("Pet Mode cursor lag is outside the safe range".to_string());
    }
    if !request.grip_tolerance.is_finite()
        || !(PET_MODE_CARRY_MIN_ESCAPE_TOLERANCE..=PET_MODE_CARRY_MAX_ESCAPE_TOLERANCE)
            .contains(&request.grip_tolerance)
    {
        return Err("Pet Mode cursor grip tolerance is outside the safe range".to_string());
    }
    if !request.yank_distance.is_finite()
        || !(PET_MODE_CARRY_MIN_YANK_DISTANCE..=PET_MODE_CARRY_MAX_YANK_DISTANCE)
            .contains(&request.yank_distance)
        || request.yank_distance <= request.grip_tolerance
    {
        return Err("Pet Mode cursor yank distance is outside the safe range".to_string());
    }
    if !(PET_MODE_CARRY_MIN_GRIP_MS..=PET_MODE_CARRY_MAX_GRIP_LIMIT_MS)
        .contains(&request.max_grip_ms)
    {
        return Err("Pet Mode cursor grip duration is outside the safe range".to_string());
    }
    Ok(())
}

fn pet_mode_cursor_carry_progress(elapsed: Duration, duration: Duration) -> f64 {
    let timeline = (elapsed.as_secs_f64() / duration.as_secs_f64()).clamp(0.0, 1.0);
    timeline * timeline * (3.0 - 2.0 * timeline)
}

fn pet_mode_lagged_cursor_step(
    last: (f64, f64),
    desired: (f64, f64),
    frame_elapsed: Duration,
    cursor_lag: Duration,
    finished: bool,
) -> (f64, f64) {
    if cursor_lag.is_zero() || finished {
        return desired;
    }
    let alpha = 1.0 - (-frame_elapsed.as_secs_f64() / cursor_lag.as_secs_f64()).exp();
    (
        last.0 + (desired.0 - last.0) * alpha,
        last.1 + (desired.1 - last.1) * alpha,
    )
}

fn pet_mode_cursor_return_delta(
    cursor_x: f64,
    window_x: f64,
    window_width: f64,
    return_facing: &str,
    distance: f64,
    screen_frame: PetModePhysicalRect,
    work_area: PetModePhysicalRect,
) -> f64 {
    let desired = if return_facing == "right" {
        distance
    } else {
        -distance
    };
    if desired >= 0.0 {
        desired
            .min(screen_frame.x + screen_frame.width - 1.0 - cursor_x)
            .min(work_area.x + work_area.width - window_width - window_x)
            .max(0.0)
    } else {
        desired
            .max(screen_frame.x + 1.0 - cursor_x)
            .max(work_area.x - window_x)
            .min(0.0)
    }
}

/// How long the cat may keep its grip while the pointer strains against it.
///
/// Returns milliseconds of grace, in logical points of strain:
///   - at or under the tolerance the carry is unaffected
///   - just past it the cat holds on briefly, so a small nudge does not read as
///     the cursor being dropped the instant it moves
///   - at or beyond a real yank the grip is gone immediately
///
/// A single hard threshold made a twitch and a shove feel identical, which is
/// what made letting go read as arbitrary rather than as the cat responding to
/// how hard it was being fought.
fn pet_mode_carry_grip_budget_ms(
    strain: f64,
    tolerance: f64,
    yank_distance: f64,
    max_grip_ms: f64,
) -> f64 {
    if !strain.is_finite()
        || !tolerance.is_finite()
        || !yank_distance.is_finite()
        || !max_grip_ms.is_finite()
        || tolerance < 0.0
        || yank_distance <= tolerance
        || max_grip_ms < 0.0
    {
        return 0.0;
    }
    if strain <= tolerance {
        return max_grip_ms;
    }
    if strain >= yank_distance {
        return 0.0;
    }
    let span = yank_distance - tolerance;
    let past = (strain - tolerance) / span;
    // Quadratic falloff: the first few points of resistance barely shorten the
    // grip, while the last stretch collapses it. A linear ramp let a fairly
    // firm pull still hold for half the budget.
    max_grip_ms * (1.0 - past) * (1.0 - past)
}

fn pet_mode_cursor_within_capture(
    cursor: (f64, f64),
    captured: (f64, f64),
    capture_radius: f64,
) -> bool {
    (cursor.0 - captured.0).hypot(cursor.1 - captured.1) <= capture_radius
}

fn pet_mode_cursor_movement_distance(cursor: (f64, f64), origin: (f64, f64)) -> f64 {
    (cursor.0 - origin.0).hypot(cursor.1 - origin.1)
}

fn pet_mode_cursor_mouth_offset(panel_size: (f64, f64), facing: &str) -> (f64, f64) {
    let mouth_x = if facing == "left" {
        PET_MODE_CURSOR_MOUTH_X_LEFT
    } else {
        PET_MODE_CURSOR_MOUTH_X_RIGHT
    };
    (
        panel_size.0 * mouth_x / PET_MODE_WIDTH,
        panel_size.1 * PET_MODE_CURSOR_MOUTH_Y / PET_MODE_HEIGHT,
    )
}

fn pet_mode_window_with_mouth_at_cursor(
    cursor: (f64, f64),
    panel_size: (f64, f64),
    facing: &str,
) -> (f64, f64) {
    let mouth = pet_mode_cursor_mouth_offset(panel_size, facing);
    (cursor.0 - mouth.0, cursor.1 - mouth.1)
}

fn pet_mode_stalk_target(
    cursor: (f64, f64),
    panel_size: (f64, f64),
    facing: &str,
    bite_gap: f64,
    bounds: PetModePhysicalRect,
) -> (f64, f64) {
    let mouth = pet_mode_cursor_mouth_offset(panel_size, facing);
    let horizontal_gap = if facing == "left" {
        bite_gap
    } else {
        -bite_gap
    };
    let desired = (cursor.0 - mouth.0 + horizontal_gap, cursor.1 - mouth.1);
    (
        desired.0.clamp(
            bounds.x,
            (bounds.x + bounds.width - panel_size.0).max(bounds.x),
        ),
        desired.1.clamp(
            bounds.y,
            (bounds.y + bounds.height - panel_size.1).max(bounds.y),
        ),
    )
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PetModeStalkIntent {
    target: (f64, f64),
    facing: &'static str,
}

fn capture_pet_mode_stalk_intent(
    current_origin: (f64, f64),
    cursor: (f64, f64),
    panel_size: (f64, f64),
    bite_gap: f64,
    bounds: PetModePhysicalRect,
) -> PetModeStalkIntent {
    let panel_center_x = current_origin.0 + panel_size.0 / 2.0;
    let facing = if cursor.0 >= panel_center_x {
        "right"
    } else {
        "left"
    };
    PetModeStalkIntent {
        target: pet_mode_stalk_target(cursor, panel_size, facing, bite_gap, bounds),
        facing,
    }
}

fn pet_mode_chase_facing(
    current_origin: (f64, f64),
    cursor: (f64, f64),
    panel_size: (f64, f64),
    current_facing: &'static str,
    hysteresis: f64,
    may_turn: bool,
) -> &'static str {
    if !may_turn {
        return current_facing;
    }
    let center_x = current_origin.0 + panel_size.0 / 2.0;
    if cursor.0 >= center_x + hysteresis {
        "right"
    } else if cursor.0 <= center_x - hysteresis {
        "left"
    } else {
        current_facing
    }
}

fn pet_mode_stalk_step(
    current: (f64, f64),
    target: (f64, f64),
    max_step: f64,
) -> ((f64, f64), bool) {
    let delta = (target.0 - current.0, target.1 - current.1);
    let distance = delta.0.hypot(delta.1);
    if distance <= max_step || distance < 0.001 {
        return (target, true);
    }
    (
        (
            current.0 + delta.0 / distance * max_step,
            current.1 + delta.1 / distance * max_step,
        ),
        false,
    )
}

/// Total time a chase may run, scaled to how far the pointer actually is.
///
/// A fixed budget cannot serve both a cursor beside the cat and one across the
/// screen: the same number is generous for the first and impossible for the
/// second. So predict the straight-line travel at the stalk speed and add the
/// configured grace on top. The grace is the part that pays for a pointer that
/// keeps moving, which is what the user is really choosing.
///
/// `speed` is in points per second and `distance` in points, both already in
/// the same physical space as the caller's geometry.
fn pet_mode_stalk_duration_ms(distance: f64, speed: f64, grace_ms: u64) -> u64 {
    if !distance.is_finite() || !speed.is_finite() || speed <= 0.0 {
        return grace_ms;
    }
    let predicted_ms = (distance.max(0.0) / speed * 1_000.0).round();
    // Saturate instead of wrapping: an absurd predicted travel must not turn
    // into a tiny budget once it leaves f64 range.
    let predicted_ms = if predicted_ms >= u64::MAX as f64 {
        u64::MAX
    } else {
        predicted_ms as u64
    };
    predicted_ms
        .saturating_add(grace_ms)
        .min(PET_MODE_STALK_MAX_TOTAL_DURATION_MS)
}

#[cfg(target_os = "macos")]
fn primary_pointer_pressed() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
    }
    const COMBINED_SESSION_STATE: u32 = 0;
    const LEFT_MOUSE_BUTTON: u32 = 0;
    // SAFETY: This process-independent CoreGraphics query accepts the
    // documented combined-session and left-button enum values.
    unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT_MOUSE_BUTTON) }
}

#[cfg(target_os = "macos")]
fn stalk_pet_toward_cursor(
    app: &AppHandle,
    request: PetModeStalkRequest,
) -> Result<PetModeStalkResult, String> {
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Ok(PetModeStalkResult {
            outcome: PetModeStalkOutcome::Disabled,
            facing: "right",
            cursor_x: None,
            cursor_y: None,
            cursor_movement_distance: 0.0,
        });
    }
    if !window.is_visible().unwrap_or(false) {
        return Ok(PetModeStalkResult {
            outcome: PetModeStalkOutcome::Hidden,
            facing: "right",
            cursor_x: None,
            cursor_y: None,
            cursor_movement_distance: 0.0,
        });
    }

    let screens = app
        .available_monitors()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|monitor| {
            let frame_position = monitor.position();
            let frame_size = monitor.size();
            let work_area = monitor.work_area();
            (
                PetModePhysicalRect {
                    x: frame_position.x as f64,
                    y: frame_position.y as f64,
                    width: frame_size.width as f64,
                    height: frame_size.height as f64,
                },
                PetModePhysicalRect {
                    x: work_area.position.x as f64,
                    y: work_area.position.y as f64,
                    width: work_area.size.width as f64,
                    height: work_area.size.height as f64,
                },
            )
        })
        .collect::<Vec<_>>();
    let initial_cursor = app.cursor_position().map_err(|error| error.to_string())?;
    let initial_position = window.outer_position().map_err(|error| error.to_string())?;
    let panel_size = window.outer_size().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let cursor_point = (initial_cursor.x, initial_cursor.y);
    let panel_size = (panel_size.width as f64, panel_size.height as f64);
    let panel_center = (
        initial_position.x as f64 + panel_size.0 / 2.0,
        initial_position.y as f64 + panel_size.1 / 2.0,
    );
    let Some((screen_frame, work_area)) = screens
        .iter()
        .copied()
        .find(|(frame, _)| frame.contains(cursor_point))
    else {
        return Ok(PetModeStalkResult {
            outcome: PetModeStalkOutcome::DifferentDisplay,
            facing: "right",
            cursor_x: None,
            cursor_y: None,
            cursor_movement_distance: 0.0,
        });
    };
    if !screen_frame.contains(panel_center) {
        return Ok(PetModeStalkResult {
            outcome: PetModeStalkOutcome::DifferentDisplay,
            facing: "right",
            cursor_x: None,
            cursor_y: None,
            cursor_movement_distance: 0.0,
        });
    }

    let motion_revision = PET_MODE_MOTION_REVISION.fetch_add(1, Ordering::Relaxed) + 1;
    // Single-attempt mode captures one target. Chase mode refreshes it every
    // frame, so a pointer that moves is followed live instead of walked to
    // where it used to be, bounded by the budget below and turn hysteresis.
    let intent = capture_pet_mode_stalk_intent(
        (initial_position.x as f64, initial_position.y as f64),
        cursor_point,
        panel_size,
        request.bite_gap * scale_factor,
        work_area,
    );
    let mut facing = intent.facing;
    let mut target = intent.target;
    let mut captured_cursor = cursor_point;
    let mut cursor_movement_distance: f64 = 0.0;
    emit_pet_event(&window, json!({ "kind": "facing", "facing": facing }))?;
    emit_pet_event(&window, json!({ "kind": "motion", "motion": "stalk" }))?;
    thread::sleep(Duration::from_millis(34));

    let started_at = Instant::now();
    // Chase scales its budget to the opening distance so a far pointer gets the
    // travel it needs and `duration_ms` stays pure grace. Single-attempt mode
    // keeps its own fixed bound, since it never follows a moving pointer.
    let duration = Duration::from_millis(if request.retarget_cursor {
        pet_mode_stalk_duration_ms(
            pet_mode_cursor_movement_distance(
                intent.target,
                (initial_position.x as f64, initial_position.y as f64),
            ),
            request.speed * scale_factor,
            request.duration_ms,
        )
    } else {
        request.duration_ms
    });
    let turn_cooldown = Duration::from_millis(request.turn_cooldown_ms);
    let mut last_turn_at = started_at;
    let mut last_frame_at = Instant::now();
    let outcome = loop {
        if PET_MODE_MOTION_REVISION.load(Ordering::Relaxed) != motion_revision {
            break PetModeStalkOutcome::Cancelled;
        }
        if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
            break PetModeStalkOutcome::Disabled;
        }
        if primary_pointer_pressed() {
            break PetModeStalkOutcome::PointerPressed;
        }
        let cursor = app.cursor_position().map_err(|error| error.to_string())?;
        let cursor = (cursor.x, cursor.y);
        cursor_movement_distance = cursor_movement_distance
            .max(pet_mode_cursor_movement_distance(cursor, cursor_point) / scale_factor);
        if !screen_frame.contains(cursor) {
            break PetModeStalkOutcome::DifferentDisplay;
        }
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let current = (position.x as f64, position.y as f64);
        if request.retarget_cursor {
            captured_cursor = cursor;
            let next_facing = pet_mode_chase_facing(
                current,
                cursor,
                panel_size,
                facing,
                request.turn_hysteresis * scale_factor,
                last_turn_at.elapsed() >= turn_cooldown,
            );
            if next_facing != facing {
                facing = next_facing;
                last_turn_at = Instant::now();
                emit_pet_event(&window, json!({ "kind": "facing", "facing": facing }))?;
            }
            target = pet_mode_stalk_target(
                cursor,
                panel_size,
                facing,
                request.bite_gap * scale_factor,
                work_area,
            );
        }
        if started_at.elapsed() >= duration {
            // A target that cannot be reached within its budget is a miss, not
            // mouth contact. Only an actual final stalk step below may produce
            // `Completed` and unlock the bite/carry sequence.
            break PetModeStalkOutcome::TimedOut;
        }
        let elapsed = last_frame_at
            .elapsed()
            .as_secs_f64()
            .clamp(1.0 / 240.0, 0.05);
        last_frame_at = Instant::now();
        let (next, reached_target) =
            pet_mode_stalk_step(current, target, request.speed * scale_factor * elapsed);
        // Commit contact on the same frame that reaches the target. Waiting for
        // the next outer_position sample made completion depend on AppKit's
        // rounded/stale panel position, so a parked pointer could leave the cat
        // stepping in place until the user nudged it.
        window
            .set_position(PhysicalPosition::new(
                next.0.round() as i32,
                next.1.round() as i32,
            ))
            .map_err(|error| error.to_string())?;
        if reached_target {
            break PetModeStalkOutcome::Completed;
        }
        thread::sleep(Duration::from_micros(16_667));
    };

    Ok(PetModeStalkResult {
        outcome,
        facing,
        cursor_x: Some(captured_cursor.0),
        cursor_y: Some(captured_cursor.1),
        cursor_movement_distance,
    })
}

#[cfg(target_os = "macos")]
fn carry_pet_mode_cursor(
    app: &AppHandle,
    request: PetModeCursorCarryRequest,
) -> Result<PetModeCursorCarryResult, String> {
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::Disabled,
            moved_distance: 0.0,
        });
    }
    if !window.is_visible().unwrap_or(false) {
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::Hidden,
            moved_distance: 0.0,
        });
    }

    let screens = app
        .available_monitors()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|monitor| {
            let frame_position = monitor.position();
            let frame_size = monitor.size();
            let work_area = monitor.work_area();
            (
                PetModePhysicalRect {
                    x: frame_position.x as f64,
                    y: frame_position.y as f64,
                    width: frame_size.width as f64,
                    height: frame_size.height as f64,
                },
                PetModePhysicalRect {
                    x: work_area.position.x as f64,
                    y: work_area.position.y as f64,
                    width: work_area.size.width as f64,
                    height: work_area.size.height as f64,
                },
            )
        })
        .collect::<Vec<_>>();
    let captured = (request.target_x, request.target_y);
    let Some((screen_frame, work_area)) = screens
        .iter()
        .copied()
        .find(|(frame, _)| frame.contains(captured))
    else {
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::DifferentDisplay,
            moved_distance: 0.0,
        });
    };
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let initial = app.cursor_position().map_err(|error| error.to_string())?;
    let initial = (initial.x, initial.y);
    let native_initial = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .and_then(CGEvent::new)
        .map_err(|_| "Could not read the macOS cursor position".to_string())?
        .location();
    let initial_window = window.outer_position().map_err(|error| error.to_string())?;
    let initial_window = (initial_window.x as f64, initial_window.y as f64);
    let panel_size = window.outer_size().map_err(|error| error.to_string())?;
    let panel_size = (panel_size.width as f64, panel_size.height as f64);
    if !screen_frame.contains(initial) {
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::DifferentDisplay,
            moved_distance: 0.0,
        });
    }
    if !pet_mode_cursor_within_capture(initial, captured, request.capture_radius * scale_factor) {
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::CursorEscaped,
            moved_distance: 0.0,
        });
    }

    let approach_mouth = pet_mode_cursor_mouth_offset(panel_size, &request.approach_facing);
    let mouth_position = (
        initial_window.0 + approach_mouth.0,
        initial_window.1 + approach_mouth.1,
    );
    if !pet_mode_cursor_within_capture(
        initial,
        mouth_position,
        request.capture_radius * scale_factor,
    ) {
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::CursorEscaped,
            moved_distance: 0.0,
        });
    }

    let return_facing = if request.approach_facing == "right" {
        "left"
    } else {
        "right"
    };
    // Once stalk has reached the capture radius, the bite is committed. Place
    // the mirrored mouth on the cursor itself instead of preserving any small
    // approach/rounding error. The cursor now stays welded to the teeth through
    // the pivot and the first carry frame.
    let return_window = pet_mode_window_with_mouth_at_cursor(initial, panel_size, return_facing);
    if return_window.0 < work_area.x
        || return_window.0 + panel_size.0 > work_area.x + work_area.width
        || return_window.1 < work_area.y
        || return_window.1 + panel_size.1 > work_area.y + work_area.height
    {
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::CursorEscaped,
            moved_distance: 0.0,
        });
    }

    window
        .set_position(PhysicalPosition::new(
            return_window.0.round() as i32,
            return_window.1.round() as i32,
        ))
        .map_err(|error| format!("Could not pivot the Pet Mode window: {error}"))?;
    emit_pet_event(
        &window,
        json!({ "kind": "facing", "facing": return_facing }),
    )?;
    emit_pet_event(&window, json!({ "kind": "motion", "motion": "return" }))?;
    thread::sleep(Duration::from_millis(34));

    let carry_delta = pet_mode_cursor_return_delta(
        initial.0,
        return_window.0,
        panel_size.0,
        return_facing,
        request.distance * scale_factor,
        screen_frame,
        work_area,
    );
    let duration = Duration::from_millis(request.duration_ms);
    let motion_revision = PET_MODE_MOTION_REVISION.fetch_add(1, Ordering::Relaxed) + 1;
    let started_at = Instant::now();
    let mut last_commanded = initial;
    let mut straining_for = Duration::ZERO;
    let mut last_frame_at = Instant::now();
    let outcome = loop {
        if PET_MODE_MOTION_REVISION.load(Ordering::Relaxed) != motion_revision {
            break PetModeCursorCarryOutcome::Cancelled;
        }
        if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
            break PetModeCursorCarryOutcome::Disabled;
        }
        if !window.is_visible().unwrap_or(false) {
            break PetModeCursorCarryOutcome::Hidden;
        }
        if primary_pointer_pressed() {
            break PetModeCursorCarryOutcome::PointerPressed;
        }

        let cursor = app.cursor_position().map_err(|error| error.to_string())?;
        let cursor = (cursor.x, cursor.y);
        if !screen_frame.contains(cursor) {
            break PetModeCursorCarryOutcome::DifferentDisplay;
        }
        let frame_elapsed = last_frame_at.elapsed();
        let strain =
            (cursor.0 - last_commanded.0).hypot(cursor.1 - last_commanded.1) / scale_factor;
        let grip_budget_ms = pet_mode_carry_grip_budget_ms(
            strain,
            request.grip_tolerance,
            request.yank_distance,
            request.max_grip_ms as f64,
        );
        if grip_budget_ms <= 0.0 {
            break PetModeCursorCarryOutcome::CursorEscaped;
        }
        if strain > request.grip_tolerance {
            straining_for += frame_elapsed;
            if straining_for.as_secs_f64() * 1000.0 >= grip_budget_ms {
                break PetModeCursorCarryOutcome::CursorEscaped;
            }
        } else {
            // Let go of the accumulated strain once the pointer settles, so a
            // long calm carry is not ended by unrelated twitches minutes apart.
            straining_for = Duration::ZERO;
        }
        last_frame_at = Instant::now();

        let elapsed = started_at.elapsed();
        let progress = pet_mode_cursor_carry_progress(elapsed.min(duration), duration);
        let next_window_x = return_window.0 + carry_delta * progress;
        let desired_cursor = (initial.0 + carry_delta * progress, initial.1);
        // Optional Dev tuning: the cat may lead the pointer by a short, elastic
        // delay. This is exponential smoothing rather than a fixed offset, so
        // the gap grows naturally during acceleration and closes as the gait
        // eases out. The final frame always welds the cursor back to the mouth.
        let next = pet_mode_lagged_cursor_step(
            last_commanded,
            desired_cursor,
            frame_elapsed,
            Duration::from_millis(request.cursor_lag_ms),
            elapsed >= duration,
        );
        window
            .set_position(PhysicalPosition::new(
                next_window_x.round() as i32,
                return_window.1.round() as i32,
            ))
            .map_err(|error| format!("Could not carry the Pet Mode window: {error}"))?;
        let native_next = pet_mode_core_graphics_cursor_point(
            (native_initial.x, native_initial.y),
            initial,
            next,
            scale_factor,
        );
        CGDisplay::warp_mouse_cursor_position(CGPoint::new(native_next.0, native_next.1))
            .map_err(|error| format!("Could not carry the Pet Mode cursor: {error}"))?;
        last_commanded = next;
        if elapsed >= duration {
            break PetModeCursorCarryOutcome::Completed;
        }
        thread::sleep(Duration::from_micros(16_667));
    };

    Ok(PetModeCursorCarryResult {
        outcome,
        moved_distance: (last_commanded.0 - initial.0).hypot(last_commanded.1 - initial.1)
            / scale_factor,
    })
}

fn pet_mode_core_graphics_cursor_point(
    native_initial: (f64, f64),
    physical_initial: (f64, f64),
    physical_next: (f64, f64),
    scale_factor: f64,
) -> (f64, f64) {
    let scale = if scale_factor <= 0.0 {
        1.0
    } else {
        scale_factor
    };
    (
        native_initial.0 + (physical_next.0 - physical_initial.0) / scale,
        native_initial.1 + (physical_next.1 - physical_initial.1) / scale,
    )
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

fn animate_pet_window_toward_with_purpose(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    speed: f64,
    max_duration_seconds: f64,
    motion: &'static str,
    purpose: &'static str,
) -> Result<(), String> {
    let start = current_pet_logical_position(window)?;
    let facing = if target.x >= start.x { "right" } else { "left" };
    animate_pet_window_with_facing_guarded_and_purpose(
        window,
        target,
        facing,
        speed,
        max_duration_seconds,
        motion,
        None,
        Some(purpose),
        None,
    )
    .map(|_| ())
}

fn animate_pet_window_toward_with_purpose_if_current(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    speed: f64,
    max_duration_seconds: f64,
    motion: &'static str,
    purpose: &'static str,
    expected_motion_revision: u64,
) -> Result<bool, String> {
    let start = current_pet_logical_position(window)?;
    let facing = if target.x >= start.x { "right" } else { "left" };
    animate_pet_window_with_facing_guarded_and_purpose(
        window,
        target,
        facing,
        speed,
        max_duration_seconds,
        motion,
        None,
        Some(purpose),
        Some(expected_motion_revision),
    )
}

fn animate_pet_window_with_facing(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    facing: &'static str,
    speed: f64,
    max_duration_seconds: f64,
    motion: &'static str,
) -> Result<(), String> {
    animate_pet_window_with_facing_guarded(
        window,
        target,
        facing,
        speed,
        max_duration_seconds,
        motion,
        None,
    )
    .map(|_| ())
}

fn animate_pet_window_with_facing_guarded(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    facing: &'static str,
    speed: f64,
    max_duration_seconds: f64,
    motion: &'static str,
    outing_generation: Option<u64>,
) -> Result<bool, String> {
    animate_pet_window_with_facing_guarded_and_purpose(
        window,
        target,
        facing,
        speed,
        max_duration_seconds,
        motion,
        outing_generation,
        None,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn animate_pet_window_with_facing_guarded_and_purpose(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    facing: &'static str,
    speed: f64,
    max_duration_seconds: f64,
    motion: &'static str,
    outing_generation: Option<u64>,
    purpose: Option<&'static str>,
    expected_motion_revision: Option<u64>,
) -> Result<bool, String> {
    let Some(motion_revision) = begin_pet_window_motion(
        window,
        facing,
        motion,
        purpose,
        outing_generation,
        expected_motion_revision,
    )?
    else {
        return Ok(false);
    };
    // Give the webview one paint boundary to flip before the native window moves.
    thread::sleep(Duration::from_millis(34));
    animate_pet_window(
        window,
        target,
        speed,
        max_duration_seconds,
        motion_revision,
        outing_generation,
    )
}

fn begin_pet_window_motion(
    window: &WebviewWindow,
    facing: &'static str,
    motion: &'static str,
    purpose: Option<&'static str>,
    outing_generation: Option<u64>,
    expected_motion_revision: Option<u64>,
) -> Result<Option<u64>, String> {
    let _start_guard = PET_MODE_MOTION_START
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if outing_generation.is_some_and(|generation| !pet_outing_is_current(generation)) {
        return Ok(None);
    }
    let Some(motion_revision) =
        claim_pet_motion_revision(&PET_MODE_MOTION_REVISION, expected_motion_revision)
    else {
        return Ok(None);
    };
    emit_pet_event(window, json!({ "kind": "facing", "facing": facing }))?;
    let motion_event = if let Some(purpose) = purpose {
        json!({ "kind": "motion", "motion": motion, "purpose": purpose })
    } else {
        json!({ "kind": "motion", "motion": motion })
    };
    emit_pet_event(window, motion_event)?;
    Ok(Some(motion_revision))
}

fn claim_pet_motion_revision(
    revision: &AtomicU64,
    expected_motion_revision: Option<u64>,
) -> Option<u64> {
    match expected_motion_revision {
        Some(expected) => {
            let claimed = expected.wrapping_add(1);
            revision
                .compare_exchange(expected, claimed, Ordering::Relaxed, Ordering::Relaxed)
                .ok()
                .map(|_| claimed)
        }
        None => Some(revision.fetch_add(1, Ordering::Relaxed).wrapping_add(1)),
    }
}

fn set_pet_window_position_if_motion_current(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    expected_motion_revision: u64,
) -> Result<bool, String> {
    let _start_guard = PET_MODE_MOTION_START
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(motion_revision) =
        claim_pet_motion_revision(&PET_MODE_MOTION_REVISION, Some(expected_motion_revision))
    else {
        return Ok(false);
    };
    window
        .set_position(target)
        .map_err(|error| error.to_string())?;
    Ok(pet_window_motion_is_current(motion_revision, None))
}

fn animate_pet_window(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    speed: f64,
    max_duration_seconds: f64,
    motion_revision: u64,
    outing_generation: Option<u64>,
) -> Result<bool, String> {
    let start = current_pet_logical_position(window)?;
    let distance = ((target.x - start.x).powi(2) + (target.y - start.y).powi(2)).sqrt();
    if distance < 1.0 {
        if !pet_window_motion_is_current(motion_revision, outing_generation) {
            return Ok(false);
        }
        window
            .set_position(target)
            .map_err(|error| error.to_string())?;
        return Ok(pet_window_motion_is_current(
            motion_revision,
            outing_generation,
        ));
    }
    let duration_seconds = movement_duration_seconds(distance, speed, max_duration_seconds);
    let duration = Duration::from_secs_f64(duration_seconds);
    let started_at = Instant::now();
    loop {
        if !pet_window_motion_is_current(motion_revision, outing_generation) {
            return Ok(false);
        }
        let progress = (started_at.elapsed().as_secs_f64() / duration_seconds).min(1.0);
        window
            .set_position(LogicalPosition::new(
                start.x + (target.x - start.x) * progress,
                start.y + (target.y - start.y) * progress,
            ))
            .map_err(|error| error.to_string())?;
        if !pet_window_motion_is_current(motion_revision, outing_generation) {
            return Ok(false);
        }
        if progress >= 1.0 {
            break;
        }
        let elapsed = started_at.elapsed();
        let remaining = duration.saturating_sub(elapsed);
        thread::sleep(remaining.min(Duration::from_micros(16_667)));
    }
    Ok(true)
}

fn pet_window_motion_is_current(motion_revision: u64, outing_generation: Option<u64>) -> bool {
    PET_MODE_MOTION_REVISION.load(Ordering::Relaxed) == motion_revision
        && outing_generation.map_or(true, pet_outing_is_current)
}

fn cancel_pet_motion() -> bool {
    let _start_guard = PET_MODE_MOTION_START
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry_was_active = PET_MODE_ENTRY_ACTIVE.swap(false, Ordering::Relaxed);
    PET_MODE_MOTION_REVISION.fetch_add(1, Ordering::Relaxed);
    entry_was_active
}

fn recover_cancelled_pet_entry(
    app: &AppHandle,
    window: &WebviewWindow,
    entry_was_active: bool,
) -> Result<(), String> {
    if !should_recover_cancelled_pet_entry(
        entry_was_active,
        PET_MODE_ENABLED.load(Ordering::Relaxed),
    ) {
        return Ok(());
    }

    // Renderer actions such as a drift notice can legitimately take ownership
    // just after Show Pet starts an entrance. Cancelling the motion at that
    // point used to strand the panel at its transparent off-screen start while
    // the renderer reported it as visible. Finish the cancelled entrance at
    // home before the new action proceeds.
    position_pet_home(app, window, false)?;
    refresh_pet_hit_region_for_window(window)?;
    show_pet_panel(app, window)
}

fn should_recover_cancelled_pet_entry(entry_was_active: bool, enabled: bool) -> bool {
    entry_was_active && enabled
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

#[cfg(test)]
fn pet_mode_logical_cursor_sample(
    scale_factor: f64,
    cursor_x: f64,
    cursor_y: f64,
    window_x: f64,
    window_y: f64,
    window_width: f64,
    window_height: f64,
) -> (f64, f64, f64, f64, f64, f64) {
    let scale = if scale_factor <= 0.0 {
        1.0
    } else {
        scale_factor
    };
    (
        cursor_x / scale,
        cursor_y / scale,
        window_x / scale,
        window_y / scale,
        window_width / scale,
        window_height / scale,
    )
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
    fn selected_tab_cross_check_accepts_a_matching_active_tab() {
        assert_eq!(classify_selected_tab_cross_check(Some("title:StayFree\n"), Some("StayFree")), None);
        // Chromium appends memory/window suffixes to the strip label only.
        assert_eq!(
            classify_selected_tab_cross_check(
                Some("title:Billing • PostHog"),
                Some("Billing • PostHog - 메모리 사용량 - 276MB"),
            ),
            None,
        );
        // Safari reports the full window title while the strip keeps the page title.
        assert_eq!(
            classify_selected_tab_cross_check(Some("title:Apple - Safari"), Some("Apple")),
            None,
        );
        // New-tab pages have no scripted title; keep the AX hotspot.
        assert_eq!(classify_selected_tab_cross_check(Some("title:"), Some("새 탭")), None);
    }

    #[test]
    fn selected_tab_cross_check_fails_closed_on_the_observed_aside_agent_tab_shape() {
        // 2026-09-08: AX strip said "StayFree" while the browser's active tab
        // was the Agent Tab page "Content desk › drifty".
        assert_eq!(
            classify_selected_tab_cross_check(
                Some("title:Content desk › drifty"),
                Some("StayFree"),
            ),
            Some("browser_tab_selected_mismatch".to_string()),
        );
    }

    #[test]
    fn selected_tab_cross_check_fails_closed_when_the_active_tab_is_unreadable() {
        assert_eq!(
            classify_selected_tab_cross_check(None, Some("StayFree")),
            Some("browser_tab_active_unavailable".to_string()),
        );
        assert_eq!(
            classify_selected_tab_cross_check(Some("unavailable"), Some("StayFree")),
            Some("browser_tab_active_unavailable".to_string()),
        );
        assert_eq!(
            classify_selected_tab_cross_check(Some("no_front_window"), Some("StayFree")),
            Some("browser_tab_active_no_front_window".to_string()),
        );
        assert_eq!(
            classify_selected_tab_cross_check(Some("title:StayFree"), None),
            Some("browser_tab_selected_label_missing".to_string()),
        );
        assert_eq!(
            classify_selected_tab_cross_check(Some("title:StayFree"), Some("  ")),
            Some("browser_tab_selected_label_missing".to_string()),
        );
    }

    #[test]
    fn scripted_active_tab_support_mirrors_the_chromium_close_adapter() {
        for name in ["Aside", "Google Chrome", "Arc", "Whale"] {
            assert!(supports_scripted_active_tab(name), "{name}");
        }
        for name in ["Safari", "Safari Technology Preview", "Firefox", "Zen", "Floorp", "Finder", ""] {
            assert!(!supports_scripted_active_tab(name), "{name}");
        }
    }

    /// Opt-in native probe against a running browser. It only reads AX and
    /// the browser's scripting dictionary; it never moves the pet or closes
    /// anything. Run with the browser in the state under test, for example
    /// Aside showing an Agent Tab while the strip highlights another tab:
    ///
    /// `DRIFTY_NATIVE_QA_TAB_TARGET_BROWSER=Aside DRIFTY_NATIVE_QA_TAB_TARGET_EXPECT=mismatch \\`
    /// `  cargo test --manifest-path src-tauri/Cargo.toml qa_selected_tab_cross_check -- --ignored --nocapture`
    ///
    /// `EXPECT` is `mismatch` (resolver must return a Fallback target with a
    /// `browser_tab_selected_mismatch` diagnostic) or `match` (resolver must
    /// keep a BrowserTabClose target).
    #[test]
    #[ignore = "reads a real browser's AX tree after an explicit local QA opt-in"]
    #[cfg(target_os = "macos")]
    fn qa_selected_tab_cross_check_against_live_browser() {
        let browser = std::env::var("DRIFTY_NATIVE_QA_TAB_TARGET_BROWSER")
            .expect("set DRIFTY_NATIVE_QA_TAB_TARGET_BROWSER to the running browser's app name");
        let expect = std::env::var("DRIFTY_NATIVE_QA_TAB_TARGET_EXPECT")
            .expect("set DRIFTY_NATIVE_QA_TAB_TARGET_EXPECT to match or mismatch");
        let target = PetModeInterventionTarget {
            id: "qa-selected-tab-cross-check".to_string(),
            app_name: browser.clone(),
            browser_name: Some(browser.clone()),
            preview: false,
            lab_target: None,
        };
        let point = resolve_macos_accessibility_target(&target)
            .expect("browser exposed no AX target at all; is it running with a window?");
        println!(
            "qa_selected_tab_cross_check: kind={:?} confidence={:?} diagnostic={} at=({:.1},{:.1})",
            point.kind, point.confidence, point.diagnostic, point.x, point.y
        );
        match expect.as_str() {
            "mismatch" => {
                assert_eq!(point.kind, PetModeTargetKind::Fallback);
                assert_eq!(point.diagnostic, "browser_tab_selected_mismatch");
            }
            "match" => {
                assert_eq!(point.kind, PetModeTargetKind::BrowserTabClose);
                assert!(point.diagnostic.starts_with("ax_selected_tab"), "{}", point.diagnostic);
            }
            other => panic!("unknown DRIFTY_NATIVE_QA_TAB_TARGET_EXPECT={other}"),
        }
    }

    #[test]
    fn current_background_motion_claim_advances_exactly_once() {
        let revision = AtomicU64::new(41);

        assert_eq!(claim_pet_motion_revision(&revision, Some(41)), Some(42));
        assert_eq!(revision.load(Ordering::Relaxed), 42);
    }

    #[test]
    fn stale_background_motion_cannot_cancel_a_newer_foreground_motion() {
        let revision = AtomicU64::new(41);
        let observed = revision.load(Ordering::Relaxed);
        assert_eq!(claim_pet_motion_revision(&revision, None), Some(42));

        assert_eq!(claim_pet_motion_revision(&revision, Some(observed)), None);
        assert_eq!(revision.load(Ordering::Relaxed), 42);
    }

    #[test]
    fn requires_two_matching_clear_scans_before_returning_to_the_anchor() {
        use super::super::pet_mode_ax_control_veto::{SeatDecisionReason, SeatResolution};

        let visible = LogicalPosition::new(1032.0, 14.0);
        let clear = SeatResolution::unchanged(1272.0, 14.0, SeatDecisionReason::NoControlOverlap);
        let mut pending = None;
        let first_seen = Instant::now();

        let first = confirm_anchor_clear_return(&mut pending, visible, clear, first_seen);
        assert_eq!((first.x, first.y), (visible.x, visible.y));
        assert!(!first.moved);
        assert_eq!(first.reason, SeatDecisionReason::AnchorClearPending);

        let too_soon = confirm_anchor_clear_return(
            &mut pending,
            visible,
            clear,
            first_seen + Duration::from_millis(PET_MODE_ANCHOR_CLEAR_MIN_CONFIRM_MS - 1),
        );
        assert_eq!(too_soon.reason, SeatDecisionReason::AnchorClearPending);

        let second = confirm_anchor_clear_return(
            &mut pending,
            visible,
            clear,
            first_seen + Duration::from_millis(PET_MODE_ANCHOR_CLEAR_MIN_CONFIRM_MS),
        );
        assert_eq!((second.x, second.y), (1272.0, 14.0));
        assert_eq!(second.reason, SeatDecisionReason::NoControlOverlap);
        assert!(pending.is_none());
    }

    #[test]
    fn an_overlap_resets_a_pending_anchor_return() {
        use super::super::pet_mode_ax_control_veto::{SeatDecisionReason, SeatResolution};

        let visible = LogicalPosition::new(1032.0, 14.0);
        let clear = SeatResolution::unchanged(1272.0, 14.0, SeatDecisionReason::NoCandidateWindow);
        let overlap =
            SeatResolution::unchanged(visible.x, visible.y, SeatDecisionReason::ControlOverlap);
        let mut pending = None;
        let first_seen = Instant::now();

        assert_eq!(
            confirm_anchor_clear_return(&mut pending, visible, clear, first_seen).reason,
            SeatDecisionReason::AnchorClearPending
        );
        assert_eq!(
            confirm_anchor_clear_return(
                &mut pending,
                visible,
                overlap,
                first_seen + Duration::from_millis(PET_MODE_ANCHOR_CLEAR_MIN_CONFIRM_MS),
            )
            .reason,
            SeatDecisionReason::ControlOverlap
        );
        assert!(pending.is_none());
        assert_eq!(
            confirm_anchor_clear_return(
                &mut pending,
                visible,
                clear,
                first_seen + Duration::from_millis(PET_MODE_ANCHOR_CLEAR_MIN_CONFIRM_MS + 1),
            )
            .reason,
            SeatDecisionReason::AnchorClearPending
        );
    }

    /// The command hides the pet before anything validates intent, so an
    /// unrecognised action must be rejected outright rather than treated as a
    /// generic dismissal the main window never records.
    #[test]
    fn accepts_only_pet_visibility_menu_actions() {
        assert!(validate_pet_visibility_action("hideOneHour").is_ok());
        assert!(validate_pet_visibility_action("turnOff").is_ok());
        assert!(validate_pet_visibility_action("openDashboard").is_err());
        assert!(validate_pet_visibility_action("").is_err());
        assert!(validate_pet_visibility_action("hideoneHour").is_err());
    }

    #[test]
    fn entry_starts_with_only_transparent_gutter_inside_the_display() {
        for pet_width in [72.0, 108.0, 144.0, 180.0] {
            let visible_width = pet_entry_transparent_visible_width(pet_width);
            let scaled_gutter = pet_width * PET_MODE_ENTRY_TRANSPARENT_GUTTER_PX / PET_MODE_WIDTH;
            let scaled_safety = pet_width * PET_MODE_ENTRY_HIDDEN_SAFETY_PX / PET_MODE_WIDTH;
            assert!((scaled_gutter - visible_width - scaled_safety).abs() < 1e-9);
            assert!(visible_width < scaled_gutter);
        }

        let base_visible_width = pet_entry_transparent_visible_width(PET_MODE_WIDTH);
        assert!((base_visible_width - 23.329).abs() < 1e-9);

        let right = pet_entry_geometry(0.0, 1440.0, 1272.0, 144.0);
        assert_eq!(right.facing, "left");
        assert!((right.start_x - 1416.671).abs() < 1e-9);
        assert!((1440.0 - right.start_x - base_visible_width).abs() < 1e-9);

        let left = pet_entry_geometry(0.0, 1440.0, 24.0, 144.0);
        assert_eq!(left.facing, "right");
        assert!((left.start_x + 120.671).abs() < 1e-9);
        assert!((left.start_x + 144.0 - base_visible_width).abs() < 1e-9);

        let negative_origin = pet_entry_geometry(-1440.0, 1440.0, -168.0, 144.0);
        assert_eq!(negative_origin.facing, "left");
        assert!((negative_origin.start_x + base_visible_width).abs() < 1e-9);
        assert!((0.0 - negative_origin.start_x - base_visible_width).abs() < 1e-9);

        let offset_left = pet_entry_geometry(1512.0, 1920.0, 1536.0, 180.0);
        assert_eq!(offset_left.facing, "right");
        let large_visible_width = pet_entry_transparent_visible_width(180.0);
        assert!((offset_left.start_x + 180.0 - 1512.0 - large_visible_width).abs() < 1e-9);
    }

    #[test]
    fn default_home_stays_inset_from_each_work_area_right_edge() {
        assert_eq!(default_pet_home_x(0.0, 1440.0, 144.0), 1272.0);
        assert_eq!(default_pet_home_x(-1440.0, 1440.0, 144.0), -168.0);
        assert_eq!(default_pet_home_x(1512.0, 1920.0, 180.0), 3228.0);
        assert_eq!(default_pet_home_x(0.0, 120.0, 144.0), 0.0);
    }

    #[test]
    fn stale_or_cancelled_entry_motion_never_reaches_completion() {
        assert!(pet_entry_motion_matches(8, 8, true, true));
        assert!(!pet_entry_motion_matches(8, 9, true, true));
        assert!(!pet_entry_motion_matches(8, 8, false, true));
        assert!(!pet_entry_motion_matches(8, 8, true, false));
    }

    #[test]
    fn explicit_reveal_replays_entry_for_an_already_enabled_pet() {
        assert!(should_replay_pet_entry(false, false));
        assert!(should_replay_pet_entry(false, true));
        assert!(!should_replay_pet_entry(true, false));
        assert!(should_replay_pet_entry(true, true));
    }

    #[test]
    fn cancelling_an_enabled_entry_requires_native_home_recovery() {
        assert!(should_recover_cancelled_pet_entry(true, true));
        assert!(!should_recover_cancelled_pet_entry(false, true));
        assert!(!should_recover_cancelled_pet_entry(true, false));
    }

    #[test]
    fn outing_generation_rejects_stale_or_disabled_lifecycle_commands() {
        assert!(pet_outing_generation_matches(8, 8, 8, true));
        assert!(!pet_outing_generation_matches(8, 9, 9, true));
        assert!(!pet_outing_generation_matches(8, 8, 7, true));
        assert!(!pet_outing_generation_matches(8, 8, 8, false));
    }

    #[test]
    fn stale_cleanup_does_not_move_a_current_entry_home() {
        assert!(should_reconcile_pet_home(true, false));
        assert!(!should_reconcile_pet_home(true, true));
        assert!(!should_reconcile_pet_home(false, false));
    }

    #[test]
    fn entry_run_profile_matches_renderer_contract() {
        assert_eq!(PET_MODE_ENTRY_DURATION_MS, 482);
        assert_eq!(PET_MODE_ENTRY_MIN_DURATION_MS, 180);
        assert_eq!(PET_MODE_ENTRY_MAX_DURATION_MS, 700);
        assert_eq!(PET_MODE_ENTRY_ACCELERATION_RATIO, 0.10);
        assert_eq!(PET_MODE_ENTRY_DECELERATION_RATIO, 0.18);
        assert!((pet_entry_default_travel_distance(144.0) - 144.671).abs() < 1e-9);
        assert_eq!(pet_entry_duration_ms(144.671), 482);
        assert_eq!(pet_entry_duration_ms(54.0), 180);
        assert_eq!(pet_entry_duration_ms(900.0), 700);
        let inland =
            clamp_pet_entry_destination(LogicalPosition::new(700.0, 14.0), 0.0, 1440.0, 144.0);
        assert!((inland.x - (1416.671 - 210.0)).abs() < 1e-9);
        let default_home =
            clamp_pet_entry_destination(LogicalPosition::new(1272.0, 14.0), 0.0, 1440.0, 144.0);
        assert_eq!(default_home.x, 1272.0);
        assert_eq!(pet_entry_travel_progress(-1.0), 0.0);
        assert_eq!(pet_entry_travel_progress(0.0), 0.0);
        assert!((pet_entry_travel_progress(0.05) - 0.014_534_883_720_930_234).abs() < 1e-12);
        assert!((pet_entry_travel_progress(0.10) - 0.058_139_534_883_720_93).abs() < 1e-12);
        assert!((pet_entry_travel_progress(0.25) - 0.232_558_139_534_883_72).abs() < 1e-12);
        assert!((pet_entry_travel_progress(0.5) - 0.523_255_813_953_488_4).abs() < 1e-12);
        assert!((pet_entry_travel_progress(0.75) - 0.813_953_488_372_093).abs() < 1e-12);
        assert!((pet_entry_travel_progress(0.82) - 0.895_348_837_209_302_4).abs() < 1e-12);
        assert!((pet_entry_travel_progress(0.91) - 0.973_837_209_302_325_5).abs() < 1e-12);
        assert!((pet_entry_travel_progress(1.0) - 1.0).abs() < f64::EPSILON);
        assert!((pet_entry_travel_progress(2.0) - 1.0).abs() < f64::EPSILON);
    }

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
    fn stalk_target_places_the_captured_cursor_at_the_mouth_and_clamps_edges() {
        let bounds = PetModePhysicalRect {
            x: 0.0,
            y: 25.0,
            width: 1440.0,
            height: 775.0,
        };
        let target = pet_mode_stalk_target((500.0, 300.0), (144.0, 99.0), "right", 0.0, bounds);
        let mouth = pet_mode_cursor_mouth_offset((144.0, 99.0), "right");
        assert!((target.0 + mouth.0 - 500.0).abs() < f64::EPSILON);
        assert!((target.1 + mouth.1 - 300.0).abs() < f64::EPSILON);

        let edge = pet_mode_stalk_target((1438.0, 798.0), (144.0, 99.0), "right", 0.0, bounds);
        assert!((0.0..=1296.0).contains(&edge.0));
        assert!((25.0..=701.0).contains(&edge.1));
    }

    #[test]
    fn pivot_window_welds_the_cursor_to_the_mirrored_mouth() {
        let cursor = (600.0, 300.0);
        for (panel, facing) in [
            ((144.0, 99.0), "left"),
            ((144.0, 99.0), "right"),
            ((288.0, 198.0), "left"),
            ((288.0, 198.0), "right"),
        ] {
            let window = pet_mode_window_with_mouth_at_cursor(cursor, panel, facing);
            let mouth = pet_mode_cursor_mouth_offset(panel, facing);
            assert!((window.0 + mouth.0 - cursor.0).abs() < f64::EPSILON);
            assert!((window.1 + mouth.1 - cursor.1).abs() < f64::EPSILON);
        }
    }

    #[test]
    fn stalk_intent_captures_one_pointer_target_and_facing() {
        let bounds = PetModePhysicalRect {
            x: 0.0,
            y: 25.0,
            width: 1440.0,
            height: 775.0,
        };
        let captured = capture_pet_mode_stalk_intent(
            (100.0, 100.0),
            (600.0, 300.0),
            (144.0, 99.0),
            0.0,
            bounds,
        );
        let later_pointer = capture_pet_mode_stalk_intent(
            (100.0, 100.0),
            (20.0, 300.0),
            (144.0, 99.0),
            0.0,
            bounds,
        );

        assert_eq!(captured.facing, "right");
        assert_eq!(later_pointer.facing, "left");
        assert_ne!(captured.target, later_pointer.target);
    }

    #[test]
    fn stalk_step_never_overshoots_the_captured_cursor_target() {
        assert_eq!(
            pet_mode_stalk_step((0.0, 0.0), (3.0, 4.0), 2.0),
            ((1.2, 1.6), false)
        );
        assert_eq!(
            pet_mode_stalk_step((0.0, 0.0), (3.0, 4.0), 8.0),
            ((3.0, 4.0), true)
        );
    }

    #[test]
    fn chase_facing_holds_near_the_cat_and_turns_after_the_dead_zone() {
        let origin = (100.0, 100.0);
        let panel = (144.0, 99.0);
        assert_eq!(
            pet_mode_chase_facing(origin, (190.0, 200.0), panel, "left", 48.0, true),
            "left"
        );
        assert_eq!(
            pet_mode_chase_facing(origin, (240.0, 200.0), panel, "left", 48.0, true),
            "right"
        );
        assert_eq!(
            pet_mode_chase_facing(origin, (20.0, 200.0), panel, "right", 48.0, false),
            "right"
        );
    }

    #[test]
    fn chase_budget_scales_with_the_opening_distance() {
        // 660pt at 220pt/s is 3s of predicted travel, so a 2s grace yields 5s.
        assert_eq!(pet_mode_stalk_duration_ms(660.0, 220.0, 2_000), 5_000);
        // Twice the distance earns twice the travel, and the grace is untouched.
        assert_eq!(pet_mode_stalk_duration_ms(1_320.0, 220.0, 2_000), 8_000);
        // A pointer already under the cat still gets its full grace.
        assert_eq!(pet_mode_stalk_duration_ms(0.0, 220.0, 2_000), 2_000);
        // A faster cat predicts less travel for the same distance.
        assert_eq!(pet_mode_stalk_duration_ms(660.0, 330.0, 2_000), 4_000);
        // Degenerate geometry falls back to the grace alone rather than
        // dividing by zero or saturating into an effectively unbounded chase.
        assert_eq!(pet_mode_stalk_duration_ms(660.0, 0.0, 2_000), 2_000);
        assert_eq!(pet_mode_stalk_duration_ms(f64::NAN, 220.0, 2_000), 2_000);
        assert_eq!(pet_mode_stalk_duration_ms(f64::INFINITY, 220.0, 2_000), 2_000);
        assert_eq!(pet_mode_stalk_duration_ms(660.0, f64::NAN, 2_000), 2_000);
        assert_eq!(pet_mode_stalk_duration_ms(-50.0, 220.0, 2_000), 2_000);
        // However far the pointer is, one hunt stays inside the hard ceiling.
        assert_eq!(
            pet_mode_stalk_duration_ms(100_000.0, 220.0, 2_000),
            PET_MODE_STALK_MAX_TOTAL_DURATION_MS,
        );
    }

    #[test]
    fn stalk_request_rejects_unbounded_motion() {
        let valid = PetModeStalkRequest {
            duration_ms: 3_200,
            bite_gap: 0.0,
            capture_radius: 18.0,
            speed: 220.0,
            retarget_cursor: false,
            turn_hysteresis: 48.0,
            turn_cooldown_ms: 500,
        };
        assert!(validate_pet_mode_stalk_request(valid).is_ok());
        assert!(validate_pet_mode_stalk_request(PetModeStalkRequest {
            duration_ms: 8_000,
            ..valid
        })
        .is_ok());
        assert!(validate_pet_mode_stalk_request(PetModeStalkRequest {
            duration_ms: 8_001,
            ..valid
        })
        .is_err());
        assert!(validate_pet_mode_stalk_request(PetModeStalkRequest {
            retarget_cursor: true,
            duration_ms: 2_000,
            ..valid
        })
        .is_ok());
        assert!(validate_pet_mode_stalk_request(PetModeStalkRequest {
            duration_ms: 599,
            ..valid
        })
        .is_err());
        assert!(validate_pet_mode_stalk_request(PetModeStalkRequest {
            speed: f64::INFINITY,
            ..valid
        })
        .is_err());
        assert!(validate_pet_mode_stalk_request(PetModeStalkRequest {
            turn_cooldown_ms: 2_000,
            ..valid
        })
        .is_err());
    }

    #[test]
    fn cursor_return_moves_cat_and_pointer_on_one_bounded_path() {
        let screen = PetModePhysicalRect {
            x: 0.0,
            y: 0.0,
            width: 1440.0,
            height: 800.0,
        };
        let work = PetModePhysicalRect {
            x: 0.0,
            y: 25.0,
            width: 1440.0,
            height: 775.0,
        };
        assert_eq!(
            pet_mode_cursor_return_delta(600.0, 470.0, 144.0, "right", 96.0, screen, work),
            96.0,
        );
        assert_eq!(
            pet_mode_cursor_return_delta(600.0, 614.0, 144.0, "left", 96.0, screen, work),
            -96.0,
        );
        assert_eq!(
            pet_mode_cursor_return_delta(1420.0, 1280.0, 144.0, "right", 96.0, screen, work),
            16.0,
        );
        assert_eq!(
            pet_mode_cursor_return_delta(20.0, 10.0, 144.0, "left", 96.0, screen, work),
            -10.0,
        );

        let duration = Duration::from_millis(920);
        assert_eq!(
            pet_mode_cursor_carry_progress(Duration::ZERO, duration),
            0.0
        );
        assert_eq!(pet_mode_cursor_carry_progress(duration, duration), 1.0);
        let lagged = pet_mode_lagged_cursor_step(
            (0.0, 0.0),
            (100.0, 0.0),
            Duration::from_millis(16),
            Duration::from_millis(160),
            false,
        );
        assert!(lagged.0 > 0.0 && lagged.0 < 100.0);
        assert_eq!(
            pet_mode_lagged_cursor_step(
                lagged,
                (100.0, 0.0),
                Duration::from_millis(16),
                Duration::from_millis(160),
                true,
            ),
            (100.0, 0.0),
        );
        assert!(
            (pet_mode_cursor_carry_progress(Duration::from_millis(460), duration) - 0.5).abs()
                < f64::EPSILON
        );
        assert!(pet_mode_cursor_within_capture(
            (612.0, 312.0),
            (600.0, 300.0),
            18.0,
        ));
        assert!(!pet_mode_cursor_within_capture(
            (620.0, 300.0),
            (600.0, 300.0),
            18.0,
        ));
        assert_eq!(
            pet_mode_cursor_movement_distance((607.0, 300.0), (600.0, 300.0)),
            7.0,
        );

        // Letting go scales with how hard the pointer is pulled, rather than
        // ending the carry on the first twitch past the tolerance.
        assert_eq!(
            pet_mode_carry_grip_budget_ms(
                0.0,
                PET_MODE_CARRY_ESCAPE_TOLERANCE,
                PET_MODE_CARRY_YANK_DISTANCE,
                PET_MODE_CARRY_MAX_GRIP_MS,
            ),
            PET_MODE_CARRY_MAX_GRIP_MS,
        );
        assert_eq!(
            pet_mode_carry_grip_budget_ms(
                PET_MODE_CARRY_ESCAPE_TOLERANCE,
                PET_MODE_CARRY_ESCAPE_TOLERANCE,
                PET_MODE_CARRY_YANK_DISTANCE,
                PET_MODE_CARRY_MAX_GRIP_MS,
            ),
            PET_MODE_CARRY_MAX_GRIP_MS,
        );
        assert_eq!(
            pet_mode_carry_grip_budget_ms(
                PET_MODE_CARRY_YANK_DISTANCE,
                PET_MODE_CARRY_ESCAPE_TOLERANCE,
                PET_MODE_CARRY_YANK_DISTANCE,
                PET_MODE_CARRY_MAX_GRIP_MS,
            ),
            0.0
        );
        assert_eq!(
            pet_mode_carry_grip_budget_ms(
                f64::INFINITY,
                PET_MODE_CARRY_ESCAPE_TOLERANCE,
                PET_MODE_CARRY_YANK_DISTANCE,
                PET_MODE_CARRY_MAX_GRIP_MS,
            ),
            0.0,
        );
        assert_eq!(
            pet_mode_carry_grip_budget_ms(
                f64::NAN,
                PET_MODE_CARRY_ESCAPE_TOLERANCE,
                PET_MODE_CARRY_YANK_DISTANCE,
                PET_MODE_CARRY_MAX_GRIP_MS,
            ),
            0.0,
        );

        // Monotonic: pulling harder never buys a longer grip.
        let nudge = pet_mode_carry_grip_budget_ms(
            9.0,
            PET_MODE_CARRY_ESCAPE_TOLERANCE,
            PET_MODE_CARRY_YANK_DISTANCE,
            PET_MODE_CARRY_MAX_GRIP_MS,
        );
        let shove = pet_mode_carry_grip_budget_ms(
            20.0,
            PET_MODE_CARRY_ESCAPE_TOLERANCE,
            PET_MODE_CARRY_YANK_DISTANCE,
            PET_MODE_CARRY_MAX_GRIP_MS,
        );
        let yank = pet_mode_carry_grip_budget_ms(
            30.0,
            PET_MODE_CARRY_ESCAPE_TOLERANCE,
            PET_MODE_CARRY_YANK_DISTANCE,
            PET_MODE_CARRY_MAX_GRIP_MS,
        );
        assert!(nudge > shove, "nudge {nudge} shove {shove}");
        assert!(shove > yank, "shove {shove} yank {yank}");
        assert!(yank > 0.0);
        // A gentle nudge still keeps most of the grip; a firm pull keeps little.
        assert!(nudge > PET_MODE_CARRY_MAX_GRIP_MS * 0.7);
        assert!(shove < PET_MODE_CARRY_MAX_GRIP_MS * 0.35);

        // Tauri reports physical pixels while CoreGraphics warps in native
        // logical points. Preserve the current native origin and convert only
        // the carry delta so Retina and mixed-display origins cannot clamp the
        // pointer to a screen edge.
        assert_eq!(
            pet_mode_core_graphics_cursor_point(
                (1_200.0, 700.0),
                (2_400.0, 1_400.0),
                (2_304.0, 1_400.0),
                2.0,
            ),
            (1_152.0, 700.0),
        );
    }

    #[test]
    fn cursor_carry_request_defaults_new_tuning_for_older_webviews() {
        let request: PetModeCursorCarryRequest = serde_json::from_value(json!({
            "targetX": 600.0,
            "targetY": 300.0,
            "approachFacing": "right",
            "distance": 96.0,
            "durationMs": 920,
            "captureRadius": 18.0
        }))
        .expect("legacy cursor carry payload should remain readable");

        assert_eq!(request.cursor_lag_ms, PET_MODE_CARRY_DEFAULT_CURSOR_LAG_MS);
        assert_eq!(request.grip_tolerance, PET_MODE_CARRY_ESCAPE_TOLERANCE);
        assert_eq!(request.yank_distance, PET_MODE_CARRY_YANK_DISTANCE);
        assert_eq!(request.max_grip_ms, PET_MODE_CARRY_MAX_GRIP_MS as u64);
        assert!(validate_pet_mode_cursor_carry_request(&request).is_ok());
    }

    #[test]
    fn cursor_carry_request_rejects_unbounded_pointer_mutation() {
        let valid = PetModeCursorCarryRequest {
            target_x: 600.0,
            target_y: 300.0,
            approach_facing: "right".to_string(),
            distance: 96.0,
            duration_ms: 920,
            capture_radius: 18.0,
            cursor_lag_ms: 0,
            grip_tolerance: PET_MODE_CARRY_ESCAPE_TOLERANCE,
            yank_distance: PET_MODE_CARRY_YANK_DISTANCE,
            max_grip_ms: PET_MODE_CARRY_MAX_GRIP_MS as u64,
        };
        assert!(validate_pet_mode_cursor_carry_request(&valid).is_ok());
        assert!(
            validate_pet_mode_cursor_carry_request(&PetModeCursorCarryRequest {
                duration_ms: 8_000,
                ..valid.clone()
            })
            .is_ok()
        );
        assert!(
            validate_pet_mode_cursor_carry_request(&PetModeCursorCarryRequest {
                duration_ms: 8_001,
                ..valid.clone()
            })
            .is_err()
        );
        assert!(
            validate_pet_mode_cursor_carry_request(&PetModeCursorCarryRequest {
                distance: 240.0,
                ..valid.clone()
            })
            .is_err()
        );
        assert!(
            validate_pet_mode_cursor_carry_request(&PetModeCursorCarryRequest {
                cursor_lag_ms: PET_MODE_CARRY_MAX_CURSOR_LAG_MS + 1,
                ..valid.clone()
            })
            .is_err()
        );
        assert!(
            validate_pet_mode_cursor_carry_request(&PetModeCursorCarryRequest {
                grip_tolerance: PET_MODE_CARRY_MAX_ESCAPE_TOLERANCE + 1.0,
                ..valid.clone()
            })
            .is_err()
        );
        assert!(
            validate_pet_mode_cursor_carry_request(&PetModeCursorCarryRequest {
                yank_distance: PET_MODE_CARRY_ESCAPE_TOLERANCE,
                ..valid.clone()
            })
            .is_err()
        );
        assert!(
            validate_pet_mode_cursor_carry_request(&PetModeCursorCarryRequest {
                max_grip_ms: PET_MODE_CARRY_MAX_GRIP_LIMIT_MS + 1,
                ..valid.clone()
            })
            .is_err()
        );
        assert!(
            validate_pet_mode_cursor_carry_request(&PetModeCursorCarryRequest {
                approach_facing: "up".to_string(),
                ..valid
            })
            .is_err()
        );
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
    fn lower_temporary_seats_are_checked_in_place_instead_of_returning_home() {
        let work_position = LogicalPosition::new(0.0, 25.0);
        let resident_home = LogicalPosition::new(320.0, 60.0);
        let upper_visible_seat = LogicalPosition::new(560.0, 120.0);
        let lower_temporary_seat = LogicalPosition::new(700.0, 410.0);

        assert_eq!(
            resident_seat_anchor_for_current_position(
                upper_visible_seat,
                resident_home,
                work_position,
                1440.0,
                775.0,
            ),
            resident_home,
        );
        assert_eq!(
            resident_seat_anchor_for_current_position(
                lower_temporary_seat,
                resident_home,
                work_position,
                1440.0,
                775.0,
            ),
            lower_temporary_seat,
        );
    }

    #[cfg(target_os = "macos")]
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

    #[cfg(target_os = "macos")]
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

    #[cfg(target_os = "macos")]
    #[test]
    fn safari_infers_its_left_edge_tab_close_position() {
        let script = pet_target_geometry_script("Safari", true, true);
        assert!(script.contains("set inferredX to (item 1 of tabPosition) + 14"));
    }

    #[cfg(target_os = "macos")]
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
            let clamped = clamp_pet_position_for_size(
                far_off_screen,
                work_position,
                work_width,
                work_height,
                width,
                height,
            );
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
    }

    #[test]
    fn post_drop_walk_stays_on_the_drop_level_and_uses_the_reviewed_distance() {
        let start = LogicalPosition::new(600.0, 420.0);
        let (right, facing) = calculate_pet_post_drop_walk_position(
            start,
            LogicalPosition::new(0.0, 25.0),
            1440.0,
            775.0,
            true,
            144.0,
            99.0,
        );
        assert_eq!(facing, "right");
        assert!((right.x - 684.0).abs() < f64::EPSILON);
        assert!((right.y - start.y).abs() < f64::EPSILON);

        let (left, facing) = calculate_pet_post_drop_walk_position(
            start,
            LogicalPosition::new(0.0, 25.0),
            1440.0,
            775.0,
            false,
            144.0,
            99.0,
        );
        assert_eq!(facing, "left");
        assert!((left.x - 516.0).abs() < f64::EPSILON);
        assert!((left.y - start.y).abs() < f64::EPSILON);
    }

    #[test]
    fn post_drop_walk_turns_inward_when_the_release_is_at_an_edge() {
        let (target, facing) = calculate_pet_post_drop_walk_position(
            LogicalPosition::new(1.0, 300.0),
            LogicalPosition::new(0.0, 25.0),
            1440.0,
            775.0,
            false,
            144.0,
            99.0,
        );
        assert_eq!(facing, "right");
        assert!((target.x - 85.0).abs() < f64::EPSILON);
        assert!((target.y - 300.0).abs() < f64::EPSILON);
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
    fn cursor_sample_converts_physical_pixels_into_logical_points() {
        let (cursor_x, cursor_y, window_x, window_y, window_width, window_height) =
            pet_mode_logical_cursor_sample(2.0, 2440.0, 94.0, 2160.0, 0.0, 288.0, 198.0);
        assert!((cursor_x - 1220.0).abs() < 1e-9);
        assert!((cursor_y - 47.0).abs() < 1e-9);
        assert!((window_x - 1080.0).abs() < 1e-9);
        assert!((window_y - 0.0).abs() < 1e-9);
        assert!((window_width - 144.0).abs() < 1e-9);
        assert!((window_height - 99.0).abs() < 1e-9);
    }

    #[test]
    fn preview_actions_accept_active_life_loop_tail_note_sleep_drift_and_cursor_hunt_wire_values() {
        let life_loop: PetModePreviewAction = serde_json::from_str("\"life_loop\"").unwrap();
        let tail: PetModePreviewAction = serde_json::from_str("\"tail_flick\"").unwrap();
        let note: PetModePreviewAction = serde_json::from_str("\"music_note\"").unwrap();
        let stretch_note: PetModePreviewAction =
            serde_json::from_str("\"stretch_with_note\"").unwrap();
        let tail_note: PetModePreviewAction =
            serde_json::from_str("\"tail_flick_with_note\"").unwrap();
        let angry_wake: PetModePreviewAction =
            serde_json::from_str("\"sleep_angry_wake\"").unwrap();
        let sit: PetModePreviewAction = serde_json::from_str("\"sit\"").unwrap();
        let sleep_drift_notice: PetModePreviewAction =
            serde_json::from_str("\"sleep_drift_notice\"").unwrap();
        let sleep_drift_full_preview: PetModePreviewAction =
            serde_json::from_str("\"sleep_drift_full_preview\"").unwrap();
        let hunt_single: PetModePreviewAction =
            serde_json::from_str("\"cursor_hunt_single\"").unwrap();
        let hunt_chase: PetModePreviewAction =
            serde_json::from_str("\"cursor_hunt_chase\"").unwrap();
        assert!(matches!(life_loop, PetModePreviewAction::LifeLoop));
        assert!(matches!(tail, PetModePreviewAction::TailFlick));
        assert!(matches!(note, PetModePreviewAction::MusicNote));
        assert!(matches!(
            stretch_note,
            PetModePreviewAction::StretchWithNote
        ));
        assert!(matches!(tail_note, PetModePreviewAction::TailFlickWithNote));
        assert!(matches!(angry_wake, PetModePreviewAction::SleepAngryWake));
        assert!(matches!(sit, PetModePreviewAction::Sit));
        assert!(matches!(
            sleep_drift_notice,
            PetModePreviewAction::SleepDriftNotice
        ));
        assert!(matches!(
            sleep_drift_full_preview,
            PetModePreviewAction::SleepDriftFullPreview
        ));
        assert!(matches!(
            hunt_single,
            PetModePreviewAction::CursorHuntSingle
        ));
        assert!(matches!(hunt_chase, PetModePreviewAction::CursorHuntChase));
    }
}
