use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    async_runtime, AppHandle, Emitter, LogicalPosition, Manager, Monitor,
    PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
#[cfg(not(target_os = "macos"))]
use tauri::LogicalSize;

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

use super::extreme_nudge::closes_through_native_ax_selection;
#[cfg(target_os = "macos")]
use super::extreme_nudge::{preflight_native_ax_tab_close, NativeAxCloseHotspot};
use super::pet_drop::{
    clamp_floor_home_pt, plan_pet_drop_with_floor_home, plan_pet_shake_floor_drop, PetDropKind,
    PetDropPlan, PetRect, PET_DROP_FLOOR_HOME_PT,
};
use super::pet_drop_windows::{inferred_bottom_dock, list_on_screen_ledges};
use super::pet_hit_region::{
    install_pet_hit_region_monitor, pet_hit_region_geometry_refresh_needed,
    pet_hit_region_pointer_inside, refresh_pet_hit_region_for_window, reset_pet_hit_region,
    set_pet_window_interactive,
};
use super::pet_panel::{
    configure_pet_panel, perform_pet_panel_drag, show_pet_panel, show_pet_panel_at_position,
};
use super::windows_overlay::{hide_windows_overlay, is_windows_overlay_visible};
use super::pet_render_geometry::{pet_render_layout, PetRenderGeometry};

#[cfg(target_os = "macos")]
#[path = "pet_fullscreen.rs"]
mod pet_fullscreen;
#[cfg(target_os = "macos")]
#[path = "pet_mode_native_ax.rs"]
mod pet_mode_native_ax;
#[cfg(target_os = "windows")]
#[path = "pet_mode_windows.rs"]
mod pet_mode_windows;

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
// Automatic-close approaches are 5% calmer than the generic run and preview return.
// Keeping this separate prevents an intervention polish pass from changing
// unrelated entry and homecoming behavior.
const PET_MODE_INTERVENTION_RUN_SPEED: f64 = 285.0;
const PET_MODE_INTERVENTION_RUN_ACCELERATION_MAX_SECONDS: f64 = 0.080;
const PET_MODE_INTERVENTION_RUN_DECELERATION_MAX_SECONDS: f64 = 0.160;
const PET_MODE_INTERVENTION_RUN_ACCELERATION_MAX_RATIO: f64 = 0.08;
const PET_MODE_INTERVENTION_RUN_DECELERATION_MAX_RATIO: f64 = 0.20;
const PET_MODE_INTERVENTION_RUN_START_DELAY_MS: u64 = 34;
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
// Shortest trip the cat animates at full motion; keeps tiny nudges legible.
const PET_MODE_MIN_MOVEMENT_SECONDS: f64 = 0.18;
const PET_MODE_AUTONOMOUS_ROAM_PURPOSE: &str = "autonomous_roam";
const PET_MODE_SEAT_CORRECTION_PURPOSE: &str = "seat_correction";
// Same bounded walk as a seat correction, but announced separately so the
// webview knows the cat was asleep and wakes it with drowsy eyes.
const PET_MODE_DROWSY_SEAT_CORRECTION_PURPOSE: &str = "drowsy_seat_correction";
// Entrances use the same offscreen origin and walking pace as outing returns.
const PET_MODE_OUTING_EDGE_GAP: f64 = 12.0;
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
static PET_MODE_QUICK_CONTROLS_GENERATION: AtomicU64 = AtomicU64::new(0);
static PET_MODE_DRAG_SESSION: Mutex<PetDragSessionState> = Mutex::new(PetDragSessionState {
    closed: false,
    epoch: 0,
    current: None,
    canonical_grab: None,
    latest_request_id: None,
});
// Motion starts are tiny critical sections: claim a revision and emit the
// matching renderer pose as one ordered operation. This prevents a stale
// background seat scan from publishing `walk` after a newer intervention has
// already published `run`.
static PET_MODE_MOTION_START: Mutex<PetModeMotionState> = Mutex::new(PetModeMotionState {
    active: None,
    quick_controls_hold: None,
});
static PET_MODE_PREVIEW_RETURN: AtomicBool = AtomicBool::new(false);
static PET_MODE_PREFERRED_POSITION: Mutex<Option<LogicalPosition<f64>>> = Mutex::new(None);
static PET_MODE_ANCHOR_CLEAR_CONFIRMATION: Mutex<Option<PetModeAnchorClearConfirmation>> =
    Mutex::new(None);
/// The authored body scene's current logical size, independent of transparent
/// rendering padding. Placement, feet, mouth, home, and contact math use this.
static PET_MODE_SIZE: Mutex<(f64, f64)> = Mutex::new((PET_MODE_WIDTH, PET_MODE_HEIGHT));
static PET_MODE_GEOMETRY_REVISION: AtomicU64 = AtomicU64::new(0);
static PET_MODE_GEOMETRY_APPLYING: AtomicBool = AtomicBool::new(false);
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
static PET_MODE_GEOMETRY_TRANSACTION: Mutex<()> = Mutex::new(());
/// Visible dance extent above the authored scene. This is an edge-placement
/// policy, not a native window resize or the surface's transparent padding.
const PET_MODE_DANCE_HEADROOM_PT: f64 = 36.0;
/// The original body origin before a dance's temporary screen-edge correction.
static PET_MODE_DANCE_ORIGIN: Mutex<Option<LogicalPosition<f64>>> = Mutex::new(None);
static PET_MODE_FLOOR_HOME_PT: Mutex<f64> = Mutex::new(PET_DROP_FLOOR_HOME_PT);
static PET_MODE_PREVIEW_RETURN_POSITION: Mutex<Option<LogicalPosition<f64>>> = Mutex::new(None);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PetModeMotionPurpose {
    AutonomousRoam,
    SeatCorrection,
    Protected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PetModeActiveMotion {
    revision: u64,
    purpose: PetModeMotionPurpose,
}

#[derive(Debug)]
struct PetModeMotionState {
    active: Option<PetModeActiveMotion>,
    quick_controls_hold: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PetQuickControlsInteractionPolicy {
    Allow,
    InterruptAutonomousRoam,
    Deny,
}

fn pet_quick_controls_interaction_policy(
    entry_active: bool,
    drag_active: bool,
    active_motion: Option<PetModeMotionPurpose>,
) -> PetQuickControlsInteractionPolicy {
    if entry_active || drag_active {
        return PetQuickControlsInteractionPolicy::Deny;
    }
    match active_motion {
        None => PetQuickControlsInteractionPolicy::Allow,
        Some(PetModeMotionPurpose::AutonomousRoam) => {
            PetQuickControlsInteractionPolicy::InterruptAutonomousRoam
        }
        Some(PetModeMotionPurpose::SeatCorrection | PetModeMotionPurpose::Protected) => {
            PetQuickControlsInteractionPolicy::Deny
        }
    }
}

fn pet_motion_purpose(purpose: Option<&str>) -> PetModeMotionPurpose {
    match purpose {
        Some(PET_MODE_AUTONOMOUS_ROAM_PURPOSE) => PetModeMotionPurpose::AutonomousRoam,
        Some(PET_MODE_SEAT_CORRECTION_PURPOSE | PET_MODE_DROWSY_SEAT_CORRECTION_PURPOSE) => {
            PetModeMotionPurpose::SeatCorrection
        }
        _ => PetModeMotionPurpose::Protected,
    }
}

fn emit_pet_quick_controls_hold(window: &WebviewWindow, held: bool, generation: u64) {
    let _ = window.emit(
        "pet-quick-controls-hold",
        json!({
            "held": held,
            "generation": generation,
        }),
    );
}

pub(super) fn begin_pet_quick_controls_interaction(app: &AppHandle) -> Result<Option<u64>, String> {
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let generation = {
        let mut motion_state = PET_MODE_MOTION_START
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(generation) = motion_state.quick_controls_hold {
            return Ok(Some(generation));
        }
        let policy = pet_quick_controls_interaction_policy(
            PET_MODE_ENTRY_ACTIVE.load(Ordering::Relaxed),
            pet_drag_is_active(),
            motion_state.active.map(|active| active.purpose),
        );
        match policy {
            PetQuickControlsInteractionPolicy::Deny => return Ok(None),
            PetQuickControlsInteractionPolicy::InterruptAutonomousRoam => {
                PET_MODE_MOTION_REVISION.fetch_add(1, Ordering::Relaxed);
                motion_state.active = None;
            }
            PetQuickControlsInteractionPolicy::Allow => {}
        }
        let generation = PET_MODE_QUICK_CONTROLS_GENERATION
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1)
            .max(1);
        motion_state.quick_controls_hold = Some(generation);
        generation
    };

    // Drain every position closure queued before the revision change. The
    // position is sampled only after this main-thread boundary, so layout gets
    // a stable anchor and no stale roam frame can land after the controls show.
    let (sender, receiver) = mpsc::sync_channel(1);
    if let Err(error) = app.run_on_main_thread(crate::panic_guard::contained("pet_mode::begin_pet_quick_controls_interaction", move || {
        let _ = sender.send(());
    })) {
        let _ = end_pet_quick_controls_interaction(app, generation);
        return Err(error.to_string());
    }
    if receiver.recv().is_err() {
        let _ = end_pet_quick_controls_interaction(app, generation);
        return Err("Pet Mode quick-controls hold boundary was dropped".to_string());
    }
    if let Err(error) = current_pet_logical_position(&window) {
        let _ = end_pet_quick_controls_interaction(app, generation);
        return Err(error);
    }
    {
        let motion_state = PET_MODE_MOTION_START
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if motion_state.quick_controls_hold != Some(generation) {
            return Ok(None);
        }
        // Serialize the held notification with revocation. A revoke that wins
        // this lock emits only `held: false`; one that follows emits false
        // after this true event, so the renderer cannot resurrect a stale hold.
        emit_pet_quick_controls_hold(&window, true, generation);
    }
    Ok(Some(generation))
}

pub(super) fn end_pet_quick_controls_interaction(
    app: &AppHandle,
    generation: u64,
) -> Result<(), String> {
    let released = {
        let mut motion_state = PET_MODE_MOTION_START
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if motion_state.quick_controls_hold != Some(generation) {
            return Ok(());
        }
        motion_state.quick_controls_hold = None;
        true
    };
    if released {
        if let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) {
            emit_pet_quick_controls_hold(&window, false, generation);
        }
    }
    Ok(())
}

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
    /// Captured executable identity used only by the native Windows resolver.
    /// Raw activity identity must not cross into the isolated pet WebView.
    #[serde(default, skip_serializing)]
    pub browser_identity: Option<String>,
    /// Captured page identity used only by the native Windows resolver.
    #[serde(default, skip_serializing)]
    pub site_domain: Option<String>,
    /// Captured page identity used only by the native Windows resolver.
    #[serde(default, skip_serializing)]
    pub site_url: Option<String>,
    #[serde(default)]
    pub preview: bool,
    #[serde(default)]
    pub lab_target: Option<PetModeLabTargetKind>,
}

// The main renderer supplies exact browser/page identity, but the pet WebView
// receives only the public animation target. Keep at most one pending native
// capability and consume it when the pet asks Rust to resolve the X position.
// A newer intervention supersedes a lost/stale one instead of accumulating raw
// local activity data in process memory.
static PET_MODE_PENDING_INTERVENTION: Mutex<Option<PetModeInterventionTarget>> = Mutex::new(None);

fn same_public_intervention(
    stored: &PetModeInterventionTarget,
    incoming: &PetModeInterventionTarget,
) -> bool {
    stored.id == incoming.id
        && stored.app_name == incoming.app_name
        && stored.browser_name == incoming.browser_name
        && stored.preview == incoming.preview
        && stored.lab_target == incoming.lab_target
}

fn remember_pet_mode_intervention(target: &PetModeInterventionTarget) -> Result<(), String> {
    *PET_MODE_PENDING_INTERVENTION
        .lock()
        .map_err(|_| "Pet Mode intervention identity lock is unavailable".to_string())? =
        Some(target.clone());
    Ok(())
}

fn take_pet_mode_intervention(incoming: PetModeInterventionTarget) -> PetModeInterventionTarget {
    let Ok(mut pending) = PET_MODE_PENDING_INTERVENTION.lock() else {
        return incoming;
    };
    if pending
        .as_ref()
        .is_some_and(|stored| same_public_intervention(stored, &incoming))
    {
        return pending.take().unwrap_or(incoming);
    }
    incoming
}

fn clear_pet_mode_intervention(id: &str) {
    if let Ok(mut pending) = PET_MODE_PENDING_INTERVENTION.lock() {
        if pending.as_ref().is_some_and(|target| target.id == id) {
            *pending = None;
        }
    }
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
    /// Captured executable path. Windows Lab close refuses without it.
    #[serde(default)]
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub browser_identity: Option<String>,
    /// Captured page identity. Windows Lab close refuses without a URL or domain.
    #[serde(default)]
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub site_domain: Option<String>,
    #[serde(default)]
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub site_url: Option<String>,
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
    Dance,
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

impl PetModePreviewAction {
    /// Lab actions are commands: a busy cat drops what it is doing and obeys.
    /// Native travel (roam, outing, intervention run) has to stop here before
    /// the renderer swaps the pose, otherwise the new pose slides across the
    /// desktop on the old motion. Only the additive accent and the loop toggle
    /// layer onto the current activity without taking it over.
    fn preempts_native_motion(self) -> bool {
        !matches!(self, Self::MusicNote | Self::LifeLoop)
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_scale_factor: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_scale_factor: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_dpi_awareness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_dpi_awareness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_monitor_scale_factor: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub windows_dpi_events: Option<PetModeWindowsDpiEvents>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub windows_input: Option<super::pet_hit_region::WindowsPetInputDiagnostics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub windows_surface: Option<WindowsPetSurfaceBounds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_render_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_render_height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sampled_at_ms: Option<u64>,
}

use super::pet_surface::WindowsPetSurfaceBounds;

/// Bounded, memory-only pet message and native policy call observations.
/// These are receipts, not proof that a scale or rendering frame was applied.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetModeWindowsDpiEvents {
    pub native_message_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_last_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_last_dpi_x: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_last_dpi_y: Option<u32>,
    pub tauri_scale_change_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tauri_last_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tauri_last_scale_factor: Option<f64>,
    pub setting_change_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setting_change_last_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setting_change_last_wparam: Option<u32>,
    pub display_change_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_change_last_at_ms: Option<u64>,
    pub policy_frame_change_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy_frame_change_last_at_ms: Option<u64>,
}

#[cfg(any(target_os = "windows", test))]
impl PetModeWindowsDpiEvents {
    fn record_native_message(&mut self, wparam: usize, at_ms: u64) {
        self.native_message_count = self.native_message_count.saturating_add(1);
        self.native_last_at_ms = Some(at_ms);
        // WM_DPICHANGED carries numeric X/Y DPI in LOWORD/HIWORD. Do not
        // inspect its HWND or suggested-rectangle pointer for this receipt.
        self.native_last_dpi_x = Some((wparam & 0xffff) as u32);
        self.native_last_dpi_y = Some(((wparam >> 16) & 0xffff) as u32);
    }

    fn record_tauri_scale_change(&mut self, scale_factor: f64, at_ms: u64) {
        self.tauri_scale_change_count = self.tauri_scale_change_count.saturating_add(1);
        self.tauri_last_at_ms = Some(at_ms);
        self.tauri_last_scale_factor =
            (scale_factor.is_finite() && scale_factor > 0.0).then_some(scale_factor);
    }

    fn record_setting_change(&mut self, wparam: usize, at_ms: u64) {
        self.setting_change_count = self.setting_change_count.saturating_add(1);
        self.setting_change_last_at_ms = Some(at_ms);
        // The documented system uiAction is UINT-sized. Never read the
        // LPARAM string: this numeric value alone does not identify DPI.
        self.setting_change_last_wparam = Some((wparam & u32::MAX as usize) as u32);
    }

    fn record_display_change(&mut self, at_ms: u64) {
        self.display_change_count = self.display_change_count.saturating_add(1);
        self.display_change_last_at_ms = Some(at_ms);
    }

    fn record_policy_frame_change(&mut self, at_ms: u64) {
        self.policy_frame_change_count = self.policy_frame_change_count.saturating_add(1);
        self.policy_frame_change_last_at_ms = Some(at_ms);
    }
}

#[cfg(target_os = "windows")]
static PET_WINDOWS_DPI_EVENTS: Mutex<PetModeWindowsDpiEvents> =
    Mutex::new(PetModeWindowsDpiEvents {
        native_message_count: 0,
        native_last_at_ms: None,
        native_last_dpi_x: None,
        native_last_dpi_y: None,
        tauri_scale_change_count: 0,
        tauri_last_at_ms: None,
        tauri_last_scale_factor: None,
        setting_change_count: 0,
        setting_change_last_at_ms: None,
        setting_change_last_wparam: None,
        display_change_count: 0,
        display_change_last_at_ms: None,
        policy_frame_change_count: 0,
        policy_frame_change_last_at_ms: None,
    });

#[cfg(target_os = "windows")]
fn pet_dpi_event_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(target_os = "windows")]
pub(super) fn record_windows_pet_dpi_message(wparam: usize) {
    PET_WINDOWS_DPI_EVENTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .record_native_message(wparam, pet_dpi_event_timestamp_ms());
}

#[cfg(target_os = "windows")]
fn record_windows_pet_tauri_scale_change(scale_factor: f64) {
    PET_WINDOWS_DPI_EVENTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .record_tauri_scale_change(scale_factor, pet_dpi_event_timestamp_ms());
}

#[cfg(target_os = "windows")]
pub(super) fn record_windows_pet_setting_change(wparam: usize) {
    PET_WINDOWS_DPI_EVENTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .record_setting_change(wparam, pet_dpi_event_timestamp_ms());
}

#[cfg(target_os = "windows")]
pub(super) fn record_windows_pet_display_change() {
    PET_WINDOWS_DPI_EVENTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .record_display_change(pet_dpi_event_timestamp_ms());
}

/// Record the actual policy FRAMECHANGED call attempt before entering Win32.
/// The lock is released on return, before a reentrant DPI message can arrive.
#[cfg(target_os = "windows")]
pub(super) fn record_windows_pet_policy_frame_change() {
    PET_WINDOWS_DPI_EVENTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .record_policy_frame_change(pet_dpi_event_timestamp_ms());
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
    #[serde(skip_serializing_if = "Option::is_none")]
    manual_request_id: Option<String>,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
}

#[derive(Clone, Debug)]
pub(super) struct PetDragLease {
    lifetime: Arc<AtomicBool>,
    manual_request_id: Option<String>,
}

impl PetDragLease {
    fn new(manual_request_id: Option<String>) -> Result<Self, String> {
        if manual_request_id.as_ref().is_some_and(|id| {
            id.len() != 20
                || id.as_bytes()[13] != b'-'
                || !id.as_bytes()[..13].iter().all(u8::is_ascii_digit)
                || !id.as_bytes()[14..].iter().all(u8::is_ascii_digit)
        }) {
            return Err("Pet Mode manual request ID is invalid".to_string());
        }
        Ok(Self {
            lifetime: Arc::new(AtomicBool::new(true)),
            manual_request_id,
        })
    }

    pub(super) fn ensure_current(&self) -> Result<(), String> {
        let state = PET_MODE_DRAG_SESSION
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.is_current(self) {
            Ok(())
        } else {
            Err("Pet Mode drag was cancelled".to_string())
        }
    }
}

struct PetDragSessionState {
    closed: bool,
    epoch: u64,
    current: Option<PetDragLease>,
    canonical_grab: Option<(f64, f64)>,
    latest_request_id: Option<String>,
}

impl PetDragSessionState {
    fn is_current(&self, lease: &PetDragLease) -> bool {
        lease.lifetime.load(Ordering::Acquire)
            && self
                .current
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(&current.lifetime, &lease.lifetime))
    }

    fn claim(&mut self, lease: &PetDragLease, eligible: bool, expected_epoch: u64) -> bool {
        // Older clients keep their untagged contract until this process sees
        // a tagged renderer. Afterwards an unorderable delayed request must
        // not replace a newer tagged gesture.
        if self.closed
            || !eligible
            || self.epoch != expected_epoch
            || !lease.lifetime.load(Ordering::Acquire)
            || (lease.manual_request_id.is_none() && self.latest_request_id.is_some())
            || lease
                .manual_request_id
                .as_ref()
                .zip(self.latest_request_id.as_ref())
                .is_some_and(|(id, latest)| id <= latest)
        {
            return false;
        }
        self.retire_current();
        if let Some(id) = &lease.manual_request_id {
            self.latest_request_id = Some(id.clone());
        }
        self.current = Some(lease.clone());
        true
    }

    fn invalidate(&mut self, close: bool) {
        self.closed |= close;
        self.epoch = self.epoch.wrapping_add(1);
        self.retire_current();
    }

    fn retire_current(&mut self) {
        if let Some(current) = self.current.take() {
            current.lifetime.store(false, Ordering::Release);
        }
        self.canonical_grab = None;
    }

    fn finish(&mut self, lease: &PetDragLease) {
        if self
            .current
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(&current.lifetime, &lease.lifetime))
        {
            self.retire_current();
        }
        lease.lifetime.store(false, Ordering::Release);
    }

    #[cfg(any(target_os = "macos", target_os = "windows", test))]
    fn set_grab(&mut self, lease: &PetDragLease, point: (f64, f64)) -> bool {
        if !self.is_current(lease) {
            return false;
        }
        self.canonical_grab = Some(point);
        true
    }
}

// Drop also closes a request whose owner callback has not run yet: a timeout
// or panic must never leave a late callback able to claim a drag session.
struct PetDragLeaseGuard(PetDragLease);
impl Drop for PetDragLeaseGuard {
    fn drop(&mut self) {
        PET_MODE_DRAG_SESSION
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .finish(&self.0);
    }
}

fn pet_drag_is_active() -> bool {
    let state = PET_MODE_DRAG_SESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    state
        .current
        .as_ref()
        .is_some_and(|lease| state.is_current(lease))
}

fn invalidate_pet_drag_session(
    window: &WebviewWindow,
    visibility_generation: u64,
) -> Result<bool, String> {
    // Serialize cancellation with owner applies/emits. A stale lifecycle
    // callback cannot cancel a gesture belonging to a newer reveal.
    run_pet_native_transaction(window, "pet_mode::cancel_drag", move |_| {
        if visibility_generation != PET_MODE_VISIBILITY_GENERATION.load(Ordering::SeqCst) {
            return Ok(false);
        }
        PET_MODE_DRAG_SESSION
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .invalidate(false);
        Ok(true)
    })
}

pub(crate) fn cancel_pet_native_drag_for_app_exit() {
    PET_MODE_DRAG_SESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .invalidate(true);
}

pub(super) fn emit_pet_drag_event<P: Serialize>(
    window: &WebviewWindow,
    lease: &PetDragLease,
    name: &'static str,
    payload: P,
) -> Result<(), String> {
    let payload = serde_json::to_value(payload).map_err(|error| error.to_string())?;
    let payload = pet_drag_event_payload(name, lease.manual_request_id.as_deref(), payload);
    let lease = lease.clone();
    run_pet_native_transaction(window, "pet_mode::emit_drag_event", move |window| {
        lease.ensure_current()?;
        window
            .emit(name, payload)
            .map_err(|error| error.to_string())
    })
}

fn pet_drag_event_payload(name: &str, manual_request_id: Option<&str>, payload: Value) -> Value {
    match (name, manual_request_id) {
        ("pet-mode-drag-end", _) | (_, None) => payload,
        (_, Some(id)) => json!({ "manualRequestId": id, "value": payload }),
    }
}

#[derive(Clone, Debug)]
struct PetModeTargetPoint {
    x: f64,
    y: f64,
    kind: PetModeTargetKind,
    confidence: PetModeTargetConfidence,
    diagnostic: String,
}

/// Authored body scene width/height in logical points. Rendering padding is
/// excluded; a poisoned lock falls back to the canonical body geometry.
pub(super) fn pet_size() -> (f64, f64) {
    PET_MODE_SIZE
        .lock()
        .map(|size| *size)
        .unwrap_or((PET_MODE_WIDTH, PET_MODE_HEIGHT))
}

pub(super) fn current_pet_render_geometry() -> PetRenderGeometry {
    pet_render_layout().geometry(pet_width())
}

pub(super) fn pet_geometry_transition_active() -> bool {
    PET_MODE_GEOMETRY_APPLYING.load(Ordering::Acquire)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(super) fn set_pet_drag_grab_point(lease: &PetDragLease, point: (f64, f64)) -> Result<(), String> {
    if PET_MODE_DRAG_SESSION.lock().unwrap_or_else(|error| error.into_inner()).set_grab(lease, point) {
        Ok(())
    } else {
        Err("Pet Mode drag was cancelled".to_string())
    }
}

#[cfg(target_os = "windows")]
fn schedule_windows_pet_dpi_refresh(window: WebviewWindow) {
    // Tao emits ScaleFactorChanged before completing WM_DPICHANGED's own
    // SetWindowPos. Queue from a worker so our authoritative frame is applied
    // after that message, using the latest DPI and body size rather than the
    // event's potentially superseded values.
    drop(async_runtime::spawn_blocking(move || {
        let result = run_pet_native_transaction(
            &window,
            "pet_mode::refresh_windows_dpi",
            |window| {
                #[cfg(debug_assertions)]
                let before = window.outer_size().map_err(|error| error.to_string())?;
                let result = apply_pet_mode_geometry_for_revision(
                    &window,
                    pet_width(),
                    PET_MODE_GEOMETRY_REVISION.load(Ordering::SeqCst),
                    true,
                );
                #[cfg(debug_assertions)]
                eprintln!(
                    "[pet-mode-dpi] scale={:?} frame_before={before:?} frame_after={:?}",
                    window.scale_factor(),
                    window.outer_size(),
                );
                super::pet_quick_controls::refresh_windows_quick_controls_dpi(
                    window.app_handle().clone(),
                );
                result
            },
        );
        if let Err(error) = result {
            eprintln!("Could not refresh Pet Mode after a DPI change: {error}");
        }
    }));
}

struct PetGeometryTransition;

impl PetGeometryTransition {
    fn begin() -> Self {
        PET_MODE_GEOMETRY_APPLYING.store(true, Ordering::Release);
        Self
    }
}

impl Drop for PetGeometryTransition {
    fn drop(&mut self) {
        PET_MODE_GEOMETRY_APPLYING.store(false, Ordering::Release);
    }
}

pub(super) fn pet_native_thread_is_current(window: &WebviewWindow) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = window;
        Ok(objc2::MainThreadMarker::new().is_some())
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::Threading::GetCurrentThreadId;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
        // A window's owner thread is the only thread applying its geometry.
        Ok(unsafe { GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) == GetCurrentThreadId() })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        Ok(true)
    }
}

pub(super) fn run_pet_native_transaction<R: Send + 'static>(
    window: &WebviewWindow,
    label: &'static str,
    work: impl FnOnce(WebviewWindow) -> Result<R, String> + Send + 'static,
) -> Result<R, String> {
    let owned = window.clone();
    if pet_native_thread_is_current(window)? {
        return crate::panic_guard::contain_panic(label, || work(owned))
            .unwrap_or_else(|| Err(format!("{label} failed and was contained")));
    }
    let (send, recv) = mpsc::sync_channel(1);
    window.run_on_main_thread(crate::panic_guard::contained(label, move || {
        let _ = send.send(work(owned));
    })).map_err(|error| error.to_string())?;
    recv.recv_timeout(Duration::from_secs(2))
        .map_err(|_| format!("{label} did not finish on the native thread"))?
}

/// Secondary panels share the presentation helper but have no pet padding.
pub(super) fn pet_scene_to_window_position(
    window: &WebviewWindow,
    position: LogicalPosition<f64>,
) -> LogicalPosition<f64> {
    if window.label() == PET_MODE_WINDOW_LABEL {
        current_pet_render_geometry().scene_to_window(position)
    } else {
        position
    }
}

fn set_pet_scene_position(
    window: &WebviewWindow,
    position: LogicalPosition<f64>,
) -> Result<(), String> {
    if !pet_native_thread_is_current(window)? {
        return run_pet_native_transaction(window, "pet_mode::set_scene_position", move |window| {
            set_pet_scene_position(&window, position)
        });
    }
    #[cfg(target_os = "macos")]
    {
        // Ordinary AppKit window moves constrain the transparent surface to
        // the work area. Only the authored body governs placement; padding
        // must be allowed above the menu bar or beyond a display edge.
        set_pet_position_unconstrained(window.app_handle(), window, position)
    }
    #[cfg(not(target_os = "macos"))]
    window
        .set_position(pet_scene_to_window_position(window, position))
        .map_err(|error| error.to_string())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn current_pet_physical_position(window: &WebviewWindow) -> Result<PhysicalPosition<f64>, String> {
    if !pet_native_thread_is_current(window)? {
        return run_pet_native_transaction(window, "pet_mode::read_physical_scene_position", |window| {
            current_pet_physical_position(&window)
        });
    }
    let dpi = window.scale_factor().map_err(|error| error.to_string())?;
    let scene = current_pet_logical_position(window)?;
    Ok(PhysicalPosition::new(scene.x * dpi, scene.y * dpi))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn set_pet_scene_physical_position(
    window: &WebviewWindow,
    position: PhysicalPosition<f64>,
) -> Result<(), String> {
    if !pet_native_thread_is_current(window)? {
        return run_pet_native_transaction(window, "pet_mode::set_physical_scene_position", move |window| {
            set_pet_scene_physical_position(&window, position)
        });
    }
    let dpi = window.scale_factor().map_err(|error| error.to_string())?;
    set_pet_scene_position(window, position.to_logical(dpi))
}

/// Monitor selection uses the body center, never the enlarged transparent
/// rectangle. Its padding can overlap a neighboring monitor independently.
pub(super) fn resolve_pet_scene_monitor(window: &WebviewWindow) -> Option<Monitor> {
    let scene = current_pet_logical_scene_center(window).ok()?;
    let window_scale = window.scale_factor().ok()?;
    window.app_handle().available_monitors().ok()?.into_iter().find(|monitor| {
        pet_scene_monitor_contains(
            scene,
            window_scale,
            *monitor.position(),
            *monitor.size(),
            monitor.scale_factor(),
            cfg!(target_os = "macos"),
        )
    })
}

fn current_pet_logical_scene_center(window: &WebviewWindow) -> Result<LogicalPosition<f64>, String> {
    let scene = current_pet_logical_position(window)?;
    let (width, height) = pet_size();
    Ok(LogicalPosition::new(scene.x + width / 2.0, scene.y + height / 2.0))
}

fn pet_scene_monitor_contains(
    logical_scene_center: LogicalPosition<f64>,
    window_scale: f64,
    monitor_origin: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
    monitor_scale: f64,
    logical_coordinates: bool,
) -> bool {
    let (scene, origin, size) = if logical_coordinates {
        // Tao's macOS monitor origins have each screen's backing factor;
        // NSWindow positions have the window's. Only logical coordinates
        // form one common desktop space when those backing factors differ.
        (
            logical_scene_center,
            monitor_origin.to_logical::<f64>(monitor_scale),
            monitor_size.to_logical::<f64>(monitor_scale),
        )
    } else {
        // Windows monitor and window positions share physical desktop space.
        let scene = logical_scene_center.to_physical::<f64>(window_scale);
        (
            LogicalPosition::new(scene.x, scene.y),
            LogicalPosition::new(monitor_origin.x as f64, monitor_origin.y as f64),
            tauri::LogicalSize::new(monitor_size.width as f64, monitor_size.height as f64),
        )
    };
    scene.x >= origin.x && scene.x < origin.x + size.width
        && scene.y >= origin.y && scene.y < origin.y + size.height
}

fn pet_dance_headroom_for_width(width: f64) -> f64 {
    PET_MODE_DANCE_HEADROOM_PT * width / PET_MODE_WIDTH
}

fn current_pet_dance_headroom() -> f64 {
    PET_MODE_DANCE_ORIGIN
        .lock()
        .map(|origin| if origin.is_some() { pet_dance_headroom_for_width(pet_width()) } else { 0.0 })
        .unwrap_or(0.0)
}

fn pet_dance_visible_top(full_screen_top: f64, work_area_top: Option<f64>) -> f64 {
    work_area_top.map_or(full_screen_top, |top| full_screen_top.max(top))
}

fn pet_dance_screen_top(monitor: &Monitor) -> f64 {
    let scale = monitor.scale_factor();
    let full_screen_top = monitor.position().to_logical::<f64>(scale).y;
    // A macOS menu bar can occlude the upright head even when its pixels are
    // inside the display. Tauri converts NSScreen.visibleFrame into this same
    // top-left coordinate space, including displays with a negative origin.
    #[cfg(target_os = "macos")]
    let work_area_top = Some(monitor.work_area().position.to_logical::<f64>(scale).y);
    #[cfg(not(target_os = "macos"))]
    let work_area_top = None;
    pet_dance_visible_top(full_screen_top, work_area_top)
}

/// Only the visible upright body is kept below the display's visible top.
/// Empty surface padding is allowed off-screen and never alters ordinary placement.
fn pet_dance_scene_y(original_y: f64, visible_extent: f64, screen_top: f64) -> f64 {
    original_y.max(screen_top + visible_extent.max(0.0))
}

fn apply_pet_dance_headroom(window: &WebviewWindow, active: bool) -> Result<bool, String> {
    if !pet_native_thread_is_current(window)? {
        return run_pet_native_transaction(window, "pet_mode::apply_dance_edge_position", move |window| {
            apply_pet_dance_headroom(&window, active)
        });
    }
    let mut original = PET_MODE_DANCE_ORIGIN
        .lock()
        .map_err(|_| "Pet Mode dance position state is unavailable".to_string())?;
    if active {
        let current = current_pet_logical_position(window)?;
        let anchor = (*original).unwrap_or(current);
        let monitor = resolve_pet_scene_monitor(window)
            .ok_or_else(|| "No monitor is available for Pet Mode dance".to_string())?;
        let screen_top = pet_dance_screen_top(&monitor);
        let corrected = LogicalPosition::new(current.x, pet_dance_scene_y(anchor.y, pet_dance_headroom_for_width(pet_width()), screen_top));
        set_pet_scene_position(window, corrected)?;
        let changed = original.is_none() || !positions_match(current, corrected);
        *original = Some(anchor);
        Ok(changed)
    } else if let Some(anchor) = *original {
        set_pet_scene_position(window, anchor)?;
        *original = None;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn restore_pet_dance_headroom(window: &WebviewWindow) {
    let _ = apply_pet_dance_headroom(window, false);
}

fn rehome_pet_during_dance_resize(
    window: &WebviewWindow,
    home: LogicalPosition<f64>,
) -> Result<(), String> {
    run_pet_native_transaction(window, "pet_mode::rehome_dance_resize", move |window| {
        let mut original = PET_MODE_DANCE_ORIGIN
            .lock()
            .map_err(|_| "Pet Mode dance position state is unavailable".to_string())?;
        let target = if let Some(anchor) = original.as_mut() {
            anchor.x = home.x;
            LogicalPosition::new(home.x, current_pet_logical_position(&window)?.y)
        } else {
            // A dance may end while the worker scans the resized home. Its
            // old corrected Y must not be applied after the restoration.
            home
        };
        set_pet_scene_position(&window, target)
    })
}

/// Compatibility command: rendering headroom is permanently allocated now.
/// This command only corrects the tall dance body at the visible display top
/// and restores the exact body origin after the pose or its interruption.
#[tauri::command]
pub fn pet_mode_set_dance_headroom(app: AppHandle, active: bool) -> Result<bool, String> {
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(false);
    };
    if active && !PET_MODE_ENABLED.load(Ordering::Relaxed) {
        return Ok(false);
    }
    apply_pet_dance_headroom(&window, active)
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
            if !invalidate_pet_drag_session(window, generation)? { continue; }
            reset_pet_hit_region();
            set_pet_window_interactive(window, false)?;
            hide_windows_overlay(window)?;
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
    // Initialize the canonical body size and allocate its full rendering
    // surface. The WebView re-applies the user's scale once it mounts.
    if let Ok(mut current) = PET_MODE_SIZE.lock() {
        *current = (PET_MODE_WIDTH, PET_MODE_HEIGHT);
    }
    let render_size = current_pet_render_geometry().window_size();
    let window = WebviewWindowBuilder::new(
        app,
        PET_MODE_WINDOW_LABEL,
        WebviewUrl::App("index.html?driftySurface=pet-mode".into()),
    )
    .title("Drifty Pet Mode")
    .inner_size(render_size.width, render_size.height)
    .min_inner_size(render_size.width, render_size.height)
    .max_inner_size(render_size.width, render_size.height)
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
        crate::panic_guard::contain_panic("pet_mode::pet_window_event", || {
            #[cfg(target_os = "windows")]
            if let WindowEvent::ScaleFactorChanged { scale_factor, .. } = event {
                record_windows_pet_tauri_scale_change(*scale_factor);
                schedule_windows_pet_dpi_refresh(hit_region_window.clone());
            }
            if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_))
                && pet_hit_region_geometry_refresh_needed()
            {
                // The panel can walk underneath a stationary pointer, so mouse
                // monitors alone are insufficient. Refresh at every native frame
                // movement and size transition as well.
                let _ = refresh_pet_hit_region_for_window(&hit_region_window);
            }
        });
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
    let size_request = enabled
        .then(|| prepare_pet_geometry_request(width, height))
        .transpose()?;
    // AX can synchronously message Drifty's own window. Keep both the scan
    // and the visibility-lock wait off AppKit so it can answer those messages
    // and service this worker's window mutations.
    async_runtime::spawn_blocking(move || {
        set_pet_mode_enabled(
            app,
            enabled,
            snapshot,
            reduced_motion,
            size_request,
            force_reveal,
        )
    })
    .await
    .map_err(|error| format!("Pet Mode visibility task failed: {error}"))?
}

fn set_pet_mode_enabled(
    app: AppHandle,
    enabled: bool,
    snapshot: Option<Value>,
    reduced_motion: bool,
    size_request: Option<PetModeGeometryRequest>,
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
        PET_MODE_ENABLED.store(false, Ordering::Relaxed);
        if !invalidate_pet_drag_session(&window, _visibility_transition.generation)? {
            schedule_pet_visibility_reconciliation(app, window);
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        pet_fullscreen::clear(&app);
        PET_MODE_ENTRY_ACTIVE.store(false, Ordering::Relaxed);
        cancel_pet_motion();
        restore_pet_dance_headroom(&window);
        let _ = window.set_min_size(Some(current_pet_render_geometry().window_size()));
        reset_pet_hit_region();
        let _ = set_pet_window_interactive(&window, false);
        let _ = super::pet_quick_controls::hide_pet_quick_controls(&app);
        return hide_windows_overlay(&window);
    }

    // Size and placement form one presentation transaction. Applying the
    // persisted size here prevents a cold launch from calculating the entry
    // offset at the default panel size and resizing halfway through the step.
    let size_request = size_request.ok_or_else(|| "Pet Mode enable size is missing".to_string())?;
    let size_changed = apply_pet_mode_size_for_revision(&window, size_request.width, size_request.revision)?;
    #[cfg(target_os = "windows")]
    if !pet_geometry_request_is_current(size_request.revision, PET_MODE_GEOMETRY_REVISION.load(Ordering::SeqCst)) {
        // A superseded geometry no-op is not permission to reveal the old
        // body size. Its replacement request owns presentation instead.
        return Ok(());
    }
    let was_enabled = PET_MODE_ENABLED.load(Ordering::Relaxed);

    // Both change the panel's level and collection behavior. From this worker
    // they would run in tao's event loop, where an AppKit exception aborts the
    // app; on the main thread inside the guard it fails only this enable.
    let presentation_window = window.clone();
    crate::panic_guard::run_on_main_contained(
        &app,
        "pet_mode::assert_pet_panel_presentation",
        move || {
            presentation_window
                .set_always_on_top(true)
                .map_err(|error| error.to_string())?;
            presentation_window
                .set_visible_on_all_workspaces(true)
                .map_err(|error| error.to_string())
        },
    )?;
    refresh_pet_hit_region_for_window(&window)?;

    // React can legitimately re-send the enabled state while the panel is
    // already active (notably under Strict Mode). Reassert presentation without
    // snapping an in-flight entrance back home or replaying the choreography.
    if !should_replay_pet_entry(was_enabled, force_reveal) {
        let entry_active = PET_MODE_ENTRY_ACTIVE.load(Ordering::Relaxed);
        // The size transaction has already kept the held artwork point under
        // the pointer. Settings also re-send enabled: do not overwrite that
        // drag position with the ordinary resized-home policy here.
        let drag_active = pet_drag_is_active();
        if should_settle_pet_enable_change(entry_active, reduced_motion, size_changed, drag_active) {
            PET_MODE_ENTRY_ACTIVE.store(false, Ordering::Relaxed);
            cancel_pet_motion();
            if current_pet_dance_headroom() > 0.0 {
                // Rehome horizontally while retaining the dance's temporary
                // top-edge correction and its original resting scene Y.
                let monitor = resolve_pet_home_monitor(&app)
                    .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
                let home = calculate_pet_home_position_with_nudge(Some(&app), &monitor);
                rehome_pet_during_dance_resize(&window, home)?;
            } else {
                position_pet_home(&app, &window, false)?;
            }
        }
        #[cfg(not(target_os = "windows"))]
        show_pet_panel(&app, &window)?;
        #[cfg(target_os = "windows")]
        if !complete_windows_pet_enable(&window, size_request, _visibility_transition.generation, None, None)? {
            return Ok(());
        }
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

    restore_pet_dance_headroom(&window);
    cancel_pet_motion();
    let monitor = resolve_pet_home_monitor(&app)
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    let home = calculate_pet_home_position_with_nudge(Some(&app), &monitor);
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(scale_factor);
    let work_size = work_area.size.to_logical::<f64>(scale_factor);
    let entry = pet_entry_geometry(work_position.x, work_size.width, home.x, pet_width());
    let side = if entry.facing == "right" {
        "left"
    } else {
        "right"
    };
    let start = LogicalPosition::new(
        entry.start_x,
        calculate_pet_outing_return_start(&monitor, side).y,
    );
    let entry_travel = ((home.x - start.x).powi(2) + (home.y - start.y).powi(2)).sqrt();
    let entry_duration_ms = pet_entry_duration_ms(entry_travel);
    emit_pet_event(&window, json!({ "kind": "facing", "facing": entry.facing }))?;

    #[cfg(target_os = "windows")]
    if !complete_windows_pet_enable(
        &window,
        size_request,
        _visibility_transition.generation,
        Some(if reduced_motion { home } else { start }),
        Some(!reduced_motion),
    )? {
        return Ok(());
    }

    if reduced_motion {
        #[cfg(not(target_os = "windows"))]
        {
            show_pet_panel_at_position(&app, &window, home)?;
            PET_MODE_ENABLED.store(true, Ordering::Relaxed);
            PET_MODE_ENTRY_ACTIVE.store(false, Ordering::Relaxed);
        }
        if force_reveal {
            emit_pet_event(&window, json!({ "kind": "reveal" }))?;
        }
        emit_pet_event(&window, json!({ "kind": "entry_complete" }))?;
    } else {
        #[cfg(not(target_os = "windows"))]
        {
            show_pet_panel_at_position(&app, &window, start)?;
            PET_MODE_ENABLED.store(true, Ordering::Relaxed);
            PET_MODE_ENTRY_ACTIVE.store(true, Ordering::Relaxed);
        }
        if force_reveal {
            emit_pet_event(&window, json!({ "kind": "reveal" }))?;
        }
    }

    if !reduced_motion {
        let entry_window = window.clone();
        let motion_revision = PET_MODE_MOTION_REVISION.fetch_add(1, Ordering::Relaxed) + 1;
        drop(async_runtime::spawn_blocking(move || {
            // Keep the panel fully outside the work area until its first paint,
            // then walk in from the same origin as a natural outing return.
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
            // Match the outing walk's renderer handoff before native movement.
            thread::sleep(Duration::from_millis(PET_MODE_INTERVENTION_RUN_START_DELAY_MS));
            if !pet_entry_motion_is_current(motion_revision) {
                return;
            }
            let _ = animate_pet_entry_window(
                &entry_window,
                start,
                home,
                entry_travel,
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
    start: LogicalPosition<f64>,
    home: LogicalPosition<f64>,
    distance: f64,
    motion_revision: u64,
) -> Result<bool, String> {
    // Use the outing return's native walker, including its linear travel and
    // cancellation checks. `entry` remains only a visibility lifecycle marker.
    animate_pet_window(
        window,
        start,
        home,
        distance,
        movement_duration_seconds(distance, PET_MODE_WALK_SPEED, PET_MODE_WALK_MAX_SECONDS),
        false,
        motion_revision,
        None,
    )
}

fn pet_intervention_run_travel_progress(progress: f64, duration_seconds: f64) -> f64 {
    let acceleration_duration = (PET_MODE_INTERVENTION_RUN_ACCELERATION_MAX_SECONDS
        / duration_seconds)
        .min(PET_MODE_INTERVENTION_RUN_ACCELERATION_MAX_RATIO);
    let deceleration_duration = (PET_MODE_INTERVENTION_RUN_DECELERATION_MAX_SECONDS
        / duration_seconds)
        .min(PET_MODE_INTERVENTION_RUN_DECELERATION_MAX_RATIO);
    pet_travel_progress(progress, acceleration_duration, deceleration_duration)
}

fn pet_travel_progress(
    progress: f64,
    acceleration_duration: f64,
    deceleration_duration: f64,
) -> f64 {
    let progress = progress.clamp(0.0, 1.0);
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

fn should_settle_pet_enable_change(
    entry_active: bool,
    reduced_motion: bool,
    size_changed: bool,
    drag_active: bool,
) -> bool {
    !drag_active && ((reduced_motion && entry_active) || size_changed)
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
    let screen_center = screen_x + screen_width / 2.0;
    let pet_center = home_x + pet_width / 2.0;
    if pet_center < screen_center {
        PetEntryGeometry {
            facing: "right",
            start_x: pet_outing_return_start_x(screen_x, screen_width, pet_width, "left"),
        }
    } else {
        PetEntryGeometry {
            facing: "left",
            start_x: pet_outing_return_start_x(screen_x, screen_width, pet_width, "right"),
        }
    }
}

fn pet_outing_return_start_x(work_x: f64, work_width: f64, pet_width: f64, side: &str) -> f64 {
    if side == "left" {
        work_x - pet_width - PET_MODE_OUTING_EDGE_GAP
    } else {
        work_x + work_width + PET_MODE_OUTING_EDGE_GAP
    }
}

fn pet_entry_duration_ms(travel_distance: f64) -> u64 {
    (movement_duration_seconds(travel_distance, PET_MODE_WALK_SPEED, PET_MODE_WALK_MAX_SECONDS)
        * 1000.0)
        .round() as u64
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
        if !invalidate_pet_drag_session(&window, _visibility_transition.generation)? {
            schedule_pet_visibility_reconciliation(app, window);
            return Ok(());
        }
        PET_MODE_ENTRY_ACTIVE.store(false, Ordering::Relaxed);
        cancel_pet_motion();
        restore_pet_dance_headroom(&window);
        reset_pet_hit_region();
        let _ = set_pet_window_interactive(&window, false);
        hide_windows_overlay(&window)?;
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
    // The pet must not act out pressing a tab X that the Windows close adapter
    // cannot resolve. The ordinary automatic-close path will fail closed and
    // present the drift alert instead (for example, Opera on Windows).
    #[cfg(target_os = "windows")]
    if !target.preview
        && super::extreme_nudge::should_skip_windows_pet_approach(
            target.browser_name.as_deref(),
            target.browser_identity.as_deref(),
        )
    {
        return Err("unsupported_browser".to_string());
    }
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    show_pet_panel(&app, &window)?;
    remember_pet_mode_intervention(&target)?;
    let id = target.id.clone();
    let result = emit_pet_event(&window, json!({ "kind": "intervention", "target": target }));
    if result.is_err() {
        clear_pet_mode_intervention(&id);
    }
    result
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
            browser_identity: None,
            site_domain: None,
            site_url: None,
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
            async_runtime::spawn_blocking(move || close_lab_browser_active_tab(&target))
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
    if action.preempts_native_motion() {
        let entry_was_active = cancel_pet_motion();
        recover_cancelled_pet_entry(&app, &window, entry_was_active)?;
        if !matches!(action, PetModePreviewAction::Dance) {
            restore_pet_dance_headroom(&window);
        }
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
    recover_cancelled_pet_entry(&app, &window, entry_was_active)?;
    restore_pet_dance_headroom(&window);
    Ok(())
}

#[tauri::command]
pub async fn pet_mode_move_to_target(
    app: AppHandle,
    target: PetModeInterventionTarget,
) -> Result<PetModeResolvedTarget, String> {
    let target = take_pet_mode_intervention(target);
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
        set_pet_scene_position(&window, LogicalPosition::new(
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
    fn apply(window: &WebviewWindow, desired: LogicalPosition<f64>) -> Result<(), String> {
        let current = current_pet_logical_position(window)?;
        let ptr = window.ns_window().map_err(|error| error.to_string())?;
        // Safe: both callers reach this only on AppKit's main thread.
        let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
        let frame = ns_window.frame();
        ns_window.setFrameOrigin(NSPoint::new(
            frame.origin.x + desired.x - current.x,
            frame.origin.y - (desired.y - current.y),
        ));
        Ok(())
    }
    if objc2::MainThreadMarker::new().is_some() {
        return apply(window, desired);
    }
    let window_for_main = window.clone();
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(crate::panic_guard::contained("pet_mode::set_pet_position_unconstrained", move || {
        let _ = sender.send(apply(&window_for_main, desired));
    }))
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(Duration::from_millis(250))
        .map_err(|_| "Pet Mode native body move timed out".to_string())?
}

#[tauri::command]
pub fn pet_mode_report_contact(
    app: AppHandle,
    id: String,
    contacted: Option<bool>,
    reason: Option<String>,
) -> Result<(), String> {
    clear_pet_mode_intervention(&id);
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
    #[cfg(target_os = "windows")]
    super::pet_hit_region::record_windows_renderer_pointer_down();
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
        if !invalidate_pet_drag_session(&window, command_generation)? {
            schedule_pet_visibility_reconciliation(app, window);
            return Ok(());
        }
        restore_pet_dance_headroom(&window);
        // Presence changes are a native lifecycle boundary. Clear the region
        // as well as the current AppKit flag so a missed renderer update cannot
        // resurrect a stale pose when the panel is shown again.
        reset_pet_hit_region();
        set_pet_window_interactive(&window, false)?;
        hide_windows_overlay(&window)?;
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
pub async fn pet_mode_set_size(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PET_MODE_WINDOW_LABEL) else {
        return Ok(());
    };
    let request = prepare_pet_geometry_request(width, height)?;
    // A Windows geometry transaction can wait while Tauri applies its native
    // mutations. Keep every lock-taking size caller off the UI thread.
    async_runtime::spawn_blocking(move || apply_pet_mode_size_for_revision(&window, request.width, request.revision).map(|_| ()))
        .await
        .map_err(|error| format!("Pet Mode size task failed: {error}"))?
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

#[derive(Clone, Copy)]
struct PetModeGeometryRequest {
    width: f64,
    revision: u64,
}

fn prepare_pet_geometry_request(width: f64, height: f64) -> Result<PetModeGeometryRequest, String> {
    if !(width.is_finite() && height.is_finite()) || width <= 0.0 || height <= 0.0 {
        return Err("Pet Mode size must be a positive, finite size".to_string());
    }
    let revision = PET_MODE_GEOMETRY_REVISION.fetch_add(1, Ordering::SeqCst) + 1;
    Ok(PetModeGeometryRequest { width, revision })
}

fn pet_geometry_request_is_current(revision: u64, current: u64) -> bool {
    revision == current
}

#[cfg(any(target_os = "windows", test))]
fn pet_enable_presentation_is_current(
    request_revision: u64,
    current_revision: u64,
    request_generation: u64,
    current_generation: u64,
) -> bool {
    pet_geometry_request_is_current(request_revision, current_revision)
        && request_generation == current_generation
}

#[cfg(any(target_os = "windows", test))]
struct PetEnableCompletionObservation {
    geometry_revision: u64,
    visibility_generation: u64,
    enabled: bool,
    scene_size: (f64, f64),
    frame_size: (u32, u32),
    scale_factor: f64,
    visible: bool,
}

/// False retires stale work without turning it into a new reveal/retry. An
/// accepted Win32 API call alone is not an applied presentation acknowledgment.
#[cfg(any(target_os = "windows", test))]
fn pet_enable_completion_applied(
    request: PetModeGeometryRequest,
    visibility_generation: u64,
    observed: PetEnableCompletionObservation,
) -> Result<bool, String> {
    if !pet_enable_presentation_is_current(request.revision, observed.geometry_revision, visibility_generation, observed.visibility_generation)
        || !observed.enabled
    {
        return Ok(false);
    }
    let geometry = pet_render_layout().geometry(request.width);
    let expected = geometry.window_size().to_physical::<u32>(observed.scale_factor);
    let scene_matches = (observed.scene_size.0 - geometry.scene_width).abs() < f64::EPSILON
        && (observed.scene_size.1 - geometry.scene_height).abs() < f64::EPSILON;
    if !scene_matches
        || observed.frame_size != (expected.width, expected.height)
        || !observed.visible
    {
        return Err(format!(
            "Pet Mode enable presentation did not complete: body={:?}, frame={:?}, expected_frame=({}, {}), visible={}",
            observed.scene_size, observed.frame_size, expected.width, expected.height, observed.visible,
        ));
    }
    Ok(true)
}

#[cfg(target_os = "windows")]
fn complete_windows_pet_enable(
    window: &WebviewWindow,
    request: PetModeGeometryRequest,
    visibility_generation: u64,
    position: Option<LogicalPosition<f64>>,
    entry_active: Option<bool>,
) -> Result<bool, String> {
    // A timed-out queued completion cannot show an old pet after a newer Off
    // or size request. Show, enabled state and its readback share this guard.
    run_pet_native_transaction(window, "pet_mode::complete_enable_presentation", move |window| {
        use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
        let revision = PET_MODE_GEOMETRY_REVISION.load(Ordering::SeqCst);
        let generation = PET_MODE_VISIBILITY_GENERATION.load(Ordering::SeqCst);
        if !pet_enable_presentation_is_current(request.revision, revision, visibility_generation, generation) {
            return Ok(false);
        }
        if let Some(position) = position {
            show_pet_panel_at_position(window.app_handle(), &window, position)?;
        } else {
            show_pet_panel(window.app_handle(), &window)?;
        }
        if let Some(entry_active) = entry_active {
            PET_MODE_ENABLED.store(true, Ordering::Relaxed);
            PET_MODE_ENTRY_ACTIVE.store(entry_active, Ordering::Relaxed);
        }
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        if dpi == 0 {
            return Err("Could not read the Pet Mode native DPI at enable completion".to_string());
        }
        // outer_size is a fresh GetWindowRect read in Tao, unlike its cached
        // scale factor/visibility flags. The HWND is borderless and shadowless.
        let frame = window.outer_size().map_err(|error| error.to_string())?;
        let visible = is_windows_overlay_visible(&window);
        let result = pet_enable_completion_applied(request, visibility_generation, PetEnableCompletionObservation {
            geometry_revision: PET_MODE_GEOMETRY_REVISION.load(Ordering::SeqCst),
            visibility_generation: PET_MODE_VISIBILITY_GENERATION.load(Ordering::SeqCst),
            enabled: PET_MODE_ENABLED.load(Ordering::Relaxed),
            scene_size: pet_size(),
            frame_size: (frame.width, frame.height),
            scale_factor: dpi as f64 / 96.0,
            visible,
        });
        #[cfg(debug_assertions)]
        eprintln!(
            "[pet-mode-enable] width={} revision={} generation={} native_dpi={} cached_scale={:?} frame={}x{} visible={} completion={result:?}",
            request.width, request.revision, visibility_generation, dpi, window.scale_factor(), frame.width, frame.height, visible,
        );
        result
    })
}

fn pet_scene_origin_after_resize(
    origin: LogicalPosition<f64>,
    old: PetRenderGeometry,
    next: PetRenderGeometry,
    grabbed_pointer: Option<LogicalPosition<f64>>,
    canonical_grab: Option<(f64, f64)>,
) -> LogicalPosition<f64> {
    if let Some(pointer) = grabbed_pointer {
        // A moving pointer can be ahead of the last coalesced native apply.
        // The drag worker's captured point remains authoritative at a resize.
        let point = canonical_grab.unwrap_or_else(|| (
            (pointer.x - origin.x) / old.scale(),
            (pointer.y - origin.y) / old.scale(),
        ));
        pet_scene_origin_at_grab(pointer, next, point)
    } else {
        origin
    }
}

fn pet_scene_origin_at_grab(
    pointer: LogicalPosition<f64>,
    geometry: PetRenderGeometry,
    point: (f64, f64),
) -> LogicalPosition<f64> {
    LogicalPosition::new(
        pointer.x - point.0 * geometry.scale(),
        pointer.y - point.1 * geometry.scale(),
    )
}

#[cfg(target_os = "windows")]
fn apply_windows_pet_render_frame(
    window: &WebviewWindow,
    next: PetRenderGeometry,
    origin: LogicalPosition<f64>,
) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    let dpi = window.scale_factor().map_err(|error| error.to_string())?;
    let position = next.scene_to_window(origin).to_physical::<i32>(dpi);
    let size = next.window_size().to_physical::<u32>(dpi);
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    // The pet HWND is borderless and shadowless, so its frame is its content
    // surface. One native call changes position and size on the owning thread;
    // worker-side Tauri set_size/set_position would enqueue separate messages.
    if unsafe {
        SetWindowPos(hwnd, std::ptr::null_mut(), position.x, position.y, size.width as i32, size.height as i32, SWP_NOACTIVATE | SWP_NOZORDER)
    } == 0 {
        return Err(format!("Could not apply the Pet Mode render frame: {}", std::io::Error::last_os_error()));
    }
    Ok(())
}

fn apply_pet_mode_size_for_revision(
    window: &WebviewWindow,
    width: f64,
    revision: u64,
) -> Result<bool, String> {
    apply_pet_mode_geometry_for_revision(window, width, revision, false)
}

/// None is a no-op; Some(false) repairs the native surface without changing
/// body size or the caller's resized-home policy.
fn pet_geometry_update_kind(
    previous_scene: (f64, f64),
    next: PetRenderGeometry,
    refresh_native_frame: bool,
) -> Option<bool> {
    let body_changed = (previous_scene.0 - next.scene_width).abs() >= f64::EPSILON
        || (previous_scene.1 - next.scene_height).abs() >= f64::EPSILON;
    (body_changed || refresh_native_frame).then_some(body_changed)
}

fn apply_pet_mode_geometry_for_revision(
    window: &WebviewWindow,
    width: f64,
    revision: u64,
    refresh_native_frame: bool,
) -> Result<bool, String> {
    if !pet_native_thread_is_current(window)? {
        return run_pet_native_transaction(window, "pet_mode::apply_render_geometry", move |window| {
            apply_pet_mode_geometry_for_revision(&window, width, revision, refresh_native_frame)
        });
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _geometry_transaction = PET_MODE_GEOMETRY_TRANSACTION
        .lock()
        .map_err(|_| "Pet Mode geometry transaction is unavailable".to_string())?;
    if !pet_geometry_request_is_current(revision, PET_MODE_GEOMETRY_REVISION.load(Ordering::SeqCst)) {
        return Ok(false);
    }
    // Legacy callers send a rounded body height. Art is uniformly scaled by
    // width, so native anchors and hit tests use the same exact scene height.
    let next = pet_render_layout().geometry(width);
    let (old_width, old_height) = pet_size();
    #[cfg(target_os = "windows")]
    let refresh_native_frame = refresh_native_frame || {
        let dpi = window.scale_factor().map_err(|error| error.to_string())?;
        let actual = window.outer_size().map_err(|error| error.to_string())?;
        actual != next.window_size().to_physical::<u32>(dpi)
    };
    let Some(body_changed) =
        pet_geometry_update_kind((old_width, old_height), next, refresh_native_frame)
    else {
        return Ok(false);
    };
    let old = current_pet_render_geometry();
    let scene_origin = current_pet_logical_position(window)?;
    let pointer = if pet_drag_is_active() {
        let dpi = window.scale_factor().map_err(|error| error.to_string())?;
        Some(pet_cursor_in_scene_space(window.app_handle(), dpi)?)
    } else {
        None
    };
    let canonical_grab = PET_MODE_DRAG_SESSION.lock().ok().and_then(|value| value.canonical_grab);
    let mut scene_origin = pet_scene_origin_after_resize(scene_origin, old, next, pointer, canonical_grab);
    let dance_anchor = PET_MODE_DANCE_ORIGIN.lock().ok().and_then(|value| *value);
    if let Some(anchor) = dance_anchor {
        if let Some(monitor) = resolve_pet_scene_monitor(window) {
            let screen_top = pet_dance_screen_top(&monitor);
            scene_origin.y = pet_dance_scene_y(anchor.y, pet_dance_headroom_for_width(next.scene_width), screen_top);
        }
    }
    let recover_entry = PET_MODE_ENTRY_ACTIVE.load(Ordering::Relaxed)
        && PET_MODE_ENABLED.load(Ordering::Relaxed);
    let entry_monitor = recover_entry.then(|| resolve_pet_home_monitor(window.app_handle())).flatten();
    let size = next.window_size();
    if !pet_geometry_request_is_current(revision, PET_MODE_GEOMETRY_REVISION.load(Ordering::SeqCst)) {
        return Ok(false);
    }
    let transition = PetGeometryTransition::begin();
    #[cfg(target_os = "windows")]
    {
        // Tao revalidates the current frame when each bound changes. Relax
        // bounds while the old scene is still published; defer those callbacks.
        window.set_min_size(None::<LogicalSize<f64>>).map_err(|error| error.to_string())?;
        window.set_max_size(None::<LogicalSize<f64>>).map_err(|error| error.to_string())?;
    }
    // Re-entrant moved/resized input callbacks see the same scene geometry as
    // the frame being applied. External position readers use this native
    // thread too, so they cannot combine an old frame with a new scene inset.
    if let Ok(mut current) = PET_MODE_SIZE.lock() {
        *current = (next.scene_width, next.scene_height);
    }
    if recover_entry {
        // The entry's target was authored at its opening body/display size.
        // Retire only this entry and settle at the current home; other run/drop
        // continuations retain their existing command outcomes and tokens.
        cancel_pet_motion();
        if let Some(monitor) = &entry_monitor {
            scene_origin = calculate_pet_home_position(monitor);
        }
    }
    let result = (|| {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSRect, NSSize};
        let ptr = window.ns_window().map_err(|error| error.to_string())?;
        // Safe: the transaction is serialized on AppKit's main thread above.
        let ns = unsafe { &*ptr.cast::<NSWindow>() };
        let content = ns.contentRectForFrameRect(ns.frame());
        let content_size = NSSize::new(size.width, size.height);
        let delta = LogicalPosition::new(scene_origin.x - current_pet_logical_position(window)?.x, scene_origin.y - current_pet_logical_position(window)?.y);
        let origin = NSPoint::new(
            content.origin.x + delta.x,
            content.origin.y + content.size.height - size.height - delta.y,
        );
        let frame = ns.frameRectForContentRect(NSRect::new(origin, content_size));
        ns.setContentMinSize(content_size);
        ns.setContentMaxSize(content_size);
        ns.setFrame_display(frame, true);
    }
    #[cfg(target_os = "windows")]
    {
        apply_windows_pet_render_frame(window, next, scene_origin)?;
        // The HWND remains unresizable; failure to repin bounds after its
        // frame applied must not roll the published scene back to the old size.
        let _ = window.set_min_size(Some(size));
        let _ = window.set_max_size(Some(size));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        window.set_min_size(None::<LogicalSize<f64>>).map_err(|error| error.to_string())?;
        window.set_max_size(None::<LogicalSize<f64>>).map_err(|error| error.to_string())?;
        window.set_size(size).map_err(|error| error.to_string())?;
        window.set_min_size(Some(size)).map_err(|error| error.to_string())?;
        window.set_max_size(Some(size)).map_err(|error| error.to_string())?;
    }
    Ok::<(), String>(())
    })();
    if let Err(error) = result {
        if let Ok(mut current) = PET_MODE_SIZE.lock() {
            *current = (old_width, old_height);
        }
        #[cfg(target_os = "windows")]
        {
            let _ = window.set_min_size(Some(old.window_size()));
            let _ = window.set_max_size(Some(old.window_size()));
        }
        if recover_entry {
            if let Some(monitor) = &entry_monitor {
                let _ = set_pet_scene_position(window, calculate_pet_home_position(monitor));
            }
            let _ = emit_pet_event(window, json!({ "kind": "entry_complete" }));
        }
        return Err(error);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    set_pet_scene_position(window, scene_origin)?;
    drop(transition);
    refresh_pet_hit_region_for_window(window)?;
    if recover_entry {
        emit_pet_event(window, json!({ "kind": "entry_complete" }))?;
    }
    Ok(body_changed)
}

#[tauri::command]
pub async fn pet_mode_begin_drag(
    app: AppHandle,
    start_client_x: f64,
    start_client_y: f64,
    pickup_delay_ms: u64,
    pointer_type: Option<String>,
    manual_request_id: Option<String>,
) -> Result<PetModeNativeDragResult, String> {
    #[cfg(target_os = "windows")]
    super::pet_hit_region::record_windows_drag_request();
    let visibility_generation = PET_MODE_VISIBILITY_GENERATION.load(Ordering::SeqCst);
    let claim_epoch = PET_MODE_DRAG_SESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .epoch;
    let lease = PetDragLease::new(manual_request_id)?;
    let _lease_guard = PetDragLeaseGuard(lease.clone());
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let prepare_lease = lease.clone();
    let (mouse_down, before) =
        run_pet_native_transaction(&window, "pet_mode::claim_drag", move |window| {
            let eligible = visibility_generation
                == PET_MODE_VISIBILITY_GENERATION.load(Ordering::SeqCst)
                && PET_MODE_ENABLED.load(Ordering::Relaxed)
                && is_windows_overlay_visible(&window);
            if !PET_MODE_DRAG_SESSION
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .claim(&prepare_lease, eligible, claim_epoch)
            {
                return Err("Pet Mode drag was cancelled".to_string());
            }
            // Claim before capture so an older queued drag can no longer move this
            // frame. Rejected hidden/stale requests do not cancel a newer motion.
            super::pet_quick_controls::revoke_pet_quick_controls_interaction(window.app_handle());
            cancel_pet_motion();
            let mouse_down = super::pet_panel::capture_pet_panel_mouse_down(
                &window,
                (start_client_x, start_client_y),
                pointer_type.as_deref(),
            )?;
            restore_pet_dance_headroom(&window);
            Ok((mouse_down, current_pet_logical_position(&window)?))
        })?;
    #[cfg(debug_assertions)]
    eprintln!(
        "[pet-mode-drag] begin client=({start_client_x:.1},{start_client_y:.1}) window={before:?}"
    );
    // Pointer tracking lasts for the full mouse gesture. Keep it off Tauri's
    // command/main execution path so WebKit can composite the reviewed pickup
    // frames while the native panel follows the cursor.
    let drag_app = app.clone();
    let drag_window = window.clone();
    let worker_lease = lease.clone();
    let drag = tauri::async_runtime::spawn_blocking(move || {
        perform_pet_panel_drag(
            &drag_app,
            &drag_window,
            start_client_x,
            start_client_y,
            pickup_delay_ms,
            mouse_down,
            &worker_lease,
        )
    })
    .await
    .map_err(|error| format!("Pet Mode drag task failed: {error}"));
    let drag = drag??;
    lease.ensure_current()?;
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
        manual_request_id: lease.manual_request_id.clone(),
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
    emit_pet_drag_event(&window, &lease, "pet-mode-drag-end", &result)?;
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
    if !is_windows_overlay_visible(&window) {
        return false;
    }
    refresh_pet_hit_region_for_window(&window).is_ok() && pet_hit_region_pointer_inside()
}

#[tauri::command]
pub fn pet_mode_input_bounds(app: AppHandle) -> Result<PetModeInputBounds, String> {
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    #[cfg(target_os = "windows")]
    return run_pet_native_transaction(&window, "pet_mode::read_input_bounds", |window| {
        read_pet_mode_input_bounds(&window)
    });
    #[cfg(not(target_os = "windows"))]
    read_pet_mode_input_bounds(&window)
}

#[cfg(target_os = "windows")]
fn windows_dpi_awareness_label(
    context: windows_sys::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT,
) -> String {
    use windows_sys::Win32::UI::HiDpi::{
        AreDpiAwarenessContextsEqual, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE,
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, DPI_AWARENESS_CONTEXT_SYSTEM_AWARE,
        DPI_AWARENESS_CONTEXT_UNAWARE, DPI_AWARENESS_CONTEXT_UNAWARE_GDISCALED,
    };
    if context.is_null() {
        return "unavailable".to_string();
    }
    // Context handles are opaque: compare with Win32 instead of exporting or
    // interpreting their numeric representation. Keep PMv1 and PMv2 distinct.
    for (known_context, label) in [
        (DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, "per_monitor_v2"),
        (DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE, "per_monitor"),
        (DPI_AWARENESS_CONTEXT_SYSTEM_AWARE, "system"),
        (DPI_AWARENESS_CONTEXT_UNAWARE_GDISCALED, "unaware_gdi_scaled"),
        (DPI_AWARENESS_CONTEXT_UNAWARE, "unaware"),
    ] {
        if unsafe { AreDpiAwarenessContextsEqual(context, known_context) } != 0 {
            return label.to_string();
        }
    }
    "unknown".to_string()
}


fn read_pet_mode_input_bounds(window: &WebviewWindow) -> Result<PetModeInputBounds, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    let (window_scale_factor, native_scale_factor, expected_render_width, expected_render_height, sampled_at_ms) = {
        use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        if dpi == 0 {
            return Err("Could not read the Pet Mode native DPI for Lab bounds".to_string());
        }
        let native_scale = dpi as f64 / 96.0;
        let expected = current_pet_render_geometry().window_size().to_physical::<u32>(native_scale);
        (
            Some(window.scale_factor().map_err(|error| error.to_string())?),
            Some(native_scale),
            Some(expected.width),
            Some(expected.height),
            Some(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64),
        )
    };
    #[cfg(not(target_os = "windows"))]
    let (window_scale_factor, native_scale_factor, expected_render_width, expected_render_height, sampled_at_ms) = (None, None, None, None, None);
    #[cfg(target_os = "windows")]
    let (window_dpi_awareness, thread_dpi_awareness, current_monitor_scale_factor) = {
        use windows_sys::Win32::UI::HiDpi::{
            GetThreadDpiAwarenessContext, GetWindowDpiAwarenessContext,
        };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
        // This getter already runs on the owning window thread. Tao's monitor
        // scale uses the context-sensitive GetDpiForMonitor path; it is a Lab
        // diagnostic only, never the authority for expected frames or resize.
        let monitor_scale = window.current_monitor().ok().flatten()
            .map(|monitor| monitor.scale_factor())
            .filter(|scale| scale.is_finite() && *scale > 0.0);
        (
            Some(windows_dpi_awareness_label(unsafe { GetWindowDpiAwarenessContext(hwnd) })),
            Some(windows_dpi_awareness_label(unsafe { GetThreadDpiAwarenessContext() })),
            monitor_scale,
        )
    };
    #[cfg(not(target_os = "windows"))]
    let (window_dpi_awareness, thread_dpi_awareness, current_monitor_scale_factor) = (None, None, None);
    // Copy the bounded receipts only. Reading Lab bounds must not heal the
    // window, resample DPI, clear counters, or dispatch another event.
    #[cfg(target_os = "windows")]
    let windows_dpi_events = Some(
        PET_WINDOWS_DPI_EVENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone(),
    );
    #[cfg(not(target_os = "windows"))]
    let windows_dpi_events = None;
    #[cfg(target_os = "windows")]
    let windows_input = Some(super::pet_hit_region::windows_pet_input_diagnostics());
    #[cfg(not(target_os = "windows"))]
    let windows_input = None;
    #[cfg(target_os = "windows")]
    let windows_surface = Some(super::pet_surface::read_windows_pet_surface_bounds(window)?);
    #[cfg(not(target_os = "windows"))]
    let windows_surface = None;
    Ok(PetModeInputBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        visible: is_windows_overlay_visible(window),
        window_scale_factor,
        native_scale_factor,
        window_dpi_awareness,
        thread_dpi_awareness,
        current_monitor_scale_factor,
        windows_dpi_events,
        windows_input,
        windows_surface,
        expected_render_width,
        expected_render_height,
        sampled_at_ms,
    })
}

#[tauri::command]
pub fn pet_mode_cursor_sample(app: AppHandle) -> Result<PetModeCursorSample, String> {
    let window = app
        .get_webview_window(PET_MODE_WINDOW_LABEL)
        .ok_or_else(|| "Pet Mode window is not available".to_string())?;
    let visible = is_windows_overlay_visible(&window);
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let position = current_pet_logical_position(&window)?;
    let (width, height) = pet_size();
    let cursor = pet_cursor_in_scene_space(&app, scale_factor)?;
    Ok(PetModeCursorSample {
        cursor_x: cursor.x,
        cursor_y: cursor.y,
        window_x: position.x,
        window_y: position.y,
        window_width: width,
        window_height: height,
        visible,
    })
}

#[tauri::command]
pub async fn pet_mode_stalk_cursor(
    app: AppHandle,
    request: PetModeStalkRequest,
) -> Result<PetModeStalkResult, String> {
    validate_pet_mode_stalk_request(request)?;

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
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

    #[cfg(any(target_os = "macos", target_os = "windows"))]
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

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, request);
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::UnsupportedPlatform,
            moved_distance: 0.0,
        });
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
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
    let monitor = resolve_pet_scene_monitor(&window)
        .or_else(|| resolve_pet_home_monitor(&app))
        .ok_or_else(|| "No monitor is available for Pet Mode".to_string())?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(scale_factor);
    let work_size = work_area.size.to_logical::<f64>(scale_factor);
    let target = calculate_pet_center_position(work_position, work_size.width, work_size.height);
    cancel_pet_motion();
    set_pet_scene_position(&window, target)
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
            let monitor = resolve_pet_scene_monitor(&window)
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
            animate_pet_window_toward_with_purpose(
                &window,
                target,
                PET_MODE_WALK_SPEED,
                PET_MODE_WALK_MAX_SECONDS,
                "walk",
                PET_MODE_AUTONOMOUS_ROAM_PURPOSE,
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
        set_pet_scene_position(&window, start)
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
        set_pet_scene_position(&window, start)
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
    if !pet_native_thread_is_current(window)? {
        return run_pet_native_transaction(window, "pet_mode::read_scene_position", |window| {
            current_pet_logical_position(&window)
        });
    }
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let native = position.to_logical(scale_factor);
    Ok(if window.label() == PET_MODE_WINDOW_LABEL {
        current_pet_render_geometry().window_to_scene(native)
    } else {
        native
    })
}

pub fn probe_pet_drop_plan(
    app: &AppHandle,
    window: &WebviewWindow,
    pos: LogicalPosition<f64>,
    force_floor: bool,
) -> Result<PetDropPlan, String> {
    let monitor = resolve_pet_scene_monitor(&window)
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

    let monitor = resolve_pet_scene_monitor(&window)
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
        set_pet_scene_position(&window, target)
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
        if !apply_pet_window_position_if_motion_current(window, LogicalPosition::new(
                start.x + (target.x - start.x) * eased,
                start.y + (target.y - start.y) * eased,
            ), motion_revision, None)? {
            return Ok(());
        }
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
    #[cfg(target_os = "windows")]
    {
        window
            .hwnd()
            .map(|hwnd| hwnd.0 as usize as i64)
            .unwrap_or(-1)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
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
    hold_seat: Option<bool>,
) -> Result<super::pet_mode_ax_control_veto::SeatResolution, String> {
    async_runtime::spawn_blocking(move || {
        reconcile_resident_pet_position(
            &app,
            reduced_motion.unwrap_or(false),
            hold_seat.unwrap_or(false),
        )
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
    let monitor = resolve_pet_scene_monitor(&window)
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
    apply_pet_seat_resolution(
        &window,
        position,
        resolution,
        reduced_motion,
        None,
        PET_MODE_SEAT_CORRECTION_PURPOSE,
    )
}

fn reconcile_resident_pet_position(
    app: &AppHandle,
    reduced_motion: bool,
    hold_seat: bool,
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
    if !is_windows_overlay_visible(&window) {
        return Ok(SeatResolution::unchanged(
            current.x,
            current.y,
            SeatDecisionReason::PetHidden,
        ));
    }
    let monitor = resolve_pet_scene_monitor(&window)
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
    //
    // A sleeping cat holds its seat: the only motion it still accepts is the
    // bounded move off a control it is covering. Returning to the remembered
    // home while asleep reads as the cat wandering in its sleep, so that
    // return waits until it wakes and the next reconcile runs without the hold.
    let anchor = resident_seat_anchor_for_reconcile(
        hold_seat,
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
        if hold_seat {
            PET_MODE_DROWSY_SEAT_CORRECTION_PURPOSE
        } else {
            PET_MODE_SEAT_CORRECTION_PURPOSE
        },
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
    if !is_windows_overlay_visible(&window) {
        return Ok(SeatResolution::unchanged(
            current.x,
            current.y,
            SeatDecisionReason::PetHidden,
        ));
    }
    let monitor = resolve_pet_scene_monitor(&window)
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

/// Runs the cat to the close control it is about to press.
///
/// The run always animates, whatever the system reduced-motion preference
/// says. The run is what explains why a window is about to close; an instant
/// jump to the X reads as a broken teleport instead. Windows reports reduced
/// motion whenever its system-wide Animation effects switch is off, which many
/// people turn off for speed rather than motion sensitivity (1.11.18 report).
/// The rest of the pet already walks regardless of that preference, and anyone
/// who wants no travel at all can turn off the pet or Automatic close.
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
        activate_lab_browser(target)?;
    }
    // Browsers whose close drives the AX tab selection are preflighted through
    // the close adapter itself before any choreography, including the
    // full-screen scene: a refused preflight means the close will fail, and
    // the cat must not act out a close that cannot happen.
    #[cfg(target_os = "macos")]
    let native_ax_point = resolve_native_ax_close_target(&home_monitor, target);
    #[cfg(not(target_os = "macos"))]
    let native_ax_point: Option<PetModeTargetPoint> = None;
    #[cfg(target_os = "macos")]
    if target.lab_target.is_none()
        && native_ax_point
            .as_ref()
            .map_or(true, |point| point.kind != PetModeTargetKind::Fallback)
    {
        if let Some(frame) = crate::panic_guard::contain_panic(
            "pet_mode_native_ax::fullscreen_target_frame",
            || {
                pet_mode_native_ax::fullscreen_target_frame(
                    &target.app_name,
                    target.browser_name.as_deref(),
                )
            },
        )
        .flatten()
        {
            return pet_fullscreen::approach(app, &window, target, frame);
        }
    }
    let point = if target.lab_target == Some(PetModeLabTargetKind::DriftyWindowX) {
        resolve_drifty_lab_window_close_point(app)?
    } else if let Some(point) = native_ax_point {
        point
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
        PET_MODE_INTERVENTION_RUN_SPEED,
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
        PET_MODE_INTERVENTION_RUN_SPEED,
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
    #[cfg(target_os = "windows")]
    {
        if let Some(point) = pet_mode_windows::resolve_window_close_target(monitor, target) {
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

    #[cfg(target_os = "windows")]
    {
        let size = window
            .outer_size()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale_factor);
        let (x, y) =
            calculate_windows_caption_close_point(position.x, position.y, size.width, None);
        return Ok(PetModeTargetPoint {
            x,
            y,
            kind: PetModeTargetKind::WindowClose,
            confidence: PetModeTargetConfidence::High,
            diagnostic: "windows_titlebar_close_button".to_string(),
        });
    }

    #[cfg(not(target_os = "windows"))]
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

    app.run_on_main_thread(crate::panic_guard::contained("pet_mode::resolve_native_drifty_window_close_target", move || {
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
    }))
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

const WINDOWS_CAPTION_CLOSE_INSET_X: f64 = 23.0;
const WINDOWS_CAPTION_CLOSE_INSET_Y: f64 = 16.0;

fn normalize_windows_app_token(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .to_ascii_lowercase()
}

fn windows_app_name_matches(owner: &str, app_name: &str) -> bool {
    let owner = normalize_windows_app_token(owner);
    let app = normalize_windows_app_token(app_name);
    if owner.is_empty() || app.is_empty() {
        return false;
    }
    if owner == app {
        return true;
    }
    const DISPLAY_ALIASES: &[(&str, &str)] = &[
        ("chrome", "google chrome"),
        ("msedge", "microsoft edge"),
        ("brave", "brave browser"),
        ("chromium", "chromium"),
        ("vivaldi", "vivaldi"),
        ("opera", "opera"),
        ("whale", "whale"),
        ("firefox", "firefox"),
        ("code", "visual studio code"),
        ("notepad", "notepad"),
    ];
    for (exe, display) in DISPLAY_ALIASES {
        if owner == *exe && (app == *display || app == *exe) {
            return true;
        }
        if app == *exe && (owner == *display || owner == *exe) {
            return true;
        }
    }
    app.split(|c: char| !c.is_ascii_alphanumeric())
        .any(|part| !part.is_empty() && part == owner)
}

fn should_resolve_windows_app_window_close(target: &PetModeInterventionTarget) -> bool {
    target
        .browser_name
        .as_deref()
        .map(str::trim)
        .map(str::is_empty)
        .unwrap_or(true)
}

fn calculate_windows_caption_close_point(
    window_x: f64,
    window_y: f64,
    window_width: f64,
    close_button_bounds: Option<(f64, f64, f64, f64)>,
) -> (f64, f64) {
    if let Some((left, top, right, bottom)) = close_button_bounds {
        let close_center_x = window_x + (left + right) / 2.0;
        let close_center_y = window_y + (top + bottom) / 2.0;
        if close_center_x.is_finite() && close_center_y.is_finite() {
            return (close_center_x, close_center_y);
        }
    }
    (
        window_x + window_width - WINDOWS_CAPTION_CLOSE_INSET_X,
        window_y + WINDOWS_CAPTION_CLOSE_INSET_Y,
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

/// The browser whose automatic close will drive the AX tab selection, when
/// this intervention's close is one. Lab and preview runs never close through
/// that adapter, so they keep their own targeting.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn native_ax_close_browser(target: &PetModeInterventionTarget) -> Option<&str> {
    if target.preview || target.lab_target.is_some() {
        return None;
    }
    target
        .browser_name
        .as_deref()
        .map(str::trim)
        .filter(|name| closes_through_native_ax_selection(name))
}

/// Resolves the paw target for a native-AX browser through the close adapter's
/// own preflight. The hotspot is the control that close will press; a refused
/// preflight becomes a non-animated fallback carrying the adapter's reason.
#[cfg(target_os = "macos")]
fn resolve_native_ax_close_target(
    monitor: &Monitor,
    target: &PetModeInterventionTarget,
) -> Option<PetModeTargetPoint> {
    let browser_name = native_ax_close_browser(target)?;
    Some(
        match preflight_native_ax_tab_close(
            browser_name,
            target.site_url.as_deref(),
            target.site_domain.as_deref(),
        ) {
            Ok(hotspot) => native_ax_hotspot_point(hotspot),
            Err(diagnostic) => fallback_target_point(monitor, &diagnostic),
        },
    )
}

#[cfg(target_os = "macos")]
fn native_ax_hotspot_point(hotspot: NativeAxCloseHotspot) -> PetModeTargetPoint {
    PetModeTargetPoint {
        x: hotspot.x,
        y: hotspot.y,
        kind: PetModeTargetKind::BrowserTabClose,
        confidence: if hotspot.exact {
            PetModeTargetConfidence::High
        } else {
            PetModeTargetConfidence::Medium
        },
        diagnostic: hotspot.diagnostic,
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos_accessibility_target(
    target: &PetModeInterventionTarget,
) -> Option<PetModeTargetPoint> {
    let search_selected_tab = target.browser_name.as_deref().is_some()
        || target.lab_target == Some(PetModeLabTargetKind::BrowserTabX);
    if search_selected_tab {
        if let Some(resolved) = crate::panic_guard::contain_panic(
            "pet_mode_native_ax::resolve_selected_browser_tab_close",
            || {
                pet_mode_native_ax::resolve_selected_browser_tab_close(
                    &target.app_name,
                    target.browser_name.as_deref(),
                )
            },
        )
        .flatten()
        {
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
/// use. The Firefox family exposes no scripted tab identity and keeps AX-only
/// behaviour.
#[cfg(target_os = "macos")]
fn selected_tab_mismatch_diagnostic(
    app_name: &str,
    browser_name: Option<&str>,
    selected_tab_label: Option<&str>,
) -> Option<String> {
    let (scripted_name, term) = [browser_name, Some(app_name)]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find_map(|name| scripted_active_tab_term(name).map(|term| (name, term)))?;
    let script = format!(
        r#"tell application "{}"
  try
    if not (exists front window) then return "no_front_window"
    return "title:" & ({} as text)
  on error
    return "unavailable"
  end try
end tell"#,
        applescript_string_literal(scripted_name),
        term,
    );
    let output = run_osascript_with_timeout(&script, Duration::from_millis(1500));
    classify_selected_tab_cross_check(output.as_deref(), selected_tab_label)
}

/// The scripting term each browser family uses for the tab the automatic close
/// will act on. Chromium exposes `title of active tab`; Safari names the same
/// thing `name of current tab`. Safari's live probe ran on 2026-09-19: its tab
/// buttons carry no `AXSelected` attribute and mark the live tab with
/// `AXValue`, which the AX scan already reads, but nothing verified that the
/// tab under the paw is the tab the close acts on.
///
/// A browser whose close drives the AX selection is excluded on purpose. The
/// hotspot and the close then read the same AX tab, so there is nothing to
/// cross-check, and scripting them anyway is actively harmful: Whale's app API
/// hangs (see docs/browser-automation-support.md), which would spend the whole
/// 1.5s timeout on the pet's contact-timeout path and then always fail closed.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn scripted_active_tab_term(app_name: &str) -> Option<&'static str> {
    if closes_through_native_ax_selection(app_name) {
        return None;
    }
    match app_name {
        "Google Chrome"
        | "Google Chrome Canary"
        | "Microsoft Edge"
        | "Arc"
        | "Aside"
        | "Brave Browser"
        | "Chromium"
        | "Opera"
        | "Vivaldi" => Some("title of active tab of front window"),
        "Safari" | "Safari Technology Preview" => Some("name of current tab of front window"),
        _ => None,
    }
}

/// Pure decision for the cross-check so it can be unit tested without AX.
/// `scripted` is the raw osascript stdout (`None` when the script failed or
/// timed out); `selected_tab_label` is the AX label of the tab that claimed
/// selection. Titles are compared after trimming, and a browser that appends
/// a window suffix (`" - Aside"`) still matches on the shared prefix.
/// A narrow tab strip also elides its label (`"Long page tit…"`), so an
/// elided AX label is compared on the part before the ellipsis. Without that
/// every crowded window would report a mismatch the paw never had.
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
        || selected.starts_with(active_title)
        || elided_label_prefix(selected).is_some_and(|prefix| active_title.starts_with(prefix))
        || elided_label_prefix(active_title).is_some_and(|prefix| selected.starts_with(prefix));
    if matches {
        None
    } else {
        Some("browser_tab_selected_mismatch".to_string())
    }
}

/// The readable part of a tab label the strip elided, or `None` when the label
/// is not elided. A bare ellipsis carries no identity, so it never matches.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn elided_label_prefix(label: &str) -> Option<&str> {
    let prefix = label
        .strip_suffix('\u{2026}')
        .or_else(|| label.strip_suffix("..."))?
        .trim_end();
    if prefix.is_empty() {
        None
    } else {
        Some(prefix)
    }
}

/// Runs an AppleScript with a hard deadline. The pet target resolver sits on
/// the contact-timeout critical path, so a hung browser must not turn a
/// cross-check into an 8-second silence.
#[cfg(target_os = "macos")]
fn run_osascript_with_timeout(script: &str, timeout: Duration) -> Option<String> {
    let output = crate::bounded_process::output(
        Command::new("osascript").args(["-e", script]),
        timeout,
    )
    .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
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
        set_pet_scene_position(&window, target)
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
    purpose: &'static str,
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
                purpose,
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
        set_pet_scene_position(&window, target)
            .map_err(|error| error.to_string())?;
    } else {
        animate_pet_window_toward_with_purpose(
            window,
            target,
            PET_MODE_WALK_SPEED,
            PET_MODE_WALK_MAX_SECONDS,
            "walk",
            purpose,
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
    let x = pet_outing_return_start_x(position.x, size.width, pet_width(), side);
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
    let x = pet_outing_return_start_x(position.x, size.width, pet_width(), side);
    LogicalPosition::new(x, home.y)
}

fn resolve_pet_cursor_monitor(app: &AppHandle) -> Option<Monitor> {
    #[cfg(target_os = "macos")]
    {
        let cursor = pet_cursor_in_scene_space(app, 1.0).ok()?;
        return app.available_monitors().ok()?.into_iter().find(|monitor| {
            pet_scene_monitor_contains(
                cursor, 1.0, *monitor.position(), *monitor.size(), monitor.scale_factor(), true,
            )
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
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

/// A held seat (sleeping cat) is its own anchor, so the only move the AX
/// resolver can produce is stepping off a control. Otherwise the usual
/// resident-band rule decides whether the remembered home is the target.
fn resident_seat_anchor_for_reconcile(
    hold_seat: bool,
    current: LogicalPosition<f64>,
    resident_home: LogicalPosition<f64>,
    work_position: LogicalPosition<f64>,
    work_width: f64,
    work_height: f64,
) -> LogicalPosition<f64> {
    if hold_seat {
        clamp_pet_position(current, work_position, work_width, work_height)
    } else {
        resident_seat_anchor_for_current_position(
            current,
            resident_home,
            work_position,
            work_width,
            work_height,
        )
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

fn pet_cursor_position(app: &AppHandle) -> Result<PhysicalPosition<f64>, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        super::pet_cursor_windows::cursor_position()
    }
    #[cfg(not(target_os = "windows"))]
    {
        app.cursor_position().map_err(|error| error.to_string())
    }
}

fn pet_cursor_in_scene_space(
    app: &AppHandle,
    window_scale: f64,
) -> Result<LogicalPosition<f64>, String> {
    // Tao encodes the global NSEvent point using the primary screen's scale,
    // even while the pet is on a different screen. Windows uses physical pixels.
    #[cfg(target_os = "macos")]
    let primary_scale = Some(app.primary_monitor().map_err(|error| error.to_string())?
        .ok_or_else(|| "The primary screen is unavailable".to_string())?.scale_factor());
    #[cfg(not(target_os = "macos"))]
    let primary_scale = None;
    Ok(pet_cursor_sample_in_scene_space(pet_cursor_position(app)?, window_scale, primary_scale))
}

fn pet_cursor_sample_in_scene_space(
    cursor: PhysicalPosition<f64>,
    window_scale: f64,
    macos_primary_scale: Option<f64>,
) -> LogicalPosition<f64> {
    cursor.to_logical(macos_primary_scale.unwrap_or(window_scale))
}

#[cfg(target_os = "windows")]
fn primary_pointer_pressed() -> bool {
    super::pet_cursor_windows::pointer_pressed()
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

#[cfg(any(target_os = "macos", target_os = "windows"))]
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
    if !is_windows_overlay_visible(&window) {
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
    let initial_cursor = pet_cursor_position(app)?;
    let initial_position = current_pet_physical_position(&window)?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let cursor_point = (initial_cursor.x, initial_cursor.y);
    let scene_size = pet_size();
    let panel_size = (scene_size.0 * scale_factor, scene_size.1 * scale_factor);
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

    #[cfg(target_os = "windows")]
    let cursor_context = super::pet_cursor_windows::InteractionContext::capture(&window)?;
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
        if !is_windows_overlay_visible(&window) {
            break PetModeStalkOutcome::Hidden;
        }
        #[cfg(target_os = "windows")]
        if !cursor_context.is_current(&window) {
            break PetModeStalkOutcome::Cancelled;
        }
        if primary_pointer_pressed() {
            break PetModeStalkOutcome::PointerPressed;
        }
        let cursor = pet_cursor_position(app)?;
        let cursor = (cursor.x, cursor.y);
        cursor_movement_distance = cursor_movement_distance
            .max(pet_mode_cursor_movement_distance(cursor, cursor_point) / scale_factor);
        if !screen_frame.contains(cursor) {
            break PetModeStalkOutcome::DifferentDisplay;
        }
        let position = current_pet_physical_position(&window)?;
        let current = (position.x, position.y);
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
        set_pet_scene_physical_position(&window, PhysicalPosition::new(
                next.0,
                next.1,
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

#[cfg(any(target_os = "macos", target_os = "windows"))]
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
    if !is_windows_overlay_visible(&window) {
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::Hidden,
            moved_distance: 0.0,
        });
    }

    if primary_pointer_pressed() {
        return Ok(PetModeCursorCarryResult {
            outcome: PetModeCursorCarryOutcome::PointerPressed,
            moved_distance: 0.0,
        });
    }
    #[cfg(target_os = "windows")]
    let cursor_context = super::pet_cursor_windows::InteractionContext::capture(&window)?;

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
    let initial = pet_cursor_position(app)?;
    let initial = (initial.x, initial.y);
    #[cfg(target_os = "macos")]
    let native_initial = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .and_then(CGEvent::new)
        .map_err(|_| "Could not read the macOS cursor position".to_string())?
        .location();
    let initial_window = current_pet_physical_position(&window)?;
    let initial_window = (initial_window.x as f64, initial_window.y as f64);
    let scene_size = pet_size();
    let panel_size = (scene_size.0 * scale_factor, scene_size.1 * scale_factor);
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

    set_pet_scene_physical_position(&window, PhysicalPosition::new(
            return_window.0,
            return_window.1,
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
        if !is_windows_overlay_visible(&window) {
            break PetModeCursorCarryOutcome::Hidden;
        }
        #[cfg(target_os = "windows")]
        if !cursor_context.is_current(&window) {
            break PetModeCursorCarryOutcome::Cancelled;
        }
        if primary_pointer_pressed() {
            break PetModeCursorCarryOutcome::PointerPressed;
        }

        let cursor = pet_cursor_position(app)?;
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
        set_pet_scene_physical_position(&window, PhysicalPosition::new(
                next_window_x,
                return_window.1,
            ))
            .map_err(|error| format!("Could not carry the Pet Mode window: {error}"))?;
        // set_position can cross the UI-thread boundary. Recheck cancellation
        // after it returns and before touching the shared system cursor.
        if PET_MODE_MOTION_REVISION.load(Ordering::Relaxed) != motion_revision {
            break PetModeCursorCarryOutcome::Cancelled;
        }
        if !PET_MODE_ENABLED.load(Ordering::Relaxed) {
            break PetModeCursorCarryOutcome::Disabled;
        }
        if !is_windows_overlay_visible(&window) {
            break PetModeCursorCarryOutcome::Hidden;
        }
        if primary_pointer_pressed() {
            break PetModeCursorCarryOutcome::PointerPressed;
        }
        #[cfg(target_os = "macos")]
        let native_next = pet_mode_core_graphics_cursor_point(
            (native_initial.x, native_initial.y),
            initial,
            next,
            scale_factor,
        );
        #[cfg(target_os = "macos")]
        CGDisplay::warp_mouse_cursor_position(CGPoint::new(native_next.0, native_next.1))
            .map_err(|error| format!("Could not carry the Pet Mode cursor: {error}"))?;
        #[cfg(target_os = "windows")]
        match cursor_context.move_cursor(
            &window,
            next,
            last_commanded,
            request.yank_distance * scale_factor,
        )? {
            super::pet_cursor_windows::CursorMoveOutcome::Moved => {}
            super::pet_cursor_windows::CursorMoveOutcome::Cancelled => {
                break PetModeCursorCarryOutcome::Cancelled;
            }
            super::pet_cursor_windows::CursorMoveOutcome::PointerPressed => {
                break PetModeCursorCarryOutcome::PointerPressed;
            }
            super::pet_cursor_windows::CursorMoveOutcome::CursorEscaped => {
                break PetModeCursorCarryOutcome::CursorEscaped;
            }
        }
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
    // Finish any temporary dance edge displacement before body-scene motion.
    restore_pet_dance_headroom(window);
    let start = current_pet_logical_position(window)?;
    let distance = ((target.x - start.x).powi(2) + (target.y - start.y).powi(2)).sqrt();
    let duration_seconds = movement_duration_seconds(distance, speed, max_duration_seconds);
    let synchronized_intervention_run =
        motion == "run" && (speed - PET_MODE_INTERVENTION_RUN_SPEED).abs() < f64::EPSILON;
    let timing = synchronized_intervention_run.then_some((
        distance,
        (duration_seconds * 1_000.0).round() as u64,
        PET_MODE_INTERVENTION_RUN_START_DELAY_MS,
    ));
    let Some(motion_revision) = begin_pet_window_motion(
        window,
        facing,
        motion,
        purpose,
        timing,
        outing_generation,
        expected_motion_revision,
    )?
    else {
        return Ok(false);
    };
    // Give the webview one paint boundary to flip before the native window moves.
    thread::sleep(Duration::from_millis(
        PET_MODE_INTERVENTION_RUN_START_DELAY_MS,
    ));
    let result = animate_pet_window(
        window,
        start,
        target,
        distance,
        duration_seconds,
        synchronized_intervention_run,
        motion_revision,
        outing_generation,
    );
    finish_pet_window_motion(motion_revision);
    result
}

fn begin_pet_window_motion(
    window: &WebviewWindow,
    facing: &'static str,
    motion: &'static str,
    purpose: Option<&'static str>,
    timing: Option<(f64, u64, u64)>,
    outing_generation: Option<u64>,
    expected_motion_revision: Option<u64>,
) -> Result<Option<u64>, String> {
    let purpose_kind = pet_motion_purpose(purpose);
    let mut motion_state = PET_MODE_MOTION_START
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if outing_generation.is_some_and(|generation| !pet_outing_is_current(generation)) {
        return Ok(None);
    }
    if expected_motion_revision
        .is_some_and(|expected| PET_MODE_MOTION_REVISION.load(Ordering::Relaxed) != expected)
    {
        return Ok(None);
    }
    if purpose_kind == PetModeMotionPurpose::Protected && motion_state.quick_controls_hold.is_some()
    {
        drop(motion_state);
        super::pet_quick_controls::revoke_pet_quick_controls_interaction(window.app_handle());
        motion_state = PET_MODE_MOTION_START
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if outing_generation.is_some_and(|generation| !pet_outing_is_current(generation)) {
            return Ok(None);
        }
        if expected_motion_revision
            .is_some_and(|expected| PET_MODE_MOTION_REVISION.load(Ordering::Relaxed) != expected)
        {
            return Ok(None);
        }
    }
    if motion_state.quick_controls_hold.is_some()
        && matches!(
            purpose_kind,
            PetModeMotionPurpose::AutonomousRoam | PetModeMotionPurpose::SeatCorrection
        )
    {
        return Ok(None);
    }
    let Some(motion_revision) =
        claim_pet_motion_revision(&PET_MODE_MOTION_REVISION, expected_motion_revision)
    else {
        return Ok(None);
    };
    motion_state.active = Some(PetModeActiveMotion {
        revision: motion_revision,
        purpose: purpose_kind,
    });
    if let Err(error) = emit_pet_event(window, json!({ "kind": "facing", "facing": facing })) {
        motion_state.active = None;
        return Err(error);
    }
    #[cfg(debug_assertions)]
    eprintln!("[pet-mode-motion] motion={motion} purpose={purpose:?} facing={facing}");
    let motion_event = match (purpose, timing) {
        (Some(purpose), Some((travel_distance, duration_ms, start_delay_ms))) => json!({
            "kind": "motion",
            "motion": motion,
            "purpose": purpose,
            "travelDistance": travel_distance,
            "durationMs": duration_ms,
            "startDelayMs": start_delay_ms,
        }),
        (Some(purpose), None) => {
            json!({ "kind": "motion", "motion": motion, "purpose": purpose })
        }
        (None, Some((travel_distance, duration_ms, start_delay_ms))) => json!({
            "kind": "motion",
            "motion": motion,
            "travelDistance": travel_distance,
            "durationMs": duration_ms,
            "startDelayMs": start_delay_ms,
        }),
        (None, None) => json!({ "kind": "motion", "motion": motion }),
    };
    if let Err(error) = emit_pet_event(window, motion_event) {
        motion_state.active = None;
        return Err(error);
    }
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
    let mut motion_state = PET_MODE_MOTION_START
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if motion_state.quick_controls_hold.is_some() {
        return Ok(false);
    }
    let Some(motion_revision) =
        claim_pet_motion_revision(&PET_MODE_MOTION_REVISION, Some(expected_motion_revision))
    else {
        return Ok(false);
    };
    motion_state.active = Some(PetModeActiveMotion {
        revision: motion_revision,
        purpose: PetModeMotionPurpose::SeatCorrection,
    });
    drop(motion_state);
    let result = apply_pet_window_position_if_motion_current(window, target, motion_revision, None);
    finish_pet_window_motion(motion_revision);
    result
}

fn apply_pet_window_position_if_motion_current(
    window: &WebviewWindow,
    target: LogicalPosition<f64>,
    motion_revision: u64,
    outing_generation: Option<u64>,
) -> Result<bool, String> {
    run_pet_native_transaction(window, "pet_mode::apply_pet_window_position_if_motion_current", move |window| {
        if !pet_window_motion_is_current(motion_revision, outing_generation) {
            Ok(false)
        } else {
            set_pet_scene_position(&window, target)
                .map_err(|error| error.to_string())
                .map(|_| pet_window_motion_is_current(motion_revision, outing_generation))
        }
    })
}

fn finish_pet_window_motion(motion_revision: u64) {
    let mut motion_state = PET_MODE_MOTION_START
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if motion_state
        .active
        .is_some_and(|active| active.revision == motion_revision)
    {
        motion_state.active = None;
    }
}

fn animate_pet_window(
    window: &WebviewWindow,
    start: LogicalPosition<f64>,
    target: LogicalPosition<f64>,
    distance: f64,
    duration_seconds: f64,
    synchronized_intervention_run: bool,
    motion_revision: u64,
    outing_generation: Option<u64>,
) -> Result<bool, String> {
    if distance < 1.0 {
        if !pet_window_motion_is_current(motion_revision, outing_generation) {
            return Ok(false);
        }
        return apply_pet_window_position_if_motion_current(
            window,
            target,
            motion_revision,
            outing_generation,
        );
    }
    let duration = Duration::from_secs_f64(duration_seconds);
    let started_at = Instant::now();
    loop {
        if !pet_window_motion_is_current(motion_revision, outing_generation) {
            return Ok(false);
        }
        let progress = (started_at.elapsed().as_secs_f64() / duration_seconds).min(1.0);
        let travel_progress = if synchronized_intervention_run {
            pet_intervention_run_travel_progress(progress, duration_seconds)
        } else {
            progress
        };
        let applied = apply_pet_window_position_if_motion_current(
            window,
            LogicalPosition::new(
                start.x + (target.x - start.x) * travel_progress,
                start.y + (target.y - start.y) * travel_progress,
            ),
            motion_revision,
            outing_generation,
        )?;
        if !applied {
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
    let mut motion_state = PET_MODE_MOTION_START
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry_was_active = PET_MODE_ENTRY_ACTIVE.swap(false, Ordering::Relaxed);
    PET_MODE_MOTION_REVISION.fetch_add(1, Ordering::Relaxed);
    motion_state.active = None;
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
    // A caller's ceiling can sit below the usual 0.18s floor (the old
    // reduced-motion full-screen run passed 0.01s). `f64::clamp` panics when
    // min > max or either is NaN, and a panic here aborts the whole app (Sentry
    // DRIFTY-MAC-NATIVE-5), so fold the floor under the ceiling and never hand
    // NaN to `clamp`.
    let max_duration_seconds = if max_duration_seconds.is_nan() {
        PET_MODE_MIN_MOVEMENT_SECONDS
    } else {
        max_duration_seconds
    };
    let min_duration_seconds = PET_MODE_MIN_MOVEMENT_SECONDS.min(max_duration_seconds);
    let raw_duration_seconds = distance / speed;
    if raw_duration_seconds.is_nan() {
        return min_duration_seconds;
    }
    raw_duration_seconds.clamp(min_duration_seconds, max_duration_seconds)
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
            if let Some(monitor) = resolve_pet_scene_monitor(&window) {
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
        if let Some(monitor) = resolve_pet_scene_monitor(&window) {
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

/// Z-order candidates that already match the browser executable. Prefer the
/// topmost visible window. Restore the topmost minimized window only when
/// every match is minimized.
#[cfg(any(target_os = "windows", test))]
fn select_lab_browser_window_index(iconic_in_z_order: &[bool]) -> Option<usize> {
    iconic_in_z_order
        .iter()
        .position(|iconic| !*iconic)
        .or_else(|| (!iconic_in_z_order.is_empty()).then_some(0))
}

fn activate_lab_browser(target: &PetModeInterventionTarget) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return activate_lab_target_app(&target.app_name);
    }
    #[cfg(target_os = "windows")]
    {
        return pet_mode_windows::activate_lab_browser(target);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = target;
        return Err("Pet Mode Lab browser activation is unavailable on this platform".to_string());
    }
}

fn close_lab_browser_active_tab(target: &PetModeLabTarget) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        return crate::commands::extreme_nudge::close_browser_tab_for_lab(
            target.browser_name.as_deref().unwrap_or(""),
            target.browser_identity.as_deref(),
            target.site_url.as_deref(),
            target.site_domain.as_deref(),
        );
    }
    #[cfg(target_os = "macos")]
    {
        let browser_name = target
            .browser_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "No observed browser is available for the tab-X test".to_string())?;
        return close_lab_browser_active_tab_via_script(browser_name);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = target;
        return Err("Pet Mode Lab browser tab close is unavailable on this platform".to_string());
    }
}

#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
fn close_lab_browser_active_tab_via_script(browser_name: &str) -> Result<String, String> {
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

    #[cfg(target_os = "macos")]
    #[test]
    fn pet_osascript_helper_returns_output_and_bounds_a_stalled_script() {
        let value = run_osascript_with_timeout("return \"drifty-helper\"", Duration::from_secs(5))
            .expect("plain AppleScript needs no app permissions");
        assert_eq!(value.trim(), "drifty-helper");
        let started = Instant::now();
        assert!(run_osascript_with_timeout("delay 2", Duration::from_millis(150)).is_none());
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    fn fresh_drag_session() -> PetDragSessionState {
        PetDragSessionState {
            closed: false,
            epoch: 0,
            current: None,
            canonical_grab: None,
            latest_request_id: None,
        }
    }

    fn tagged_drag(sequence: u8) -> PetDragLease {
        PetDragLease::new(Some(format!("0000000000001-{sequence:06}"))).unwrap()
    }

    #[test]
    fn pet_drag_session_off_on_rejects_queued_a_effects_and_preserves_b_grab() {
        let mut state = fresh_drag_session();
        let a = tagged_drag(1);
        assert!(state.claim(&a, true, state.epoch));
        assert!(state.set_grab(&a, (20.0, 30.0)));
        let queued_a = a.clone();

        state.invalidate(false); // Off or presence hide.
        let b = tagged_drag(2);
        assert!(state.claim(&b, true, state.epoch));
        assert!(state.set_grab(&b, (80.0, 60.0)));

        // Model native owner callbacks queued by A and run after B's claim.
        let mut moves_and_events = Vec::new();
        if state.is_current(&queued_a) {
            moves_and_events.extend(["move", "start", "stroke", "probe", "end"]);
        }
        state.finish(&a); // A's late error/panic/completion cleanup.
        assert!(moves_and_events.is_empty());
        assert!(state.is_current(&b));
        assert_eq!(state.canonical_grab, Some((80.0, 60.0)));
        assert!(!state.set_grab(&a, (0.0, 0.0)));
        assert_eq!(state.canonical_grab, Some((80.0, 60.0)));
    }

    #[test]
    fn pet_drag_session_presence_hide_reveal_rejects_an_unclaimed_a() {
        let mut state = fresh_drag_session();
        let a = tagged_drag(1);
        let queued_epoch = state.epoch;
        state.invalidate(false); // Presence hide does not change outing generation.
        assert!(!state.claim(&a, true, queued_epoch)); // The frame is visible again.
        assert!(state.current.is_none());
        assert!(state.claim(&tagged_drag(2), true, state.epoch));
    }

    #[test]
    fn pet_drag_session_rejected_hidden_or_older_start_does_not_cancel_b() {
        let mut state = fresh_drag_session();
        let b = tagged_drag(2);
        assert!(state.claim(&b, true, state.epoch));
        assert!(state.set_grab(&b, (80.0, 60.0)));
        assert!(!state.claim(&tagged_drag(3), false, state.epoch));
        assert!(!state.claim(&tagged_drag(1), true, state.epoch));
        assert!(state.is_current(&b));
        assert_eq!(state.canonical_grab, Some((80.0, 60.0)));
    }

    #[test]
    fn pet_drag_session_new_gesture_retires_old_worker_before_capture() {
        let mut state = fresh_drag_session();
        let a = tagged_drag(1);
        let b = tagged_drag(2);
        let a_entry_epoch = state.epoch;
        let b_entry_epoch = state.epoch;
        assert!(state.claim(&a, true, a_entry_epoch));
        assert!(state.claim(&b, true, b_entry_epoch));
        assert!(!state.is_current(&a));
        assert!(!a.lifetime.load(Ordering::Acquire));
        assert!(state.is_current(&b));
    }

    #[test]
    fn pet_drag_session_normal_a_finish_does_not_cancel_pending_b() {
        let mut state = fresh_drag_session();
        let a = tagged_drag(1);
        assert!(state.claim(&a, true, state.epoch));
        let b = tagged_drag(2);
        let b_entry_epoch = state.epoch;
        state.finish(&a);
        assert!(state.claim(&b, true, b_entry_epoch));
        assert!(state.is_current(&b));
    }

    #[test]
    fn pet_drag_session_quit_or_timed_out_prepare_cannot_claim_later() {
        let mut state = fresh_drag_session();
        let timed_out = tagged_drag(1);
        state.finish(&timed_out); // Guard dropped while owner callback was queued.
        assert!(!state.claim(&timed_out, true, state.epoch));
        let pending = tagged_drag(2);
        let queued_epoch = state.epoch;
        state.invalidate(true); // Committed Quit.
        assert!(!state.claim(&pending, true, queued_epoch));
        assert!(!state.claim(&tagged_drag(3), true, state.epoch));
    }

    #[test]
    fn pet_drag_session_legacy_clients_work_until_a_tagged_renderer_claims() {
        let mut state = fresh_drag_session();
        let legacy_a = PetDragLease::new(None).unwrap();
        assert!(state.claim(&legacy_a, true, state.epoch));
        state.finish(&legacy_a);
        assert!(state.claim(&PetDragLease::new(None).unwrap(), true, state.epoch));
        let b = tagged_drag(2);
        assert!(state.claim(&b, true, state.epoch));
        assert!(!state.claim(&PetDragLease::new(None).unwrap(), true, state.epoch));
        assert!(state.is_current(&b));
    }

    #[test]
    fn pet_drag_session_event_contract_keeps_legacy_payloads_and_tags_new_events() {
        let id = "0000000000001-000001";
        for name in [
            "pet-mode-drag-start",
            "pet-mode-stroke-detected",
            "pet-mode-drag-probe",
        ] {
            assert_eq!(pet_drag_event_payload(name, None, json!(true)), json!(true));
            assert_eq!(
                pet_drag_event_payload(name, Some(id), json!(true)),
                json!({ "manualRequestId": id, "value": true })
            );
        }
        assert_eq!(
            pet_drag_event_payload("pet-mode-drag-probe", None, Value::Null),
            Value::Null
        );
        assert_eq!(
            pet_drag_event_payload("pet-mode-drag-probe", Some(id), Value::Null),
            json!({ "manualRequestId": id, "value": null })
        );
        let end = json!({ "manualRequestId": id, "moved": true });
        assert_eq!(
            pet_drag_event_payload("pet-mode-drag-end", Some(id), end.clone()),
            end
        );
        for invalid in [
            "",
            "0000000000001-00000",
            "0000000000001x000001",
            "000000000000a-000001",
        ] {
            assert!(PetDragLease::new(Some(invalid.to_string())).is_err());
        }
    }
    #[test]
    fn windows_pet_dpi_receipts_distinguish_native_ingress_from_tauri_delivery() {
        let mut receipts = PetModeWindowsDpiEvents::default();
        receipts.record_native_message((168 << 16) | 168, 1_000);
        receipts.record_tauri_scale_change(1.75, 1_002);
        let before_return = receipts.clone();

        receipts.record_native_message((144 << 16) | 144, 2_000);
        assert_eq!(receipts.native_message_count, 2);
        assert_eq!(receipts.native_last_dpi_x, Some(144));
        assert_eq!(receipts.native_last_dpi_y, Some(144));
        assert_eq!(receipts.native_last_at_ms, Some(2_000));
        assert_eq!(receipts.tauri_scale_change_count, 1);
        assert_eq!(receipts.tauri_last_scale_factor, Some(1.75));
        assert_eq!(receipts.tauri_last_at_ms, Some(1_002));

        // A getter snapshot is a copy: subsequent receipts cannot rewrite an
        // earlier sample or turn a native-only receipt into a Tauri receipt.
        assert_eq!(before_return.native_message_count, 1);
        assert_eq!(before_return.native_last_dpi_x, Some(168));
        receipts.record_tauri_scale_change(1.5, 2_005);
        assert_eq!(receipts.tauri_scale_change_count, 2);
        assert_eq!(receipts.tauri_last_scale_factor, Some(1.5));
        assert_eq!(receipts.native_message_count, 2);
    }

    #[test]
    fn windows_pet_dpi_receipts_export_only_bounded_numeric_fields() {
        let mut receipts = PetModeWindowsDpiEvents::default();
        assert_eq!(
            serde_json::to_value(&receipts).unwrap(),
            json!({
                "nativeMessageCount": 0,
                "tauriScaleChangeCount": 0,
                "settingChangeCount": 0,
                "displayChangeCount": 0,
                "policyFrameChangeCount": 0,
            }),
        );
        receipts.record_native_message((192 << 16) | 144, 3_000);
        receipts.record_tauri_scale_change(1.5, 3_001);
        receipts.record_setting_change(159, 3_002);
        receipts.record_display_change(3_003);
        receipts.record_policy_frame_change(3_004);
        assert_eq!(
            serde_json::to_value(&receipts).unwrap(),
            json!({
                "nativeMessageCount": 1,
                "nativeLastAtMs": 3_000,
                "nativeLastDpiX": 144,
                "nativeLastDpiY": 192,
                "tauriScaleChangeCount": 1,
                "tauriLastAtMs": 3_001,
                "tauriLastScaleFactor": 1.5,
                "settingChangeCount": 1,
                "settingChangeLastAtMs": 3_002,
                "settingChangeLastWparam": 159,
                "displayChangeCount": 1,
                "displayChangeLastAtMs": 3_003,
                "policyFrameChangeCount": 1,
                "policyFrameChangeLastAtMs": 3_004,
            }),
        );
        for scale in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
            receipts.record_tauri_scale_change(scale, 3_002);
            assert_eq!(receipts.tauri_last_scale_factor, None);
            assert_eq!(receipts.tauri_last_at_ms, Some(3_002));
            assert!(!serde_json::to_value(&receipts)
                .unwrap()
                .as_object()
                .unwrap()
                .contains_key("tauriLastScaleFactor"));
        }
        assert_eq!(receipts.tauri_scale_change_count, 5);
    }

    #[test]
    fn windows_pet_dpi_receipts_keep_settings_display_and_policy_independent() {
        let mut receipts = PetModeWindowsDpiEvents::default();
        receipts.record_native_message((168 << 16) | 168, 1_000);
        receipts.record_tauri_scale_change(1.75, 1_002);
        // Preserve only the documented UINT-sized action even if higher
        // WPARAM bits are set. No setting receipt is interpreted as DPI.
        receipts.record_setting_change(((1_u64 << 40) | 159) as usize, 2_000);
        receipts.record_policy_frame_change(2_010);
        let before_display = receipts.clone();
        receipts.record_display_change(2_020);
        receipts.record_setting_change(0, 2_030);

        assert_eq!(receipts.setting_change_count, 2);
        assert_eq!(receipts.setting_change_last_wparam, Some(0));
        assert_eq!(receipts.setting_change_last_at_ms, Some(2_030));
        assert_eq!(receipts.display_change_count, 1);
        assert_eq!(receipts.display_change_last_at_ms, Some(2_020));
        assert_eq!(receipts.policy_frame_change_count, 1);
        assert_eq!(receipts.policy_frame_change_last_at_ms, Some(2_010));
        assert_eq!(receipts.native_message_count, 1);
        assert_eq!(receipts.native_last_dpi_x, Some(168));
        assert_eq!(receipts.native_last_at_ms, Some(1_000));
        assert_eq!(receipts.tauri_scale_change_count, 1);
        assert_eq!(receipts.tauri_last_scale_factor, Some(1.75));
        assert_eq!(receipts.tauri_last_at_ms, Some(1_002));
        assert_eq!(before_display.setting_change_last_wparam, Some(159));
        assert_eq!(before_display.display_change_count, 0);
        assert_eq!(before_display.display_change_last_at_ms, None);
    }

    #[test]
    fn windows_pet_dpi_receipts_saturate_counts_but_keep_latest_receipt() {
        let mut receipts = PetModeWindowsDpiEvents {
            setting_change_count: u64::MAX,
            display_change_count: u64::MAX,
            policy_frame_change_count: u64::MAX,
            ..Default::default()
        };
        receipts.record_setting_change(47, 4_000);
        receipts.record_display_change(4_010);
        receipts.record_policy_frame_change(4_020);
        assert_eq!(receipts.setting_change_count, u64::MAX);
        assert_eq!(receipts.display_change_count, u64::MAX);
        assert_eq!(receipts.policy_frame_change_count, u64::MAX);
        assert_eq!(receipts.setting_change_last_wparam, Some(47));
        assert_eq!(receipts.setting_change_last_at_ms, Some(4_000));
        assert_eq!(receipts.display_change_last_at_ms, Some(4_010));
        assert_eq!(receipts.policy_frame_change_last_at_ms, Some(4_020));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_dpi_awareness_diagnostic_distinguishes_contexts_without_a_window() {
        use windows_sys::Win32::UI::HiDpi::{
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
            DPI_AWARENESS_CONTEXT_SYSTEM_AWARE, DPI_AWARENESS_CONTEXT_UNAWARE,
            DPI_AWARENESS_CONTEXT_UNAWARE_GDISCALED,
        };
        for (context, expected) in [
            (DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, "per_monitor_v2"),
            (DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE, "per_monitor"),
            (DPI_AWARENESS_CONTEXT_SYSTEM_AWARE, "system"),
            (DPI_AWARENESS_CONTEXT_UNAWARE_GDISCALED, "unaware_gdi_scaled"),
            (DPI_AWARENESS_CONTEXT_UNAWARE, "unaware"),
            (std::ptr::null_mut(), "unavailable"),
        ] {
            assert_eq!(windows_dpi_awareness_label(context), expected);
        }
    }

    #[test]
    fn selected_tab_cross_check_accepts_a_matching_active_tab() {
        assert_eq!(
            classify_selected_tab_cross_check(Some("title:StayFree\n"), Some("StayFree")),
            None
        );
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
        assert_eq!(
            classify_selected_tab_cross_check(Some("title:"), Some("새 탭")),
            None
        );
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

    fn browser_intervention(browser_name: Option<&str>) -> PetModeInterventionTarget {
        PetModeInterventionTarget {
            id: "native-ax-preflight".to_string(),
            app_name: browser_name.unwrap_or("Preview").to_string(),
            browser_name: browser_name.map(str::to_string),
            browser_identity: None,
            site_domain: Some("youtube.com".to_string()),
            site_url: Some("https://www.youtube.com/watch?v=drift".to_string()),
            preview: false,
            lab_target: None,
        }
    }

    #[test]
    fn only_real_native_ax_interventions_are_preflighted_through_the_close_adapter() {
        for name in ["Firefox", "Firefox Developer Edition", "Floorp", "Zen", "Whale"] {
            assert_eq!(
                native_ax_close_browser(&browser_intervention(Some(name))),
                Some(name),
                "{name}"
            );
        }
        // Scripted browsers keep their cross-checked hotspot; app targets are
        // window closes, not tab closes.
        for name in [Some("Google Chrome"), Some("Safari"), None] {
            assert_eq!(native_ax_close_browser(&browser_intervention(name)), None);
        }
        let preview = PetModeInterventionTarget {
            preview: true,
            ..browser_intervention(Some("Firefox"))
        };
        assert_eq!(native_ax_close_browser(&preview), None);
        let lab = PetModeInterventionTarget {
            lab_target: Some(PetModeLabTargetKind::BrowserTabX),
            ..browser_intervention(Some("Firefox"))
        };
        assert_eq!(native_ax_close_browser(&lab), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_ax_hotspot_confidence_follows_whether_the_control_was_found() {
        let exact = native_ax_hotspot_point(NativeAxCloseHotspot {
            x: 322.0,
            y: 58.0,
            exact: true,
            diagnostic: "firefox_native_ax_structural_close_button".to_string(),
        });
        assert_eq!(exact.kind, PetModeTargetKind::BrowserTabClose);
        assert_eq!(exact.confidence, PetModeTargetConfidence::High);
        assert_eq!((exact.x, exact.y), (322.0, 58.0));
        assert_eq!(exact.diagnostic, "firefox_native_ax_structural_close_button");

        let inferred = native_ax_hotspot_point(NativeAxCloseHotspot {
            x: 326.0,
            y: 58.0,
            exact: false,
            diagnostic: "whale_native_ax_selected_tab_edge".to_string(),
        });
        assert_eq!(inferred.kind, PetModeTargetKind::BrowserTabClose);
        assert_eq!(inferred.confidence, PetModeTargetConfidence::Medium);
    }

    #[test]
    fn scripted_active_tab_uses_each_browser_family_term() {
        for name in ["Aside", "Google Chrome", "Arc", "Vivaldi"] {
            assert_eq!(
                scripted_active_tab_term(name),
                Some("title of active tab of front window"),
                "{name}"
            );
        }
        // Safari names the same tab differently, so the Chromium term would
        // have raised an AppleScript error and permanently failed closed.
        for name in ["Safari", "Safari Technology Preview"] {
            assert_eq!(
                scripted_active_tab_term(name),
                Some("name of current tab of front window"),
                "{name}"
            );
        }
        // The Firefox family exposes no scripted tab identity, so it keeps
        // AX-only behaviour instead of a check it could never pass.
        for name in ["Firefox", "Zen", "Floorp", "Finder", ""] {
            assert_eq!(scripted_active_tab_term(name), None, "{name}");
        }
        // Whale reads as Chromium everywhere else, but its close drives the AX
        // selection and its app API hangs. Scripting it would burn the pet's
        // 1.5s cross-check budget and then always fail closed.
        assert_eq!(scripted_active_tab_term("Whale"), None);
        assert!(closes_through_native_ax_selection("Whale"));
        // Every browser that keeps a scripted cross-check must be one the
        // close path actually scripts, so the two lists cannot drift apart.
        for name in [
            "Google Chrome",
            "Google Chrome Canary",
            "Microsoft Edge",
            "Arc",
            "Aside",
            "Brave Browser",
            "Chromium",
            "Opera",
            "Vivaldi",
            "Safari",
            "Safari Technology Preview",
        ] {
            assert!(scripted_active_tab_term(name).is_some(), "{name}");
            assert!(!closes_through_native_ax_selection(name), "{name}");
        }
    }

    #[test]
    fn cross_check_accepts_a_tab_label_the_strip_elided() {
        // A crowded tab strip shortens the label it draws. The paw is still on
        // the right tab, so this must not read as a mismatch.
        assert_eq!(
            classify_selected_tab_cross_check(
                Some("title:Drifty pricing and plans"),
                Some("Drifty pricing an\u{2026}"),
            ),
            None,
        );
        assert_eq!(
            classify_selected_tab_cross_check(
                Some("title:Drifty pricing and plans"),
                Some("Drifty pricing an..."),
            ),
            None,
        );
        // An elided label still has to agree on the part it did show.
        assert_eq!(
            classify_selected_tab_cross_check(
                Some("title:Drifty pricing and plans"),
                Some("StayFree dashboar\u{2026}"),
            ),
            Some("browser_tab_selected_mismatch".to_string()),
        );
        // An ellipsis on its own identifies nothing.
        assert_eq!(
            classify_selected_tab_cross_check(Some("title:Drifty"), Some("\u{2026}")),
            Some("browser_tab_selected_mismatch".to_string()),
        );
    }

    #[test]
    fn pet_webview_payload_omits_native_browser_and_page_identity() {
        let target = PetModeInterventionTarget {
            id: "private-browser-target".to_string(),
            app_name: "Google Chrome".to_string(),
            browser_name: Some("Google Chrome".to_string()),
            browser_identity: Some(
                r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string(),
            ),
            site_domain: Some("example.com".to_string()),
            site_url: Some("https://example.com/private/path".to_string()),
            preview: false,
            lab_target: None,
        };

        let value = serde_json::to_value(&target).expect("serialize pet target");
        assert_eq!(
            value.get("appName").and_then(Value::as_str),
            Some("Google Chrome")
        );
        assert!(value.get("browserIdentity").is_none());
        assert!(value.get("siteDomain").is_none());
        assert!(value.get("siteUrl").is_none());
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
            browser_identity: None,
            site_domain: None,
            site_url: None,
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
                assert!(
                    point.diagnostic.starts_with("ax_selected_tab"),
                    "{}",
                    point.diagnostic
                );
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
    fn entry_and_outing_return_share_offscreen_origins() {
        for width in [72.0, 108.0, 144.0, 180.0] {
            for (x, screen_width) in [(0.0, 1440.0), (-1440.0, 1440.0), (1512.0, 1920.0)] {
                for (home_x, side, facing) in [(x + 24.0, "left", "right"), (x + screen_width - width - 24.0, "right", "left")] {
                    let entry = pet_entry_geometry(x, screen_width, home_x, width);
                    assert_eq!(entry.facing, facing);
                    assert_eq!(entry.start_x, pet_outing_return_start_x(x, screen_width, width, side));
                    assert!(entry.start_x + width < x || entry.start_x > x + screen_width);
                }
            }
        }
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
    fn entry_uses_outing_walk_duration_even_for_inland_homes() {
        for distance in [1.0, 54.0, 180.0, 900.0, 2000.0] {
            assert_eq!(pet_entry_duration_ms(distance),
                (movement_duration_seconds(distance, PET_MODE_WALK_SPEED, PET_MODE_WALK_MAX_SECONDS) * 1000.0).round() as u64);
        }
        assert_eq!(pet_entry_duration_ms(180.0), 8654);
        assert_eq!(pet_entry_duration_ms(900.0), 43269);
        assert_eq!(pet_entry_duration_ms(2000.0), 60000);
        let inland = pet_entry_geometry(0.0, 1440.0, 700.0, 144.0);
        assert_eq!(inland.start_x, 1452.0);
        assert!(pet_entry_duration_ms((inland.start_x - 700.0).abs()) > 30_000);
    }

    #[test]
    fn intervention_run_slows_and_settles_into_its_target() {
        assert!((PET_MODE_INTERVENTION_RUN_SPEED / PET_MODE_RUN_SPEED - 0.95).abs() < f64::EPSILON);
        assert_eq!(PET_MODE_INTERVENTION_RUN_START_DELAY_MS, 34);
        assert_eq!(PET_MODE_INTERVENTION_RUN_ACCELERATION_MAX_SECONDS, 0.080);
        assert_eq!(PET_MODE_INTERVENTION_RUN_DECELERATION_MAX_SECONDS, 0.160);
        assert_eq!(PET_MODE_INTERVENTION_RUN_ACCELERATION_MAX_RATIO, 0.08);
        assert_eq!(PET_MODE_INTERVENTION_RUN_DECELERATION_MAX_RATIO, 0.20);

        let duration = movement_duration_seconds(152.0, PET_MODE_INTERVENTION_RUN_SPEED, 0.8);
        assert!((duration - 152.0 / 285.0).abs() < f64::EPSILON);
        assert_eq!(pet_intervention_run_travel_progress(0.0, duration), 0.0);
        assert!((pet_intervention_run_travel_progress(1.0, duration) - 1.0).abs() < f64::EPSILON);

        let p80 = pet_intervention_run_travel_progress(0.80, duration);
        let p85 = pet_intervention_run_travel_progress(0.85, duration);
        let p90 = pet_intervention_run_travel_progress(0.90, duration);
        let p95 = pet_intervention_run_travel_progress(0.95, duration);
        let p100 = pet_intervention_run_travel_progress(1.0, duration);
        assert!(p85 - p80 > p90 - p85);
        assert!(p90 - p85 > p95 - p90);
        assert!(p95 - p90 > p100 - p95);
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
        assert_eq!(
            pet_mode_stalk_duration_ms(f64::INFINITY, 220.0, 2_000),
            2_000
        );
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

    #[test]
    fn a_held_seat_never_targets_the_remembered_home() {
        let work_position = LogicalPosition::new(0.0, 25.0);
        let resident_home = LogicalPosition::new(320.0, 60.0);
        let upper_visible_seat = LogicalPosition::new(560.0, 120.0);

        // Awake in the resident band: the remembered home is the target.
        assert_eq!(
            resident_seat_anchor_for_reconcile(
                false,
                upper_visible_seat,
                resident_home,
                work_position,
                1440.0,
                775.0,
            ),
            resident_home,
        );
        // Asleep in the same spot: the cat anchors where it lies, so a clear
        // scan yields no move and only a control overlap can shift it.
        assert_eq!(
            resident_seat_anchor_for_reconcile(
                true,
                upper_visible_seat,
                resident_home,
                work_position,
                1440.0,
                775.0,
            ),
            upper_visible_seat,
        );
        // A held seat outside the work area is still clamped into it.
        let off_screen = LogicalPosition::new(-80.0, 120.0);
        let clamped = resident_seat_anchor_for_reconcile(
            true,
            off_screen,
            resident_home,
            work_position,
            1440.0,
            775.0,
        );
        assert!(clamped.x >= work_position.x);
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
    fn windows_caption_close_falls_back_to_the_top_right_inset() {
        let (x, y) = calculate_windows_caption_close_point(100.0, 40.0, 800.0, None);
        assert!((x - 877.0).abs() < f64::EPSILON);
        assert!((y - 56.0).abs() < f64::EPSILON);
    }

    #[test]
    fn windows_caption_close_uses_the_measured_close_button_bounds() {
        let (x, y) = calculate_windows_caption_close_point(
            200.0,
            10.0,
            1200.0,
            Some((1142.0, 0.0, 1188.0, 32.0)),
        );
        assert!((x - (200.0 + (1142.0 + 1188.0) / 2.0)).abs() < f64::EPSILON);
        assert!((y - (10.0 + 16.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn windows_app_names_match_tracker_display_names_to_exe_stems() {
        assert!(windows_app_name_matches("chrome", "Google Chrome"));
        assert!(windows_app_name_matches("msedge", "Microsoft Edge"));
        assert!(windows_app_name_matches("notepad", "Notepad"));
        assert!(windows_app_name_matches("Code", "Visual Studio Code"));
        assert!(!windows_app_name_matches("explorer", "Notepad"));
        assert!(!windows_app_name_matches("drifty", "Google Chrome"));
    }

    #[test]
    fn windows_window_close_geometry_is_not_used_for_browser_tab_targets() {
        let app_target = PetModeInterventionTarget {
            id: "notepad-close".to_string(),
            app_name: "Notepad".to_string(),
            browser_name: None,
            browser_identity: None,
            site_domain: None,
            site_url: None,
            preview: false,
            lab_target: None,
        };
        let browser_target = PetModeInterventionTarget {
            id: "chrome-tab-close".to_string(),
            app_name: "Google Chrome".to_string(),
            browser_name: Some("Google Chrome".to_string()),
            browser_identity: Some(
                r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string(),
            ),
            site_domain: Some("example.com".to_string()),
            site_url: Some("https://example.com/drift".to_string()),
            preview: false,
            lab_target: None,
        };

        assert!(should_resolve_windows_app_window_close(&app_target));
        assert!(!should_resolve_windows_app_window_close(&browser_target));
    }

    #[test]
    fn windows_tab_close_hotspot_comes_from_the_close_resolver_for_every_browser() {
        // The paw points at the control the close presses, so the hotspot and
        // the close share one UIA resolver on Windows, Firefox included. A
        // separate geometry path could approve a close the resolver refuses.
        let windows_source = include_str!("pet_mode_windows.rs");
        assert!(windows_source.contains("windows_browser_uia::locate_foreground_tab_close_for_pet("));
        assert!(!windows_source.contains("process_name == \"firefox\""));
        assert!(!windows_source.to_ascii_lowercase().contains("powershell"));
    }

    #[test]
    fn lab_browser_window_prefers_the_topmost_visible_match() {
        assert_eq!(select_lab_browser_window_index(&[]), None);
        assert_eq!(select_lab_browser_window_index(&[false, false]), Some(0));
        assert_eq!(
            select_lab_browser_window_index(&[true, false, false]),
            Some(1)
        );
        assert_eq!(select_lab_browser_window_index(&[true, true]), Some(0));
    }

    #[test]
    fn lab_target_keeps_windows_page_identity_optional() {
        let legacy: PetModeLabTarget = serde_json::from_value(json!({
            "browserName": "Google Chrome",
            "labTarget": "browser_tab_x",
        }))
        .expect("older Lab payload");
        assert!(legacy.browser_identity.is_none());
        assert!(legacy.site_domain.is_none());
        assert!(legacy.site_url.is_none());

        let current: PetModeLabTarget = serde_json::from_value(json!({
            "browserName": "Google Chrome",
            "browserIdentity": r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            "siteDomain": "example.com",
            "siteUrl": "https://example.com/drift",
            "labTarget": "browser_tab_x",
        }))
        .expect("Windows Lab payload");
        assert_eq!(
            current.browser_identity.as_deref(),
            Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
        );
        assert_eq!(current.site_domain.as_deref(), Some("example.com"));
        assert_eq!(
            current.site_url.as_deref(),
            Some("https://example.com/drift")
        );
    }

    #[test]
    fn windows_lab_browser_close_does_not_shell_out_to_applescript() {
        let windows = include_str!("pet_mode_windows.rs");
        assert!(windows.contains("fn activate_lab_browser"));
        assert!(windows.contains("SetForegroundWindow"));
        assert!(!windows.contains("osascript"));
        let pet = include_str!("pet_mode.rs");
        assert!(pet.contains("close_browser_tab_for_lab"));
        assert!(pet
            .contains("#[cfg(target_os = \"macos\")]\nfn close_lab_browser_active_tab_via_script"));
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
    fn movement_duration_never_panics_when_ceiling_is_below_floor() {
        // Reduced-motion fullscreen chase: speed f64::MAX, ceiling 0.01s.
        assert_eq!(movement_duration_seconds(640.0, f64::MAX, 0.01), 0.01);
        // Zero speed yields +inf; the ceiling still wins.
        assert_eq!(movement_duration_seconds(640.0, 0.0, 0.01), 0.01);
        // NaN inputs fall back to the floor instead of panicking.
        assert_eq!(movement_duration_seconds(f64::NAN, 1.0, 2.0), 0.18);
        assert_eq!(movement_duration_seconds(10.0, 1.0, f64::NAN), 0.18);
        // Normal callers keep the historical floor.
        assert_eq!(movement_duration_seconds(1.0, 300.0, 2.0), 0.18);
    }

    #[test]
    fn quick_controls_hold_accepts_only_stationary_or_autonomous_roam_motion() {
        assert_eq!(
            pet_quick_controls_interaction_policy(false, false, None),
            PetQuickControlsInteractionPolicy::Allow,
        );
        assert_eq!(
            pet_quick_controls_interaction_policy(
                false,
                false,
                Some(PetModeMotionPurpose::AutonomousRoam),
            ),
            PetQuickControlsInteractionPolicy::InterruptAutonomousRoam,
        );
        for purpose in [
            PetModeMotionPurpose::SeatCorrection,
            PetModeMotionPurpose::Protected,
        ] {
            assert_eq!(
                pet_quick_controls_interaction_policy(false, false, Some(purpose)),
                PetQuickControlsInteractionPolicy::Deny,
            );
        }
        assert_eq!(
            pet_quick_controls_interaction_policy(true, false, None),
            PetQuickControlsInteractionPolicy::Deny,
        );
        assert_eq!(
            pet_quick_controls_interaction_policy(false, true, None),
            PetQuickControlsInteractionPolicy::Deny,
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
        let dance: PetModePreviewAction = serde_json::from_str("\"dance\"").unwrap();
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
        assert!(matches!(dance, PetModePreviewAction::Dance));
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

    #[test]
    fn preview_actions_preempt_native_motion_except_additive_accents() {
        assert!(PetModePreviewAction::Stop.preempts_native_motion());
        assert!(PetModePreviewAction::Dance.preempts_native_motion());
        assert!(PetModePreviewAction::Walk.preempts_native_motion());
        assert!(PetModePreviewAction::Wake.preempts_native_motion());
        assert!(!PetModePreviewAction::MusicNote.preempts_native_motion());
        assert!(!PetModePreviewAction::LifeLoop.preempts_native_motion());
    }

    #[test]
    fn dance_edge_correction_moves_only_the_visible_pose_and_preserves_its_anchor() {
        assert_eq!(pet_dance_scene_y(14.0, 36.0, 0.0), 36.0);
        assert_eq!(pet_dance_scene_y(60.0, 36.0, 0.0), 60.0);
        assert_eq!(pet_dance_scene_y(-1066.0, 36.0, -1080.0), -1044.0);
        assert_eq!(pet_dance_scene_y(14.0, 45.0, 0.0), 45.0);
    }

    #[test]
    fn dance_extent_follows_uniform_pet_size() {
        for scale in [0.5, 0.75, 1.0, 1.25] {
            let width = PET_MODE_WIDTH * scale;
            assert_eq!(pet_dance_headroom_for_width(width), 36.0 * scale);
        }
    }

    #[test]
    fn macos_scene_monitor_selection_uses_one_logical_space_for_mixed_backing_scales() {
        // Tao scales each CGDisplayBounds origin with that display's backing
        // factor, but the NSWindow scene center uses the window's factor.
        // The resulting physical rectangles overlap even for adjacent screens.
        let monitors = [
            (PhysicalPosition::new(0, 0), PhysicalSize::new(2880, 1800), 2.0),
            (PhysicalPosition::new(1440, 0), PhysicalSize::new(1920, 1080), 1.0),
        ];
        let scene = LogicalPosition::new(1590.0, 500.0);
        let selected = monitors.iter().position(|(origin, size, scale)| {
            pet_scene_monitor_contains(scene, 1.0, *origin, *size, *scale, true)
        });
        assert_eq!(selected, Some(1), "the body is on the backing-1 external display");
        for window_scale in [1.0, 1.25, 2.0] {
            assert!(!pet_scene_monitor_contains(scene, window_scale, monitors[0].0, monitors[0].1, 2.0, true));
            assert!(pet_scene_monitor_contains(scene, window_scale, monitors[1].0, monitors[1].1, 1.0, true));
        }
    }

    #[test]
    fn macos_scene_monitor_selection_handles_negative_origins_and_half_open_boundaries() {
        for scale in [1.0, 1.25, 2.0] {
            let monitors = [
                (LogicalPosition::new(-1920.0, 0.0), tauri::LogicalSize::new(1920.0, 1080.0)),
                (LogicalPosition::new(0.0, 0.0), tauri::LogicalSize::new(1440.0, 900.0)),
                (LogicalPosition::new(0.0, -1080.0), tauri::LogicalSize::new(1920.0, 1080.0)),
            ];
            for (point, expected) in [
                ((-1920.0, 0.0), Some(0)),
                ((-0.25, 0.0), Some(0)),
                ((0.0, 0.0), Some(1)),
                ((1439.75, 899.75), Some(1)),
                ((0.0, -1080.0), Some(2)),
                ((1919.75, -0.25), Some(2)),
                ((1440.0, 0.0), None),
                ((1920.0, -0.25), None),
                ((-1920.25, 0.0), None),
                ((-10.0, 1080.0), None),
                ((-0.25, -0.25), None),
            ] {
                let selected = monitors.iter().position(|(origin, size)| {
                    pet_scene_monitor_contains(
                        LogicalPosition::new(point.0, point.1), scale,
                        origin.to_physical(scale), size.to_physical(scale), scale, true,
                    )
                });
                assert_eq!(selected, expected, "point {point:?}, backing scale {scale}");
            }
        }
    }

    #[test]
    fn macos_scene_monitor_selection_handles_a_mixed_scale_display_above_primary() {
        let scene = LogicalPosition::new(1590.0, -500.0);
        assert!(!pet_scene_monitor_contains(
            scene, 2.0, PhysicalPosition::new(0, 0), PhysicalSize::new(1440, 900), 1.0, true,
        ));
        assert!(pet_scene_monitor_contains(
            scene, 2.0, PhysicalPosition::new(0, -2160), PhysicalSize::new(3840, 2160), 2.0, true,
        ));
    }

    #[test]
    fn windows_scene_monitor_selection_keeps_physical_desktop_coordinates() {
        let scene = LogicalPosition::new(1590.0, 500.0);
        let primary = (PhysicalPosition::new(0, 0), PhysicalSize::new(2880, 1800));
        let external = (PhysicalPosition::new(2880, 0), PhysicalSize::new(1920, 1080));
        assert!(!pet_scene_monitor_contains(scene, 2.0, primary.0, primary.1, 2.0, false));
        assert!(pet_scene_monitor_contains(scene, 2.0, external.0, external.1, 1.0, false));
        assert!(pet_scene_monitor_contains(scene, 1.0, primary.0, primary.1, 2.0, false));
        assert!(!pet_scene_monitor_contains(scene, 1.0, external.0, external.1, 1.0, false));
    }

    #[test]
    fn macos_cursor_sample_and_held_resize_use_primary_backing_scale() {
        let old = pet_render_layout().geometry(PET_MODE_WIDTH);
        let next = pet_render_layout().geometry(PET_MODE_WIDTH * 1.25);
        let origin = LogicalPosition::new(-1884.0, 20.0);
        let grab = (50.0, 40.0);
        let expected_pointer = LogicalPosition::new(-1822.0, 52.0);
        let cursor = expected_pointer.to_physical::<f64>(2.0);
        for window_scale in [1.0, 1.25, 2.0] {
            let pointer = pet_cursor_sample_in_scene_space(cursor, window_scale, Some(2.0));
            assert_eq!(pointer, expected_pointer);
            let resized = pet_scene_origin_after_resize(origin, old, next, Some(pointer), Some(grab));
            assert_eq!(resized.x + grab.0 * next.scale(), expected_pointer.x);
            assert_eq!(resized.y + grab.1 * next.scale(), expected_pointer.y);
        }
    }

    #[test]
    fn windows_cursor_sample_keeps_the_window_scale_factor() {
        let cursor = PhysicalPosition::new(1590.0, -500.0);
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            assert_eq!(
                pet_cursor_sample_in_scene_space(cursor, scale, None),
                cursor.to_logical::<f64>(scale),
            );
        }
    }

    #[test]
    fn macos_dance_ceiling_keeps_scaled_heads_below_the_menu_bar() {
        // A 24pt menu bar on a backing-2 display occupies 48 physical pixels.
        let display_top = PhysicalPosition::new(0, 0).to_logical::<f64>(2.0).y;
        let visible_top = PhysicalPosition::new(0, 48).to_logical::<f64>(2.0).y;
        let ceiling = pet_dance_visible_top(display_top, Some(visible_top));
        assert_eq!(ceiling, 24.0);
        for (scale, expected_scene_y) in [
            (0.5, 42.0),
            (0.75, 51.0),
            (1.0, 60.0),
            (1.25, 69.0),
        ] {
            let extent = pet_dance_headroom_for_width(PET_MODE_WIDTH * scale);
            let scene_y = pet_dance_scene_y(14.0, extent, ceiling);
            assert_eq!(scene_y, expected_scene_y);
            assert_eq!(scene_y - extent, visible_top);
        }
    }

    #[test]
    fn macos_dance_ceiling_handles_a_display_above_the_primary_screen() {
        let display_top = PhysicalPosition::new(0, -2160).to_logical::<f64>(2.0).y;
        let visible_top = PhysicalPosition::new(0, -2112).to_logical::<f64>(2.0).y;
        let ceiling = pet_dance_visible_top(display_top, Some(visible_top));
        assert_eq!(ceiling, -1056.0);
        let extent = pet_dance_headroom_for_width(PET_MODE_WIDTH * 1.25);
        assert_eq!(pet_dance_scene_y(-1066.0, extent, ceiling), -1011.0);
        // An auto-hidden menu bar leaves the full display available.
        assert_eq!(
            pet_dance_visible_top(display_top, Some(display_top)),
            display_top
        );
    }

    #[test]
    fn macos_dance_ceiling_does_not_displace_a_centered_body_anchor() {
        let ceiling = pet_dance_visible_top(0.0, Some(24.0));
        let original_anchor_y = 300.0;
        let extent = pet_dance_headroom_for_width(PET_MODE_WIDTH * 1.25);
        assert_eq!(
            pet_dance_scene_y(original_anchor_y, extent, ceiling),
            original_anchor_y
        );
    }

    #[test]
    fn dance_ceiling_without_macos_work_area_preserves_the_display_top_policy() {
        let ceiling = pet_dance_visible_top(0.0, None);
        assert_eq!(ceiling, 0.0);
        assert_eq!(pet_dance_scene_y(14.0, 45.0, ceiling), 45.0);
        assert_eq!(pet_dance_visible_top(-1080.0, None), -1080.0);
    }

    #[test]
    fn a_late_geometry_request_cannot_overwrite_a_newer_size() {
        assert!(pet_geometry_request_is_current(12, 12));
        assert!(!pet_geometry_request_is_current(11, 12));
        assert!(!pet_geometry_request_is_current(12, 13));
    }

    fn enabled_pet_completion(scale_factor: f64) -> PetEnableCompletionObservation {
        let geometry = pet_render_layout().geometry(180.0);
        let frame = geometry.window_size().to_physical::<u32>(scale_factor);
        PetEnableCompletionObservation {
            geometry_revision: 12,
            visibility_generation: 7,
            enabled: true,
            scene_size: (geometry.scene_width, geometry.scene_height),
            frame_size: (frame.width, frame.height),
            scale_factor,
            visible: true,
        }
    }

    #[test]
    fn enable_completion_requires_the_requested_body_native_frame_and_visibility() {
        let request = PetModeGeometryRequest { width: 180.0, revision: 12 };
        for dpi in [1.0, 1.25, 1.5, 1.75, 2.0] {
            assert_eq!(pet_enable_completion_applied(request, 7, enabled_pet_completion(dpi)), Ok(true));
            let mut hidden = enabled_pet_completion(dpi);
            hidden.visible = false;
            assert!(pet_enable_completion_applied(request, 7, hidden).is_err());
            let mut old_frame = enabled_pet_completion(dpi);
            let initial = pet_render_layout().geometry(PET_MODE_WIDTH).window_size().to_physical::<u32>(dpi);
            old_frame.frame_size = (initial.width, initial.height);
            assert!(pet_enable_completion_applied(request, 7, old_frame).is_err());
            let mut old_body = enabled_pet_completion(dpi);
            old_body.scene_size = (PET_MODE_WIDTH, PET_MODE_HEIGHT);
            assert!(pet_enable_completion_applied(request, 7, old_body).is_err());
        }
    }

    #[test]
    fn enable_completion_rejects_a_frame_left_at_the_previous_display_dpi() {
        let request = PetModeGeometryRequest { width: 180.0, revision: 12 };
        let mut observed = enabled_pet_completion(1.75);
        observed.scale_factor = 1.5;
        assert!(pet_enable_completion_applied(request, 7, observed).is_err());
    }

    #[test]
    fn late_enable_completion_never_retries_superseded_size_or_off() {
        let request = PetModeGeometryRequest { width: 180.0, revision: 12 };
        for cause in ["size", "off", "generation"] {
            let mut observed = enabled_pet_completion(1.5);
            observed.visible = false;
            observed.frame_size = (252, 236);
            match cause {
                "size" => observed.geometry_revision = 13,
                "off" => {
                    observed.enabled = false;
                    observed.visibility_generation = 8;
                }
                _ => observed.visibility_generation = 8,
            }
            assert!(!pet_enable_presentation_is_current(request.revision, observed.geometry_revision, 7, observed.visibility_generation));
            assert_eq!(pet_enable_completion_applied(request, 7, observed), Ok(false));
        }
    }

    #[test]
    fn live_dpi_changes_repair_the_surface_without_a_pet_size_change_or_rehome() {
        for pet_scale in [0.5, 0.75, 1.0, 1.25] {
            let geometry = pet_render_layout().geometry(PET_MODE_WIDTH * pet_scale);
            let unchanged_scene = (geometry.scene_width, geometry.scene_height);
            let mut physical_frame = geometry.window_size().to_physical::<u32>(1.0);
            // The observed regression held the old physical frame while the
            // settings pet percent stayed unchanged across OS scale changes.
            for dpi in [1.25, 1.75, 1.5, 1.0] {
                let expected = geometry.window_size().to_physical::<u32>(dpi);
                assert_ne!(physical_frame, expected);
                let update = pet_geometry_update_kind(
                    unchanged_scene,
                    geometry,
                    physical_frame != expected,
                );
                assert_eq!(update, Some(false), "DPI repairs must bypass the same-body no-op without triggering resized-home policy");
                physical_frame = expected;
                assert_eq!(
                    pet_geometry_update_kind(unchanged_scene, geometry, false),
                    None,
                );
                // A scale event also reasserts the WebView's native bounds if
                // Windows already resized the HWND before our queued job.
                assert_eq!(
                    pet_geometry_update_kind(unchanged_scene, geometry, true),
                    Some(false),
                );
            }
        }
        let base = pet_render_layout().geometry(PET_MODE_WIDTH);
        let larger = pet_render_layout().geometry(PET_MODE_WIDTH * 1.25);
        assert_eq!(
            pet_geometry_update_kind((base.scene_width, base.scene_height), larger, false),
            Some(true),
        );
    }

    #[test]
    fn a_live_dpi_refresh_uses_the_drag_workers_original_authored_grab() {
        let point = (50.0, 40.0);
        let physical_pointer = PhysicalPosition::new(-1840.25, 100.75);
        for pet_scale in [0.5, 0.75, 1.0, 1.25] {
            let geometry = pet_render_layout().geometry(PET_MODE_WIDTH * pet_scale);
            for dpi in [1.0, 1.25, 1.5, 1.75, 2.0] {
                let scene =
                    pet_scene_origin_at_grab(physical_pointer.to_logical(dpi), geometry, point);
                let window = geometry.scene_to_window(scene);
                let held_point = geometry.window_point_for_canonical(point);
                assert!(((window.x + held_point.0) * dpi - physical_pointer.x).abs() < 1e-9);
                assert!(((window.y + held_point.1) * dpi - physical_pointer.y).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn resizing_a_moving_grab_keeps_the_workers_captured_point() {
        let mut state = fresh_drag_session();
        let lease = tagged_drag(1);
        assert!(state.claim(&lease, true, state.epoch));
        assert!(state.set_grab(&lease, (50.0, 40.0)));
        let old = pet_render_layout().geometry(144.0);
        let origin = LogicalPosition::new(-1884.0, 20.0);
        // The pointer moved after the previous owner apply. A resize reaches
        // the owner before the next coalesced drag apply catches the frame up.
        let pointer = LogicalPosition::new(origin.x + 50.0 + 12.0, origin.y + 40.0 - 8.0);
        for scale in [0.5, 0.75, 1.0, 1.25] {
            let next = pet_render_layout().geometry(144.0 * scale);
            let resized = pet_scene_origin_after_resize(origin, old, next, Some(pointer), state.canonical_grab);
            let captured = state.canonical_grab.unwrap();
            assert!((resized.x + captured.0 * scale - pointer.x).abs() < 1e-9,
                "resize must keep the same authored X point as the drag worker");
            assert!((resized.y + captured.1 * scale - pointer.y).abs() < 1e-9,
                "resize must keep the same authored Y point as the drag worker");
            let following = pet_scene_origin_at_grab(pointer, next, captured);
            assert_eq!(resized, following, "the next drag apply must not correct a resize jump");
        }
    }

    #[test]
    fn resizing_during_a_grab_preserves_the_authored_point_in_world_space() {
        let old = pet_render_layout().geometry(144.0);
        let origin = LogicalPosition::new(-1884.0, 20.0);
        let pointer = LogicalPosition::new(origin.x + 50.0, origin.y + 40.0);
        for scale in [0.5, 0.75, 1.0, 1.25] {
            let next = pet_render_layout().geometry(144.0 * scale);
            let resized = pet_scene_origin_after_resize(origin, old, next, Some(pointer), None);
            assert!((resized.x + 50.0 * scale - pointer.x).abs() < 1e-9);
            assert!((resized.y + 40.0 * scale - pointer.y).abs() < 1e-9);
            // The settings sync reaches set_enabled after this geometry
            // transaction. Its resting-home policy must preserve this grab.
            let size_changed = scale != 1.0;
            for reduced_motion in [false, true] {
                assert!(!should_settle_pet_enable_change(false, reduced_motion, size_changed, true));
                assert_eq!(should_settle_pet_enable_change(false, reduced_motion, size_changed, false), size_changed);
            }
            let resting = pet_scene_origin_after_resize(origin, old, next, None, Some((50.0, 40.0)));
            assert_eq!(resting, origin);
        }
        // Switching to reduced motion still settles an unheld entry.
        assert!(should_settle_pet_enable_change(true, true, false, false));
        assert!(!should_settle_pet_enable_change(true, false, false, false));
    }

}
