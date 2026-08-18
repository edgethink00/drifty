use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    sync::atomic::{AtomicU64, AtomicU8, Ordering},
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, PhysicalPosition as Point,
    PhysicalSize as Size, WebviewUrl, WebviewWindowBuilder,
};

#[cfg(not(target_os = "macos"))]
use super::companion_panel::move_companion_panel_by;
#[cfg(target_os = "macos")]
use super::companion_panel::perform_companion_panel_drag;
use super::companion_panel::{
    configure_companion_panel, reset_companion_panel_vertical_center, resize_companion_panel,
    resolve_companion_horizontal_anchor, show_companion_panel, CompanionFrame,
    CompanionHorizontalAnchor, CompanionVerticalAnchor,
};
use super::watcher_extreme_nudge::{
    calculate_extreme_nudge_toast_window_position, extreme_nudge_toast_window_dimensions,
    is_extreme_nudge_toast_payload,
};

pub const WATCHER_PEEK_WINDOW_LABEL: &str = "watcher-peek";
pub const COMPANION_PILL_WINDOW_LABEL: &str = "companion-pill";

const WATCHER_PEEK_WIDTH: f64 = 560.0;
const WATCHER_PEEK_HEIGHT: f64 = 340.0;
const END_OF_DAY_REVIEW_WIDTH: f64 = 560.0;
const END_OF_DAY_REVIEW_HEIGHT: f64 = 720.0;
pub(super) const WATCHER_PEEK_WORK_AREA_MARGIN: f64 = 32.0;

pub(super) const COMPANION_PILL_COLLAPSED_WIDTH: f64 = 220.0;
const COMPANION_PILL_COLLAPSED_HEIGHT: f64 = 28.9;
/* Kept for protocol compatibility; the UI no longer enters hover peek. */
const COMPANION_PILL_PEEK_WIDTH: f64 = 220.0;
const COMPANION_PILL_PEEK_HEIGHT: f64 = 28.9;
const COMPANION_PILL_MILESTONE_WIDTH: f64 = 348.0;
const COMPANION_PILL_MILESTONE_HEIGHT: f64 = 54.0;
/// Space for the measured milestone figure printed beside the headline. The
/// figure is part of the product treatment rather than a user preference.
const COMPANION_PILL_MILESTONE_STAT_WIDTH: f64 = 62.0;
const COMPANION_PILL_REENTRY_WIDTH: f64 = 410.0;
const COMPANION_PILL_REENTRY_HEIGHT: f64 = 54.0;
const COMPANION_PILL_MOMENT_WIDTH: f64 = 352.0;
const COMPANION_PILL_MOMENT_HEIGHT: f64 = 130.0;
const COMPANION_PILL_REVIEW_WIDTH: f64 = 331.0;
const COMPANION_PILL_REVIEW_HEIGHT: f64 = 480.0;
const COMPANION_PILL_COMPACT_REVIEW_WIDTH: f64 = 310.0;
const COMPANION_PILL_COMPACT_REVIEW_HEIGHT: f64 = 284.0;
const COMPANION_PILL_MINIMAL_REVIEW_WIDTH: f64 = 310.0;
const COMPANION_PILL_MINIMAL_REVIEW_HEIGHT: f64 = 223.0;
pub(super) const COMPANION_PILL_CANVAS_WIDTH: f64 =
    COMPANION_PILL_MILESTONE_WIDTH + COMPANION_PILL_MILESTONE_STAT_WIDTH;
/// Keep the resident pill below the menu bar while letting its visible right
/// edge sit exactly on the display boundary. Horizontal anchoring and vertical
/// menu-bar clearance are intentionally different product decisions.
const COMPANION_PILL_TOP_MARGIN: f64 = 24.0;
/// Breathing room under the menu bar for a card opened from the status item.
/// Paired with `COMPANION_MENU_BAR_GAP_X` so a card pushed against the screen
/// edge keeps a comparable margin on both axes instead of reading as a panel
/// welded to the corner.
const COMPANION_MENU_BAR_GAP_Y: f64 = 8.0;
/// Minimum gap between a menu-bar card and the right edge of the work area.
/// A status item near the edge — or pushed past it on a crowded menu bar —
/// used to clamp the card flush against the boundary, leaving 0px on the
/// right while the top kept its gap.
const COMPANION_MENU_BAR_GAP_X: f64 = 12.0;
/// How far the card's pointer stays clear of its own rounded corners. The
/// pointer is a 12px diamond (`--menu-anchor-x` in `companion-pill.css`) and
/// the widest corner radius is 17px, so half the pointer plus that radius is
/// the point where the tail stops overlapping the curve.
const COMPANION_MENU_BAR_POINTER_INSET: f64 = 23.0;
const COMPANION_MENU_BAR_HIDE_DELAY: Duration = Duration::from_millis(360);
#[cfg(not(target_os = "macos"))]
const COMPANION_PILL_EDGE_ANCHOR_THRESHOLD: f64 = 24.0;
/// How much of the capsule has to stay on screen after a drag.
///
/// The pill has no title bar, so something has to remain grabbable; beyond that
/// it is the user's to place, including flush against an edge. Sized to leave a
/// comfortable target rather than a sliver.
pub(super) const COMPANION_PILL_MIN_REACHABLE_X: f64 = 72.0;
pub(super) const COMPANION_PILL_MIN_REACHABLE_Y: f64 = 24.0;
/// A native window cannot paint outside its own frame, so every companion panel
/// carries a transparent gutter and the capsule floats inside it. Without it the
/// capsule's drop shadow — which needs ~36px below the pill — was sliced off at
/// the window edge and read as a hard grey rectangle around the rounded pill.
///
/// One value serves every state on purpose. Horizontally, the native window
/// keeps the widest capsule canvas and CSS pins each state to its right inset;
/// vertically, only the window height changes. That separation keeps the
/// screen-right gap exact without clipping the shadow or confetti.
///
/// Sized to hold the widest thing drawn outside the capsule, a tier-3 confetti
/// burst (see COMPANION_PILL_CONFETTI_SPREAD in CompanionPillMoment.tsx).
pub(super) const COMPANION_PILL_GUTTER_X: f64 = 88.0;
pub(super) const COMPANION_PILL_GUTTER_Y: f64 = 64.0;
/// When the resident Companion is disabled, celebrations use the legacy watcher
/// window but keep the exact capsule and confetti canvas. The outer window may
/// extend into the screen edge; only the visible capsule is anchored in the
/// work area, matching the resident panel.
const STANDALONE_MILESTONE_WINDOW_WIDTH: f64 =
    COMPANION_PILL_CANVAS_WIDTH + COMPANION_PILL_GUTTER_X * 2.0;
const STANDALONE_MILESTONE_WINDOW_HEIGHT: f64 =
    COMPANION_PILL_MILESTONE_HEIGHT + COMPANION_PILL_GUTTER_Y * 2.0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
enum CompanionSurfacePolicy {
    Off = 0,
    Floating = 1,
    MenuBar = 2,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionSetStateResult {
    prepared: bool,
    menu_anchor_x: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct MenuBarCompanionPlacement {
    window_position: LogicalPosition<f64>,
    /// Horizontal coordinate inside the visible capsule that points back to
    /// the native status item. The webview uses the same value for the speech
    /// tail and transform origin, so placement and motion cannot drift apart.
    anchor_x: f64,
}

impl CompanionSurfacePolicy {
    fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Floating,
            2 => Self::MenuBar,
            _ => Self::Off,
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "off" => Ok(Self::Off),
            "floating" => Ok(Self::Floating),
            "menuBar" => Ok(Self::MenuBar),
            _ => Err(format!("unknown companion surface policy: {value}")),
        }
    }
}

static COMPANION_SURFACE_POLICY: AtomicU8 = AtomicU8::new(CompanionSurfacePolicy::Off as u8);
/// Invalidates a delayed menu-bar hide whenever a newer moment arrives. A
/// dismissal and the next preview can otherwise cross on the main thread: the
/// stale timer sees the old resting state and hides the newly prepared card.
static COMPANION_MENU_BAR_VISIBILITY_GENERATION: AtomicU64 = AtomicU64::new(0);
/// Center is the normal relationship. An edge is pinned only when centering the
/// target card would clip it against that display edge. The chosen relationship
/// is retained for the matching close transition.
static COMPANION_PILL_HORIZONTAL_ANCHOR: AtomicU8 =
    AtomicU8::new(CompanionHorizontalAnchor::Right as u8);
/// Vertical center is preserved unless centering the expanded card would cross
/// the menu bar or display bottom. Retain the choice for the close transition
/// so opening and closing follow the exact same path in reverse.
static COMPANION_PILL_VERTICAL_ANCHOR: AtomicU8 =
    AtomicU8::new(CompanionVerticalAnchor::Center as u8);
/// The pill state the webview last moved into. The native side needs it to know
/// the visible capsule width and its left inset inside the fixed canvas for hit
/// testing, anchoring, and drag bounds.
static COMPANION_PILL_STATE: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

pub(super) fn companion_pill_state() -> String {
    COMPANION_PILL_STATE
        .lock()
        .map(|state| state.clone())
        .unwrap_or_default()
}

fn set_companion_pill_state(state: &str) {
    if let Ok(mut current) = COMPANION_PILL_STATE.lock() {
        current.clear();
        current.push_str(state);
    }
}

fn companion_pill_horizontal_anchor() -> CompanionHorizontalAnchor {
    CompanionHorizontalAnchor::from_u8(COMPANION_PILL_HORIZONTAL_ANCHOR.load(Ordering::SeqCst))
}

fn set_companion_pill_horizontal_anchor(anchor: CompanionHorizontalAnchor) {
    COMPANION_PILL_HORIZONTAL_ANCHOR.store(anchor as u8, Ordering::SeqCst);
}

fn companion_pill_vertical_anchor() -> CompanionVerticalAnchor {
    CompanionVerticalAnchor::from_u8(COMPANION_PILL_VERTICAL_ANCHOR.load(Ordering::SeqCst))
}

fn set_companion_pill_vertical_anchor(anchor: CompanionVerticalAnchor) {
    COMPANION_PILL_VERTICAL_ANCHOR.store(anchor as u8, Ordering::SeqCst);
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherPeekResponsePayload {
    pub response: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndOfDayReviewActionPayload {
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionVisibilityActionPayload {
    pub action: String,
}

pub fn setup_watcher_window(app: &tauri::App) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(
        app,
        WATCHER_PEEK_WINDOW_LABEL,
        WebviewUrl::App("auxiliary.html?driftySurface=watcher".into()),
    )
    .title("")
    .inner_size(WATCHER_PEEK_WIDTH, WATCHER_PEEK_HEIGHT)
    .min_inner_size(WATCHER_PEEK_WIDTH, WATCHER_PEEK_HEIGHT)
    .max_inner_size(WATCHER_PEEK_WIDTH, WATCHER_PEEK_HEIGHT)
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
    .visible(false)
    .build()?;

    let _ = window.set_ignore_cursor_events(true);
    Ok(())
}

pub fn setup_companion_pill_window(app: &tauri::App) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(
        app,
        COMPANION_PILL_WINDOW_LABEL,
        WebviewUrl::App("auxiliary.html?driftySurface=companion".into()),
    )
    .title("")
    .inner_size(COMPANION_PILL_CANVAS_WIDTH, COMPANION_PILL_COLLAPSED_HEIGHT)
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
    // The pill is a resident, non-activating panel that is never the active
    // window. Without this, macOS spends the first press of an inactive window
    // on activation alone and never forwards it to the webview, so grabbing the
    // pill from another app did nothing until a second click.
    .accept_first_mouse(true)
    .visible(false)
    .build()?;

    configure_companion_panel(app.handle(), &window)?;
    let _ = window.set_ignore_cursor_events(false);
    Ok(())
}

#[tauri::command]
pub fn watcher_peek_show(app: AppHandle, mut payload: Value) -> Result<(), String> {
    if companion_pill_enabled() {
        annotate_companion_presentation(&mut payload, companion_menu_bar_mode());
        let window = app
            .get_webview_window(COMPANION_PILL_WINDOW_LABEL)
            .ok_or_else(|| "companion pill window is not available".to_string())?;
        if companion_menu_bar_mode() {
            COMPANION_MENU_BAR_VISIBILITY_GENERATION.fetch_add(1, Ordering::SeqCst);
            let current_state = companion_pill_state();
            let current_state = if current_state.is_empty() {
                "collapsed"
            } else {
                &current_state
            };
            if is_companion_moment_payload(&payload) && is_resting_companion_state(current_state) {
                /* Menu-bar mode has no resident capsule. Even if a stale
                AppKit frame still reports visible during the short dismiss
                grace period, remove it before React receives the next event.
                `watcher_companion_set_state` will now take the hidden prepare
                path, and the first visible frame will be the completed card. */
                window.hide().map_err(|error| error.to_string())?;
                window
                    .set_ignore_cursor_events(false)
                    .map_err(|error| error.to_string())?;
                window
                    .emit("watcher-peek-show", payload)
                    .map_err(|error| error.to_string())?;
                return Ok(());
            }
            let is_visible = matches!(window.is_visible(), Ok(true));
            if !is_visible {
                /* A menu-bar Companion has no resident pill. Do not reveal the
                collapsed surface as a staging frame: deliver the event to the
                already-loaded hidden webview, then let
                `watcher_companion_set_state` prepare the final card geometry.
                React calls `watcher_companion_present_prepared` only after that
                final card has committed, so the first visible frame is the
                actual moment rather than a pill that immediately expands. */
                window
                    .set_ignore_cursor_events(false)
                    .map_err(|error| error.to_string())?;
                window
                    .emit("watcher-peek-show", payload)
                    .map_err(|error| error.to_string())?;
                return Ok(());
            }
            let state = companion_pill_state();
            let state = if state.is_empty() {
                "collapsed"
            } else {
                &state
            };
            position_companion_pill_under_menu_bar(&app, &window, state)?;
        }
        window
            .set_ignore_cursor_events(false)
            .map_err(|error| error.to_string())?;
        window
            .emit("watcher-peek-show", payload)
            .map_err(|error| error.to_string())?;
        return show_companion_panel(&app, &window);
    }

    let window = app
        .get_webview_window(WATCHER_PEEK_WINDOW_LABEL)
        .ok_or_else(|| "watcher peek window is not available".to_string())?;
    resize_watcher_window(&app, &payload)?;
    position_watcher_window(&app, &payload)?;
    window
        .set_ignore_cursor_events(should_ignore_cursor_events_for_payload(&payload))
        .map_err(|error| error.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window
        .set_visible_on_all_workspaces(true)
        .map_err(|error| error.to_string())?;
    window
        .emit("watcher-peek-show", payload)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn watcher_peek_hide(app: AppHandle) -> Result<(), String> {
    if companion_pill_enabled() {
        let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
            return Ok(());
        };
        window
            .emit("watcher-companion-clear", ())
            .map_err(|error| error.to_string())?;
        if companion_menu_bar_mode() {
            schedule_menu_bar_companion_hide(app.clone());
            return Ok(());
        }
        window
            .set_ignore_cursor_events(false)
            .map_err(|error| error.to_string())?;
        return show_companion_panel(&app, &window);
    }

    let Some(window) = app.get_webview_window(WATCHER_PEEK_WINDOW_LABEL) else {
        return Ok(());
    };
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn watcher_companion_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    set_companion_surface_policy(
        &app,
        if enabled {
            CompanionSurfacePolicy::Floating
        } else {
            CompanionSurfacePolicy::Off
        },
    )
}

#[tauri::command]
pub fn watcher_companion_set_surface_policy(app: AppHandle, policy: String) -> Result<(), String> {
    set_companion_surface_policy(&app, CompanionSurfacePolicy::parse(&policy)?)
}

fn set_companion_surface_policy(
    app: &AppHandle,
    policy: CompanionSurfacePolicy,
) -> Result<(), String> {
    let previous = CompanionSurfacePolicy::from_u8(
        COMPANION_SURFACE_POLICY.swap(policy as u8, Ordering::SeqCst),
    );
    let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
        return Ok(());
    };

    if policy != CompanionSurfacePolicy::Off {
        if let Some(watcher_window) = app.get_webview_window(WATCHER_PEEK_WINDOW_LABEL) {
            let _ = watcher_window.hide();
        }
    }

    match policy {
        CompanionSurfacePolicy::Floating => {
            if previous != CompanionSurfacePolicy::Floating {
                set_companion_pill_state("collapsed");
                resize_companion_pill_window(&window, "collapsed")?;
                // Place the hidden panel before its first visible frame. Showing it
                // first lets macOS briefly present the Tauri default (screen center),
                // which looks like the resident pill jumps across the desktop.
                position_companion_pill_default(app)?;
            }
            window
                .set_ignore_cursor_events(false)
                .map_err(|error| error.to_string())?;
            // On macOS the companion NSPanel already carries a status-window level
            // and its final collection behavior. Reapplying Tauri's generic window
            // flags here would downgrade the level to a regular floating window and
            // make third-party window managers see it as a Fill/tile candidate.
            #[cfg(not(target_os = "macos"))]
            {
                window
                    .set_always_on_top(true)
                    .map_err(|error| error.to_string())?;
                window
                    .set_visible_on_all_workspaces(true)
                    .map_err(|error| error.to_string())?;
            }
            show_companion_panel(app, &window)?;
            if previous != CompanionSurfacePolicy::Floating {
                // AppKit can still adjust a panel while it is being attached and
                // shown, so keep the delayed correction as a stabilization pass.
                schedule_companion_pill_default_position(app.clone());
            }
            Ok(())
        }
        CompanionSurfacePolicy::MenuBar => {
            if previous != CompanionSurfacePolicy::MenuBar {
                set_companion_pill_state("collapsed");
                resize_companion_pill_window(&window, "collapsed")?;
                position_companion_pill_under_menu_bar(app, &window, "collapsed")?;
            }
            window
                .set_ignore_cursor_events(true)
                .map_err(|error| error.to_string())?;
            window.hide().map_err(|error| error.to_string())
        }
        CompanionSurfacePolicy::Off => {
            window
                .set_ignore_cursor_events(true)
                .map_err(|error| error.to_string())?;
            window.hide().map_err(|error| error.to_string())
        }
    }
}

fn validate_companion_visibility_action(action: &str) -> Result<(), String> {
    match action {
        "hideOneHour" | "turnOff" => Ok(()),
        _ => Err(format!("unknown companion visibility action: {action}")),
    }
}

/// Hide the resident panel immediately, then let the main window persist the
/// user's choice and own the one-hour restore timer. This path deliberately
/// does not reveal the main window: choosing quiet from a context menu should
/// not replace one interruption with a full dashboard.
#[tauri::command]
pub fn watcher_companion_visibility_action(app: AppHandle, action: String) -> Result<(), String> {
    validate_companion_visibility_action(&action)?;
    watcher_companion_set_enabled(app.clone(), false)?;

    if let Some(main) = app.get_webview_window("main") {
        main.emit(
            "companion-visibility-action",
            CompanionVisibilityActionPayload { action },
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn watcher_companion_set_state(
    app: AppHandle,
    state: String,
    animated: Option<bool>,
) -> Result<CompanionSetStateResult, String> {
    if !companion_pill_enabled() {
        return Ok(CompanionSetStateResult {
            prepared: false,
            menu_anchor_x: None,
        });
    }
    validate_companion_pill_state(&state)?;
    /* Capture the layout the panel is leaving before recording the new state,
    so the resize can hold the capsule's chosen anchor across the change. */
    let previous_state = companion_pill_state();
    let previous_layout_state = if previous_state.is_empty() {
        "collapsed"
    } else {
        &previous_state
    };
    if is_resting_companion_state(previous_layout_state) && !is_resting_companion_state(&state) {
        if companion_menu_bar_mode() {
            set_companion_pill_horizontal_anchor(CompanionHorizontalAnchor::Right);
            set_companion_pill_vertical_anchor(CompanionVerticalAnchor::Top);
        } else if let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) {
            if let Ok(horizontal) = resolve_companion_pill_horizontal_anchor(
                &app,
                &window,
                previous_layout_state,
                &state,
            ) {
                set_companion_pill_horizontal_anchor(horizontal);
            }
            if let Ok(vertical) =
                resolve_companion_pill_vertical_anchor(&app, &window, previous_layout_state, &state)
            {
                set_companion_pill_vertical_anchor(vertical);
            }
        }
    }
    set_companion_pill_state(&state);
    if let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) {
        if companion_menu_bar_mode() && is_resting_companion_state(&state) {
            /* The menu-bar indicator is the resident surface. Once the card's
            React exit fade has completed, remove the panel instead of visibly
            shrinking it into a floating resident pill that does not exist in
            this policy. Reset its resting geometry only while hidden. */
            window.hide().map_err(|error| error.to_string())?;
            resize_companion_pill_window(&window, &state)?;
            position_companion_pill_under_menu_bar(&app, &window, &state)?;
            window
                .set_ignore_cursor_events(true)
                .map_err(|error| error.to_string())?;
            return Ok(CompanionSetStateResult {
                prepared: false,
                menu_anchor_x: None,
            });
        }
        window
            .set_ignore_cursor_events(false)
            .map_err(|error| error.to_string())?;
        /* A menu-bar card always enters from the status item, including when it
        preempts or follows a differently sized card. Letting AppKit resize the
        visible milestone frame directly into EOD/drift/nudge pins the previous
        card's right edge and produces a short sideways slide. Hide that old
        frame, prepare the new geometry at the shared tray center, then let the
        React/native handshake reveal it from the origin. */
        let prepare_hidden_menu_bar_card =
            should_prepare_direct_menu_bar_card(companion_menu_bar_mode(), &state);
        if prepare_hidden_menu_bar_card {
            if matches!(window.is_visible(), Ok(true)) {
                window.hide().map_err(|error| error.to_string())?;
            }
            /* This path intentionally has no native resize animation. The panel
            is still hidden, so resize and anchor it at the destination before
            React exposes the completed card. */
            resize_companion_pill_window(&window, &state)?;
            let menu_anchor_x = position_companion_pill_under_menu_bar(&app, &window, &state)?;
            return Ok(CompanionSetStateResult {
                prepared: true,
                menu_anchor_x: Some(menu_anchor_x),
            });
        }
    }
    resize_companion_pill_window_anchored(
        &app,
        &state,
        animated.unwrap_or(true),
        if previous_state.is_empty() {
            "collapsed"
        } else {
            &previous_state
        },
    )?;
    Ok(CompanionSetStateResult {
        prepared: false,
        menu_anchor_x: None,
    })
}

/// Reveal a menu-bar moment that the hidden companion webview has fully
/// prepared. Keeping this separate from `watcher_peek_show` is the presentation
/// handshake: native geometry first, committed React card second, visibility
/// last.
#[tauri::command]
pub fn watcher_companion_present_prepared(app: AppHandle) -> Result<(), String> {
    if !companion_menu_bar_mode() {
        return Ok(());
    }
    let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
        return Ok(());
    };
    let state = companion_pill_state();
    if is_resting_companion_state(if state.is_empty() {
        "collapsed"
    } else {
        &state
    }) {
        return Ok(());
    }
    position_companion_pill_under_menu_bar(&app, &window, &state)?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    show_companion_panel(&app, &window)
}

/// Keep the fixed transparent canvas around the capsule from stealing clicks.
///
/// A native window is rectangular, so the padding added around the capsule would
/// otherwise swallow presses aimed at whatever sits behind it.
///
/// This is driven natively rather than from the webview: turning the mouse off
/// also silences the panel's tracking area, so the page would never hear that
/// the cursor came back. The cursor position is checked against the capsule's
/// own rect instead, which stays correct either way.
#[tauri::command]
pub fn watcher_companion_set_click_through(app: AppHandle, ignore: bool) -> Result<(), String> {
    if !companion_pill_enabled() {
        return Ok(());
    }
    let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
        return Ok(());
    };
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|error| error.to_string())
}

/// True when the cursor is over the visible capsule rather than the fixed
/// transparent canvas around it. The webview polls this in every state so
/// interaction can be handed back the moment the pointer reaches the capsule.
#[tauri::command]
pub fn watcher_companion_cursor_over_capsule(app: AppHandle) -> bool {
    if !companion_pill_enabled() {
        return false;
    }
    let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
        return false;
    };
    let (Ok(cursor), Ok(position), Ok(size), Ok(scale)) = (
        app.cursor_position(),
        window.outer_position(),
        window.outer_size(),
        window.scale_factor(),
    ) else {
        return false;
    };

    let state = companion_pill_state();
    let state = if state.is_empty() {
        "collapsed"
    } else {
        &state
    };
    let (gutter_x, gutter_y) = companion_pill_gutter(state);
    let Ok((capsule_width, _)) = companion_pill_capsule_size(state) else {
        return false;
    };
    let Ok(left_inset) = companion_pill_left_inset(state, gutter_x) else {
        return false;
    };
    let left_inset = left_inset * scale;
    let gutter_y = gutter_y * scale;
    let left = position.x as f64 + left_inset;
    let top = position.y as f64 + gutter_y;
    let right = left + capsule_width * scale;
    let bottom = position.y as f64 + size.height as f64 - gutter_y;

    cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom
}

#[tauri::command]
pub fn watcher_companion_update(app: AppHandle, payload: Value) -> Result<(), String> {
    if !companion_pill_enabled() {
        return Ok(());
    }
    let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
        return Ok(());
    };

    window
        .emit("watcher-companion-snapshot", payload)
        .map_err(|error| error.to_string())?;
    if companion_menu_bar_mode() {
        return Ok(());
    }
    show_companion_panel(&app, &window)
}

#[tauri::command]
pub fn watcher_companion_dismiss_moment(app: AppHandle, kind: String) -> Result<(), String> {
    watcher_peek_hide(app.clone())?;

    if kind == "driftAlarm" {
        if let Some(main) = app.get_webview_window("main") {
            main.emit("drift-alarm-dismissed", ())
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn watcher_peek_dismiss(app: AppHandle) -> Result<(), String> {
    watcher_peek_hide(app.clone())?;

    if let Some(main) = app.get_webview_window("main") {
        main.emit("watcher-peek-dismissed", ())
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn reveal_main_window_for_review_action(app: &AppHandle) {
    crate::reveal_main_window(app);
}

#[tauri::command]
pub fn watcher_peek_set_interactive(app: AppHandle, interactive: bool) -> Result<(), String> {
    let window_label = watcher_surface_window_label(companion_pill_enabled());
    let Some(window) = app.get_webview_window(window_label) else {
        return Ok(());
    };

    window
        .set_ignore_cursor_events(!interactive)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn watcher_peek_cursor_inside(app: AppHandle) -> bool {
    let window_label = watcher_surface_window_label(companion_pill_enabled());
    let Some(window) = app.get_webview_window(window_label) else {
        return false;
    };

    matches!(window.is_visible(), Ok(true))
        && matches!(
            (
                app.cursor_position(),
                window.outer_position(),
                window.outer_size(),
            ),
            (Ok(cursor), Ok(position), Ok(size)) if is_cursor_inside_watcher_rect(cursor, (position, size))
        )
}

#[tauri::command]
pub fn watcher_peek_respond(app: AppHandle, response: String) -> Result<(), String> {
    watcher_peek_hide(app.clone())?;

    if let Some(main) = app.get_webview_window("main") {
        main.emit(
            "watcher-peek-response",
            WatcherPeekResponsePayload { response },
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn watcher_peek_end_of_day_review_action(
    app: AppHandle,
    action: String,
    activity_at: Option<String>,
) -> Result<(), String> {
    reveal_main_window_for_review_action(&app);
    let _ = watcher_peek_hide(app.clone());

    if let Some(main) = app.get_webview_window("main") {
        main.emit(
            "end-of-day-review-action",
            EndOfDayReviewActionPayload {
                action,
                activity_at,
            },
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

/// The pill/watcher surface confirmed the review actually rendered while
/// visible; the main window marks the day as shown from this signal rather
/// than from the fire-and-forget show invoke, so an unseen presentation
/// (lid closed, machine asleep) never burns the once-a-day slot.
#[tauri::command]
pub fn watcher_peek_end_of_day_review_displayed(app: AppHandle, day: String) -> Result<(), String> {
    let valid_day = day.len() == 10
        && day
            .chars()
            .enumerate()
            .all(|(index, ch)| if index == 4 || index == 7 { ch == '-' } else { ch.is_ascii_digit() });
    if !valid_day {
        return Err(format!("invalid day format: {day}"));
    }
    if let Some(main) = app.get_webview_window("main") {
        main.emit("end-of-day-review-displayed", serde_json::json!({ "day": day }))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn position_watcher_window(app: &AppHandle, payload: &Value) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WATCHER_PEEK_WINDOW_LABEL) else {
        return Ok(());
    };
    let Some(monitor) = resolve_watcher_monitor(app) else {
        return Ok(());
    };

    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    let watcher_position = if is_milestone_payload(payload) || is_reentry_payload(payload) {
        calculate_standalone_milestone_window_position(position.x, position.y, size.width)
    } else if is_end_of_day_review_payload(payload) {
        calculate_end_of_day_review_window_position(position.x, position.y, size.width, size.height)
    } else if is_extreme_nudge_toast_payload(payload) {
        calculate_extreme_nudge_toast_window_position(position.x, position.y, size.width)
    } else {
        calculate_watcher_window_position(position.x, position.y, size.width, size.height)
    };

    window
        .set_position(watcher_position)
        .map_err(|error| error.to_string())
}

fn resize_watcher_window(app: &AppHandle, payload: &Value) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WATCHER_PEEK_WINDOW_LABEL) else {
        return Ok(());
    };
    let (width, height) = watcher_window_dimensions_for_payload(payload);
    let target_size = LogicalSize::new(width, height);

    window
        .set_min_size(None::<LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(None::<LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_size(target_size)
        .map_err(|error| error.to_string())?;
    window
        .set_min_size(Some(target_size))
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(Some(target_size))
        .map_err(|error| error.to_string())
}

fn companion_pill_enabled() -> bool {
    companion_surface_policy() != CompanionSurfacePolicy::Off
}

fn companion_menu_bar_mode() -> bool {
    companion_surface_policy() == CompanionSurfacePolicy::MenuBar
}

fn companion_surface_policy() -> CompanionSurfacePolicy {
    CompanionSurfacePolicy::from_u8(COMPANION_SURFACE_POLICY.load(Ordering::SeqCst))
}

fn watcher_surface_window_label(use_companion: bool) -> &'static str {
    if use_companion {
        COMPANION_PILL_WINDOW_LABEL
    } else {
        WATCHER_PEEK_WINDOW_LABEL
    }
}

fn validate_companion_pill_state(state: &str) -> Result<(), String> {
    match state {
        "collapsed" | "peek" | "milestone" | "reentry" | "drift" | "nudge" | "eod"
        | "eodCompact" | "eodMinimal" => Ok(()),
        _ => Err(format!("unknown companion pill state: {state}")),
    }
}

fn is_resting_companion_state(state: &str) -> bool {
    state == "collapsed" || state == "peek"
}

fn should_prepare_direct_menu_bar_card(menu_bar_mode: bool, state: &str) -> bool {
    menu_bar_mode && !is_resting_companion_state(state)
}

fn annotate_companion_presentation(payload: &mut Value, menu_bar_mode: bool) {
    let Some(object) = payload.as_object_mut() else {
        return;
    };
    object.insert(
        "__companionPresentation".to_string(),
        Value::String(if menu_bar_mode { "menuBar" } else { "floating" }.to_string()),
    );
}

fn resolve_companion_pill_horizontal_anchor(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    current_state: &str,
    target_state: &str,
) -> Result<CompanionHorizontalAnchor, String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| resolve_watcher_monitor(app))
        .ok_or_else(|| "companion pill monitor is unavailable".to_string())?;
    let scale = monitor.scale_factor();
    let screen_position = monitor.position().to_logical::<f64>(scale);
    let screen_size = monitor.size().to_logical::<f64>(scale);
    let outer = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let (gutter_x, _) = companion_pill_gutter(current_state);
    let (capsule_width, _) = companion_pill_capsule_size(current_state)?;
    let (target_capsule_width, _) = companion_pill_capsule_size(target_state)?;
    Ok(resolve_companion_horizontal_anchor(
        outer.x + companion_pill_left_inset(current_state, gutter_x)?,
        capsule_width,
        target_capsule_width,
        CompanionFrame {
            x: screen_position.x,
            y: screen_position.y,
            width: screen_size.width,
            height: screen_size.height,
        },
    ))
}

fn resolve_companion_pill_vertical_anchor(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    current_state: &str,
    target_state: &str,
) -> Result<CompanionVerticalAnchor, String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| resolve_watcher_monitor(app))
        .ok_or_else(|| "companion pill monitor is unavailable".to_string())?;
    let scale = monitor.scale_factor();
    let screen_position = monitor.position().to_logical::<f64>(scale);
    let screen_size = monitor.size().to_logical::<f64>(scale);
    let work_position = monitor.work_area().position.to_logical::<f64>(scale);
    let outer = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let (_, gutter_y) = companion_pill_gutter(current_state);
    let (_, capsule_height) = companion_pill_capsule_size(current_state)?;
    let (_, target_capsule_height) = companion_pill_capsule_size(target_state)?;
    let capsule_top = outer.y + gutter_y;
    let center_y = capsule_top + capsule_height / 2.0;
    let centered_top = center_y - target_capsule_height / 2.0;
    let centered_bottom = center_y + target_capsule_height / 2.0;
    if centered_top < work_position.y {
        Ok(CompanionVerticalAnchor::Top)
    } else if centered_bottom > screen_position.y + screen_size.height {
        Ok(CompanionVerticalAnchor::Bottom)
    } else {
        Ok(CompanionVerticalAnchor::Center)
    }
}

/// The capsule's own drawn size, before any transparent gutter.
pub(super) fn companion_pill_capsule_size(state: &str) -> Result<(f64, f64), String> {
    validate_companion_pill_state(state)?;
    Ok(match state {
        "collapsed" => (
            COMPANION_PILL_COLLAPSED_WIDTH,
            COMPANION_PILL_COLLAPSED_HEIGHT,
        ),
        "peek" => (COMPANION_PILL_PEEK_WIDTH, COMPANION_PILL_PEEK_HEIGHT),
        "milestone" => (
            COMPANION_PILL_MILESTONE_WIDTH + COMPANION_PILL_MILESTONE_STAT_WIDTH,
            COMPANION_PILL_MILESTONE_HEIGHT,
        ),
        "reentry" => (COMPANION_PILL_REENTRY_WIDTH, COMPANION_PILL_REENTRY_HEIGHT),
        "drift" | "nudge" => (COMPANION_PILL_MOMENT_WIDTH, COMPANION_PILL_MOMENT_HEIGHT),
        "eod" => (COMPANION_PILL_REVIEW_WIDTH, COMPANION_PILL_REVIEW_HEIGHT),
        "eodCompact" => (
            COMPANION_PILL_COMPACT_REVIEW_WIDTH,
            COMPANION_PILL_COMPACT_REVIEW_HEIGHT,
        ),
        "eodMinimal" => (
            COMPANION_PILL_MINIMAL_REVIEW_WIDTH,
            COMPANION_PILL_MINIMAL_REVIEW_HEIGHT,
        ),
        _ => unreachable!("state was validated above"),
    })
}

/// How much transparent room the window keeps around the capsule. Constant
/// across states so the CSS inset never disagrees with the animating frame.
pub(super) fn companion_pill_gutter(_state: &str) -> (f64, f64) {
    (COMPANION_PILL_GUTTER_X, COMPANION_PILL_GUTTER_Y)
}

pub(super) fn companion_pill_left_inset(state: &str, right_gutter: f64) -> Result<f64, String> {
    let (capsule_width, _) = companion_pill_capsule_size(state)?;
    Ok(COMPANION_PILL_CANVAS_WIDTH + right_gutter - capsule_width)
}

/// The native window size: a fixed widest horizontal canvas plus state-specific
/// height. CSS changes only the right-pinned capsule width.
fn companion_pill_dimensions(state: &str) -> Result<(f64, f64), String> {
    let (_, height) = companion_pill_capsule_size(state)?;
    let (gutter_x, gutter_y) = companion_pill_gutter(state);
    Ok((
        COMPANION_PILL_CANVAS_WIDTH + gutter_x * 2.0,
        height + gutter_y * 2.0,
    ))
}

fn resize_companion_pill_window(window: &tauri::WebviewWindow, state: &str) -> Result<(), String> {
    let (width, height) = companion_pill_dimensions(state)?;
    let target_size = LogicalSize::new(width, height);
    window
        .set_min_size(None::<LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(None::<LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_size(target_size)
        .map_err(|error| error.to_string())
}

fn resize_companion_pill_window_anchored(
    app: &AppHandle,
    state: &str,
    animated: bool,
    previous_state: &str,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
        return Ok(());
    };
    let (target_width, target_height) = companion_pill_dimensions(state)?;

    #[cfg(target_os = "macos")]
    {
        let (old_gutter_x, old_gutter_y) = companion_pill_gutter(previous_state);
        let (new_gutter_x, new_gutter_y) = companion_pill_gutter(state);
        return resize_companion_panel(
            app,
            &window,
            target_width,
            target_height,
            state.to_string(),
            animated,
            super::companion_panel::CompanionPanelAnchor {
                old_gutter_x: companion_pill_left_inset(previous_state, old_gutter_x)?,
                old_gutter_y,
                new_gutter_x: companion_pill_left_inset(state, new_gutter_x)?,
                new_gutter_y,
                horizontal: Some(companion_pill_horizontal_anchor()),
                vertical: Some(companion_pill_vertical_anchor()),
            },
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        let Some(monitor) = window
            .current_monitor()
            .map_err(|error| error.to_string())?
            .or_else(|| resolve_watcher_monitor(app))
        else {
            return resize_companion_pill_window(&window, state);
        };

        let scale_factor = monitor.scale_factor();
        let work_area = monitor.work_area();
        let work_position = work_area.position.to_logical::<f64>(scale_factor);
        let work_size = work_area.size.to_logical::<f64>(scale_factor);
        let old_position = window
            .outer_position()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale_factor);
        let work_right = work_position.x + work_size.width;
        let work_bottom = work_position.y + work_size.height;
        let (old_gutter_x, _) = companion_pill_gutter(previous_state);
        let (new_gutter_x, _) = companion_pill_gutter(state);
        let old_left_inset = companion_pill_left_inset(previous_state, old_gutter_x)?;
        let new_left_inset = companion_pill_left_inset(state, new_gutter_x)?;
        let old_capsule_x = old_position.x + old_left_inset;
        let (old_capsule_width, _) = companion_pill_capsule_size(previous_state)?;
        let (new_capsule_width, _) = companion_pill_capsule_size(state)?;
        let target_capsule_x = match companion_pill_horizontal_anchor() {
            CompanionHorizontalAnchor::Left => old_capsule_x,
            CompanionHorizontalAnchor::Center => {
                old_capsule_x + (old_capsule_width - new_capsule_width) / 2.0
            }
            CompanionHorizontalAnchor::Right => {
                old_capsule_x + old_capsule_width - new_capsule_width
            }
        };
        let target_x = target_capsule_x - new_left_inset;
        let (_, old_gutter_y) = companion_pill_gutter(previous_state);
        let (_, new_gutter_y) = companion_pill_gutter(state);
        let (_, old_capsule_height) = companion_pill_capsule_size(previous_state)?;
        let (_, new_capsule_height) = companion_pill_capsule_size(state)?;
        let old_capsule_y = old_position.y + old_gutter_y;
        let target_capsule_y = match companion_pill_vertical_anchor() {
            CompanionVerticalAnchor::Top => old_capsule_y,
            CompanionVerticalAnchor::Center => {
                old_capsule_y + (old_capsule_height - new_capsule_height) / 2.0
            }
            CompanionVerticalAnchor::Bottom => {
                old_capsule_y + old_capsule_height - new_capsule_height
            }
        };
        let target_y = target_capsule_y - new_gutter_y;
        let clamped_x = target_x.clamp(
            work_position.x,
            (work_right - target_width).max(work_position.x),
        );
        let clamped_y = target_y.clamp(
            work_position.y,
            (work_bottom - target_height).max(work_position.y),
        );
        resize_companion_pill_window(&window, state)?;
        window
            .set_position(LogicalPosition::new(clamped_x.round(), clamped_y.round()))
            .map_err(|error| error.to_string())
    }
}

fn position_companion_pill_default(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
        return Ok(());
    };
    let Some(monitor) = resolve_watcher_monitor(app) else {
        return Ok(());
    };
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);
    let target = calculate_companion_pill_default_position(position.x, position.y, size.width);
    reset_companion_panel_vertical_center();
    window
        .set_position(target)
        .map_err(|error| error.to_string())
}

fn position_companion_pill_under_menu_bar(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    state: &str,
) -> Result<f64, String> {
    let Some(rect) = crate::tray::tray_icon_rect(app) else {
        position_companion_pill_default(app)?;
        return Ok(companion_pill_capsule_size(state)?.0 / 2.0);
    };
    let primary_scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
    let rough_position = match rect.position {
        tauri::Position::Logical(position) => position,
        tauri::Position::Physical(position) => position.to_logical::<f64>(primary_scale),
    };
    let rough_size = match rect.size {
        tauri::Size::Logical(size) => size,
        tauri::Size::Physical(size) => size.to_logical::<f64>(primary_scale),
    };
    let monitor = app
        .monitor_from_point(
            rough_position.x + rough_size.width / 2.0,
            rough_position.y + rough_size.height / 2.0,
        )
        .ok()
        .flatten()
        .or_else(|| resolve_watcher_monitor(app));
    let Some(monitor) = monitor else {
        position_companion_pill_default(app)?;
        return Ok(companion_pill_capsule_size(state)?.0 / 2.0);
    };
    let scale = monitor.scale_factor();
    let tray_position = match rect.position {
        tauri::Position::Logical(position) => position,
        tauri::Position::Physical(position) => position.to_logical::<f64>(scale),
    };
    let tray_size = match rect.size {
        tauri::Size::Logical(size) => size,
        tauri::Size::Physical(size) => size.to_logical::<f64>(scale),
    };
    let work_area = monitor.work_area();
    let work_position = work_area.position.to_logical::<f64>(scale);
    let work_size = work_area.size.to_logical::<f64>(scale);
    let (capsule_width, _) = companion_pill_capsule_size(state)?;
    let (gutter_x, gutter_y) = companion_pill_gutter(state);
    let left_inset = companion_pill_left_inset(state, gutter_x)?;
    let target = calculate_menu_bar_companion_position(
        tray_position.x,
        tray_position.y,
        tray_size.width,
        tray_size.height,
        work_position.x,
        work_position.y,
        work_size.width,
        capsule_width,
        left_inset,
        gutter_y,
    );
    set_companion_pill_horizontal_anchor(CompanionHorizontalAnchor::Right);
    set_companion_pill_vertical_anchor(CompanionVerticalAnchor::Top);
    reset_companion_panel_vertical_center();
    window
        .set_position(target.window_position)
        .map_err(|error| error.to_string())?;
    Ok(target.anchor_x)
}

#[allow(clippy::too_many_arguments)]
fn calculate_menu_bar_companion_position(
    tray_x: f64,
    tray_y: f64,
    tray_width: f64,
    tray_height: f64,
    work_area_x: f64,
    work_area_y: f64,
    work_area_width: f64,
    capsule_width: f64,
    left_inset: f64,
    gutter_y: f64,
) -> MenuBarCompanionPlacement {
    let work_right = work_area_x + work_area_width;
    let tray_center = tray_x + tray_width / 2.0;
    /* Reserve the side margin before clamping. A card that cannot be centered
    under its status item should stop short of the edge rather than sit on it,
    but a display too narrow to hold the card plus both margins must still
    place the card, so the bounds collapse toward the work area instead of
    inverting. */
    let min_capsule_left = work_area_x + COMPANION_MENU_BAR_GAP_X;
    let max_capsule_left = (work_right - capsule_width - COMPANION_MENU_BAR_GAP_X).max(work_area_x);
    let capsule_left = (tray_center - capsule_width / 2.0)
        .clamp(min_capsule_left.min(max_capsule_left), max_capsule_left);
    /* Keep the pointer inside the capsule's rounded corners. Once a card is
    clamped, the status item can sit beyond the card — even off-screen on a
    crowded menu bar — so the anchor has to stay a painterly inset rather than
    tracking the raw tray center. */
    let anchor_inset = COMPANION_MENU_BAR_POINTER_INSET.min(capsule_width / 2.0);
    let anchor_x = (tray_center - capsule_left).clamp(
        anchor_inset,
        (capsule_width - anchor_inset).max(anchor_inset),
    );
    let capsule_top = (tray_y + tray_height + COMPANION_MENU_BAR_GAP_Y)
        .max(work_area_y + COMPANION_MENU_BAR_GAP_Y);
    MenuBarCompanionPlacement {
        window_position: LogicalPosition::new(
            (capsule_left - left_inset).round(),
            (capsule_top - gutter_y).round(),
        ),
        anchor_x,
    }
}

fn schedule_menu_bar_companion_hide(app: AppHandle) {
    let generation = COMPANION_MENU_BAR_VISIBILITY_GENERATION.load(Ordering::SeqCst);
    std::thread::spawn(move || {
        std::thread::sleep(COMPANION_MENU_BAR_HIDE_DELAY);
        let dispatcher = app.clone();
        let _ = dispatcher.run_on_main_thread(move || {
            if COMPANION_MENU_BAR_VISIBILITY_GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            if !companion_menu_bar_mode() || !is_resting_companion_state(&companion_pill_state()) {
                return;
            }
            if let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) {
                let _ = window.set_ignore_cursor_events(true);
                let _ = window.hide();
            }
        });
    });
}

fn calculate_companion_pill_default_position(
    work_area_x: f64,
    work_area_y: f64,
    work_area_width: f64,
) -> LogicalPosition<f64> {
    /* The fixed canvas is wider than the collapsed capsule. Pull the frame left
    so the canvas' right inset, and therefore the visible capsule edge, lands
    exactly on the display boundary. */
    LogicalPosition::new(
        (work_area_x + work_area_width - COMPANION_PILL_CANVAS_WIDTH - COMPANION_PILL_GUTTER_X)
            .round(),
        (work_area_y + COMPANION_PILL_TOP_MARGIN - COMPANION_PILL_GUTTER_Y).round(),
    )
}

/// The resident pill can use the display's side and bottom bands, while its top
/// edge remains below the macOS menu bar. Side and bottom edges only keep a
/// recoverable grab target visible.
#[cfg(any(not(target_os = "macos"), test))]
fn calculate_companion_capsule_drag_bounds(
    screen_x: f64,
    screen_y: f64,
    screen_width: f64,
    screen_height: f64,
    work_area_y: f64,
    capsule_width: f64,
    capsule_height: f64,
) -> (f64, f64, f64, f64) {
    let reachable_x = COMPANION_PILL_MIN_REACHABLE_X.min(capsule_width);
    let reachable_y = COMPANION_PILL_MIN_REACHABLE_Y.min(capsule_height);
    let max_y = screen_y + screen_height - reachable_y;
    (
        screen_x - (capsule_width - reachable_x),
        work_area_y.max(screen_y).min(max_y),
        screen_x + screen_width - reachable_x,
        max_y,
    )
}

/// Compatibility endpoint for older companion webviews. Current macOS builds
/// track AppKit drag events natively and constrain the visible capsule on every
/// pointer sample.
#[tauri::command]
pub async fn watcher_companion_clamp_to_screen(
    app: AppHandle,
    start_client_x: Option<f64>,
    start_client_y: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
            return Ok(());
        };
        if let (Some(start_x), Some(start_y)) = (start_client_x, start_client_y) {
            perform_companion_panel_drag(&app, &window, start_x, start_y)?;
        }
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (start_client_x, start_client_y);
        return clamp_companion_to_screen_now(&app);
    }
}

#[cfg(not(target_os = "macos"))]
fn clamp_companion_to_screen_now(app: &AppHandle) -> Result<(), String> {
    if !companion_pill_enabled() {
        return Ok(());
    }
    let Some(window) = app.get_webview_window(COMPANION_PILL_WINDOW_LABEL) else {
        return Ok(());
    };
    let Some(monitor) = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| resolve_watcher_monitor(app))
    else {
        return Ok(());
    };

    let scale = monitor.scale_factor();
    let screen_position = monitor.position().to_logical::<f64>(scale);
    let screen_size = monitor.size().to_logical::<f64>(scale);
    let work_area_position = monitor.work_area().position.to_logical::<f64>(scale);
    let outer = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);

    let state = companion_pill_state();
    let (gutter_x, gutter_y) = companion_pill_gutter(&state);
    let (capsule_width, capsule_height) = companion_pill_capsule_size(if state.is_empty() {
        "collapsed"
    } else {
        &state
    })?;

    // Where the capsule currently sits, in screen coordinates.
    let capsule_x = outer.x
        + companion_pill_left_inset(
            if state.is_empty() {
                "collapsed"
            } else {
                &state
            },
            gutter_x,
        )?;
    let capsule_y = outer.y + gutter_y;

    /* Keep the pill reachable without dictating where it may live.

    Requiring the whole capsule to stay inside the work area with a margin
    meant it could never be parked in the menu-bar or Dock bands or tucked
    against an edge. A floating panel only has to stay grabbable, so enough
    of it to grab is what is enforced, and it may otherwise use the entire
    display or hang off its side and bottom edges. */
    let (min_x, min_y, max_x, max_y) = calculate_companion_capsule_drag_bounds(
        screen_position.x,
        screen_position.y,
        screen_size.width,
        screen_size.height,
        work_area_position.y,
        capsule_width,
        capsule_height,
    );
    let clamped_x = capsule_x.clamp(min_x.min(max_x), max_x.max(min_x));
    let clamped_y = capsule_y.clamp(min_y.min(max_y), max_y.max(min_y));
    let screen_right = screen_position.x + screen_size.width;
    let horizontal = if clamped_x <= screen_position.x + COMPANION_PILL_EDGE_ANCHOR_THRESHOLD {
        CompanionHorizontalAnchor::Left
    } else if clamped_x + capsule_width >= screen_right - COMPANION_PILL_EDGE_ANCHOR_THRESHOLD {
        CompanionHorizontalAnchor::Right
    } else {
        CompanionHorizontalAnchor::Center
    };
    set_companion_pill_horizontal_anchor(horizontal);

    if (clamped_x - capsule_x).abs() < 0.5 && (clamped_y - capsule_y).abs() < 0.5 {
        return Ok(());
    }

    move_companion_panel_by(app, &window, clamped_x - capsule_x, clamped_y - capsule_y)
}

fn schedule_companion_pill_default_position(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(80));
        let dispatcher = app.clone();
        let target = app;
        let _ = dispatcher.run_on_main_thread(move || {
            let _ = position_companion_pill_default(&target);
        });
    });
}

fn watcher_window_dimensions_for_payload(payload: &Value) -> (f64, f64) {
    if is_milestone_payload(payload) {
        (
            STANDALONE_MILESTONE_WINDOW_WIDTH,
            STANDALONE_MILESTONE_WINDOW_HEIGHT,
        )
    } else if is_reentry_payload(payload) {
        (
            COMPANION_PILL_REENTRY_WIDTH + COMPANION_PILL_GUTTER_X * 2.0,
            COMPANION_PILL_REENTRY_HEIGHT + COMPANION_PILL_GUTTER_Y * 2.0,
        )
    } else if is_end_of_day_review_payload(payload) {
        (END_OF_DAY_REVIEW_WIDTH, END_OF_DAY_REVIEW_HEIGHT)
    } else if is_extreme_nudge_toast_payload(payload) {
        extreme_nudge_toast_window_dimensions()
    } else {
        (WATCHER_PEEK_WIDTH, WATCHER_PEEK_HEIGHT)
    }
}

fn should_ignore_cursor_events_for_payload(payload: &Value) -> bool {
    !(is_milestone_payload(payload)
        || is_reentry_payload(payload)
        || is_end_of_day_review_payload(payload)
        || is_extreme_nudge_toast_payload(payload))
}

fn is_cursor_inside_watcher_rect(cursor: Point<f64>, rect: (Point<i32>, Size<u32>)) -> bool {
    let (rect_position, rect_size) = rect;
    let (left, top) = (f64::from(rect_position.x), f64::from(rect_position.y));
    (left..=left + f64::from(rect_size.width)).contains(&cursor.x)
        && (top..=top + f64::from(rect_size.height)).contains(&cursor.y)
}

fn calculate_watcher_window_position(
    work_area_x: f64,
    work_area_y: f64,
    work_area_width: f64,
    work_area_height: f64,
) -> LogicalPosition<f64> {
    LogicalPosition::new(
        work_area_x + ((work_area_width - WATCHER_PEEK_WIDTH) / 2.0).round(),
        work_area_y + work_area_height - WATCHER_PEEK_HEIGHT - WATCHER_PEEK_WORK_AREA_MARGIN,
    )
}

fn calculate_standalone_milestone_window_position(
    work_area_x: f64,
    work_area_y: f64,
    work_area_width: f64,
) -> LogicalPosition<f64> {
    LogicalPosition::new(
        work_area_x + work_area_width - STANDALONE_MILESTONE_WINDOW_WIDTH + COMPANION_PILL_GUTTER_X,
        work_area_y + COMPANION_PILL_TOP_MARGIN - COMPANION_PILL_GUTTER_Y,
    )
}

fn calculate_end_of_day_review_window_position(
    work_area_x: f64,
    work_area_y: f64,
    work_area_width: f64,
    work_area_height: f64,
) -> LogicalPosition<f64> {
    let available_x = (work_area_width - END_OF_DAY_REVIEW_WIDTH).max(0.0);
    let available_y = (work_area_height - END_OF_DAY_REVIEW_HEIGHT).max(0.0);
    let x_margin = WATCHER_PEEK_WORK_AREA_MARGIN.min(available_x);
    let y_margin = WATCHER_PEEK_WORK_AREA_MARGIN.min(available_y);

    LogicalPosition::new(work_area_x + available_x - x_margin, work_area_y + y_margin)
}

fn is_end_of_day_review_payload(payload: &Value) -> bool {
    matches!(
        payload.get("kind").and_then(Value::as_str),
        Some("endOfDayReview")
    )
}

fn is_milestone_payload(payload: &Value) -> bool {
    matches!(
        payload.get("kind").and_then(Value::as_str),
        Some("milestone")
    )
}

fn is_reentry_payload(payload: &Value) -> bool {
    matches!(payload.get("kind").and_then(Value::as_str), Some("reentry"))
}

fn is_companion_moment_payload(payload: &Value) -> bool {
    payload.get("kind").and_then(Value::as_str).is_some()
}

fn resolve_watcher_monitor(app: &AppHandle) -> Option<Monitor> {
    if let Ok(cursor) = app.cursor_position() {
        let primary_scale_factor = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|monitor| monitor.scale_factor())
            .unwrap_or(1.0);
        let cursor = cursor.to_logical::<f64>(primary_scale_factor);

        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            return Some(monitor);
        }
    }

    if let Some(main) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.current_monitor() {
            return Some(monitor);
        }
    }

    app.primary_monitor().ok().flatten()
}

#[cfg(test)]
mod watcher_tests;
