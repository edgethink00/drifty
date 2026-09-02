//! Resident-seat AX control veto.
//!
//! Keep the resident anchor. If that footprint overlaps an AX control, slide
//! only on the same Y. Every unchanged result carries a reason so callers can
//! distinguish a genuinely clear seat from unavailable or incomplete AX data.
//! Standard window controls and generic AX controls are collected through
//! bounded traversal, including controls inside web, document, and scroll
//! containers. Titles, values, and text content are never read.

use serde::Serialize;
use tauri::WebviewWindow;

const CONTROL_NUDGE_STEP: f64 = 24.0;
const CONTROL_NUDGE_MAX: f64 = 240.0;
const CONTROL_SAFETY_INSET: f64 = 12.0;
const CONTROL_MERGE_GAP: f64 = 24.0;
const MAX_AX_VISITED: usize = 400;
const MAX_AX_CONTROLS: usize = 80;
const MAX_SCANNED_PROCESSES: usize = 4;
const MAX_WINDOWS_PER_PROCESS: usize = 4;
const AX_SCAN_BUDGET_MS: u64 = 120;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SeatDecisionReason {
    ControlOverlap,
    NoControlOverlap,
    AnchorClearPending,
    AccessibilityUnavailable,
    WindowListUnavailable,
    NoCandidateWindow,
    ScanTruncated,
    DenseControlStrip,
    NoHorizontalGap,
    PetDisabled,
    PetHidden,
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    UnsupportedPlatform,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatResolution {
    pub x: f64,
    pub y: f64,
    pub moved: bool,
    pub reason: SeatDecisionReason,
}

impl SeatResolution {
    pub(crate) fn unchanged(x: f64, y: f64, reason: SeatDecisionReason) -> Self {
        Self {
            x,
            y,
            moved: false,
            reason,
        }
    }

    fn moved(x: f64, y: f64) -> Self {
        Self {
            x,
            y,
            moved: true,
            reason: SeatDecisionReason::ControlOverlap,
        }
    }

    pub(crate) fn with_visible_origin(mut self, x: f64, y: f64) -> Self {
        self.moved = (self.x - x).abs() >= 1.0 || (self.y - y).abs() >= 1.0;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct SeatRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl SeatRect {
    fn right(self) -> f64 {
        self.x + self.width
    }

    fn bottom(self) -> f64 {
        self.y + self.height
    }

    fn is_valid(self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
            && self.width >= 1.0
            && self.height >= 1.0
    }

    fn inflate(self, amount: f64) -> Self {
        Self {
            x: self.x - amount,
            y: self.y - amount,
            width: self.width + amount * 2.0,
            height: self.height + amount * 2.0,
        }
    }
}

fn intersects(a: SeatRect, b: SeatRect) -> bool {
    a.x < b.right() && b.x < a.right() && a.y < b.bottom() && b.y < a.bottom()
}

fn contains(outer: SeatRect, inner: SeatRect) -> bool {
    outer.x <= inner.x
        && outer.y <= inner.y
        && outer.right() >= inner.right()
        && outer.bottom() >= inner.bottom()
}

fn control_attached_to_window(window: Option<SeatRect>, control: SeatRect) -> bool {
    window.is_none_or(|window| intersects(window, control))
}

fn slide_seat_horizontally(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    work_x: f64,
    work_width: f64,
    obstacles: &[SeatRect],
) -> (f64, f64) {
    let min_x = work_x;
    let max_x = work_x + (work_width - width).max(0.0);
    let seat = |candidate_x: f64| SeatRect {
        x: candidate_x.clamp(min_x, max_x),
        y,
        width,
        height,
    };
    let overlaps = |candidate_x: f64| {
        let frame = seat(candidate_x);
        obstacles
            .iter()
            .any(|obstacle| intersects(frame, *obstacle))
    };
    if obstacles.is_empty() || !overlaps(x) {
        return (x, y);
    }
    let mut offset = CONTROL_NUDGE_STEP;
    while offset <= CONTROL_NUDGE_MAX {
        for candidate in [x - offset, x + offset] {
            if candidate < min_x - 0.5 || candidate > max_x + 0.5 {
                continue;
            }
            if !overlaps(candidate) {
                return (candidate.clamp(min_x, max_x), y);
            }
        }
        offset += CONTROL_NUDGE_STEP;
    }
    (x, y)
}

#[derive(Clone, Debug, PartialEq)]
struct ControlScan {
    obstacles: Vec<SeatRect>,
    truncated: bool,
    failure: Option<SeatDecisionReason>,
}

fn union_rect(a: SeatRect, b: SeatRect) -> SeatRect {
    let x = a.x.min(b.x);
    let y = a.y.min(b.y);
    SeatRect {
        x,
        y,
        width: a.right().max(b.right()) - x,
        height: a.bottom().max(b.bottom()) - y,
    }
}

fn can_merge(a: SeatRect, b: SeatRect) -> bool {
    intersects(
        a.inflate(CONTROL_MERGE_GAP / 2.0),
        b.inflate(CONTROL_MERGE_GAP / 2.0),
    )
}

fn merge_obstacles(obstacles: &[SeatRect]) -> Vec<SeatRect> {
    let mut merged: Vec<SeatRect> = obstacles
        .iter()
        .copied()
        .filter(|rect| rect.is_valid())
        .collect();
    let mut changed = true;
    while changed {
        changed = false;
        let mut next = Vec::new();
        for obstacle in merged {
            if let Some(existing) = next
                .iter_mut()
                .find(|current| can_merge(**current, obstacle))
            {
                *existing = union_rect(*existing, obstacle);
                changed = true;
            } else {
                next.push(obstacle);
            }
        }
        merged = next;
    }
    merged
}

fn is_unsidable_strip(obstacle: SeatRect, seat: SeatRect) -> bool {
    obstacle.width >= CONTROL_NUDGE_MAX && intersects(obstacle, seat)
}

#[cfg(test)]
fn seat_from_scan(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    work_x: f64,
    work_width: f64,
    scan: ControlScan,
) -> SeatResolution {
    seat_from_scan_with_visible(x, y, x, y, width, height, work_x, work_width, scan)
}

fn seat_from_scan_with_visible(
    x: f64,
    y: f64,
    visible_x: f64,
    visible_y: f64,
    width: f64,
    height: f64,
    work_x: f64,
    work_width: f64,
    scan: ControlScan,
) -> SeatResolution {
    if scan.obstacles.is_empty() {
        let reason = scan.failure.unwrap_or(if scan.truncated {
            SeatDecisionReason::ScanTruncated
        } else {
            SeatDecisionReason::NoControlOverlap
        });
        if matches!(
            reason,
            SeatDecisionReason::AccessibilityUnavailable
                | SeatDecisionReason::WindowListUnavailable
                | SeatDecisionReason::ScanTruncated
        ) {
            return SeatResolution::unchanged(visible_x, visible_y, reason);
        }
        return SeatResolution::unchanged(x, y, reason);
    }
    let merged = merge_obstacles(&scan.obstacles);
    let seat = SeatRect {
        x,
        y,
        width,
        height,
    };
    let dense_overlap = merged
        .iter()
        .any(|obstacle| is_unsidable_strip(*obstacle, seat));
    if !merged.iter().any(|obstacle| intersects(seat, *obstacle)) {
        if scan.truncated {
            // A partial traversal may have found some nearby controls without
            // reaching the control under the anchor. Never call that clear or
            // bounce a previously displaced visible seat back onto it.
            return SeatResolution::unchanged(
                visible_x,
                visible_y,
                SeatDecisionReason::ScanTruncated,
            );
        }
        return SeatResolution::unchanged(x, y, SeatDecisionReason::NoControlOverlap);
    }
    let visible_seat = SeatRect {
        x: visible_x,
        y: visible_y,
        width,
        height,
    };
    if ((visible_x - x).abs() >= 1.0 || (visible_y - y).abs() >= 1.0)
        && !merged
            .iter()
            .any(|obstacle| intersects(visible_seat, *obstacle))
    {
        return SeatResolution::unchanged(visible_x, visible_y, SeatDecisionReason::ControlOverlap);
    }
    let (resolved_x, resolved_y) =
        slide_seat_horizontally(x, y, width, height, work_x, work_width, &merged);
    if (resolved_x - x).abs() < 1.0 && (resolved_y - y).abs() < 1.0 {
        // A dense or incomplete strip does not prove that the anchor is safer
        // than an already displaced visible seat. Returning to the anchor in
        // that case makes alternating AX scans bounce the pet between the two
        // positions. Keep the visible seat until a clear scan or a verified
        // free candidate gives us a reason to move.
        let (fallback_x, fallback_y) =
            if (visible_x - x).abs() >= 1.0 || (visible_y - y).abs() >= 1.0 {
                (visible_x, visible_y)
            } else {
                (x, y)
            };
        SeatResolution::unchanged(
            fallback_x,
            fallback_y,
            if dense_overlap {
                SeatDecisionReason::DenseControlStrip
            } else {
                SeatDecisionReason::NoHorizontalGap
            },
        )
    } else {
        SeatResolution::moved(resolved_x, resolved_y)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct WindowCandidate {
    pid: i32,
    frame: SeatRect,
}

#[derive(Clone, Debug, PartialEq)]
struct ProcessScanTarget {
    pid: i32,
    frames: Vec<SeatRect>,
}

fn choose_scan_targets(seat: SeatRect, candidates: &[WindowCandidate]) -> Vec<ProcessScanTarget> {
    let mut targets: Vec<ProcessScanTarget> = Vec::new();
    for candidate in candidates {
        if let Some(index) = targets
            .iter()
            .position(|target| target.pid == candidate.pid)
        {
            let target = &mut targets[index];
            if target.frames.len() < MAX_WINDOWS_PER_PROCESS {
                target.frames.push(candidate.frame);
            }
        } else if targets.len() < MAX_SCANNED_PROCESSES {
            targets.push(ProcessScanTarget {
                pid: candidate.pid,
                frames: vec![candidate.frame],
            });
        } else {
            break;
        }
        // CGWindowListCopyWindowInfo is front-to-back. Once an earlier window
        // fully covers the resident footprint, controls in later windows are
        // visually occluded and must not influence the seat.
        if contains(candidate.frame, seat) {
            break;
        }
    }
    targets
}

#[cfg(target_os = "macos")]
pub(crate) fn native_window_number(window: &WebviewWindow) -> Option<i64> {
    use objc2_app_kit::NSWindow;
    window.ns_window().ok().map(|pointer| unsafe {
        let native: &NSWindow = &*pointer.cast::<NSWindow>();
        native.windowNumber() as i64
    })
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn native_window_number(window: &WebviewWindow) -> Option<i64> {
    let _ = window;
    None
}

#[cfg(target_os = "macos")]
pub(crate) fn resolve_seat_off_ax_controls(
    excluded_window_ids: Vec<i64>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    work_x: f64,
    work_width: f64,
    visible_x: f64,
    visible_y: f64,
) -> SeatResolution {
    let scan =
        control_obstacles_near_seat(excluded_window_ids, x, y, width, height, work_x, work_width);
    seat_from_scan_with_visible(
        x, y, visible_x, visible_y, width, height, work_x, work_width, scan,
    )
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn resolve_seat_off_ax_controls(
    _excluded_window_ids: Vec<i64>,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
    _work_x: f64,
    _work_width: f64,
    visible_x: f64,
    visible_y: f64,
) -> SeatResolution {
    SeatResolution::unchanged(
        visible_x,
        visible_y,
        SeatDecisionReason::UnsupportedPlatform,
    )
}

#[cfg(target_os = "macos")]
fn control_obstacles_near_seat(
    excluded_window_ids: Vec<i64>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    work_x: f64,
    work_width: f64,
) -> ControlScan {
    if !macos_ax::is_trusted() {
        return ControlScan {
            obstacles: Vec::new(),
            truncated: false,
            failure: Some(SeatDecisionReason::AccessibilityUnavailable),
        };
    }
    let Ok(listed) = super::pet_drop_windows::copy_listed_windows() else {
        return ControlScan {
            obstacles: Vec::new(),
            truncated: false,
            failure: Some(SeatDecisionReason::WindowListUnavailable),
        };
    };
    let seat = SeatRect {
        x,
        y,
        width,
        height,
    };
    let search = SeatRect {
        x: (x - CONTROL_NUDGE_MAX).max(work_x),
        y: y - CONTROL_SAFETY_INSET,
        width: (width + CONTROL_NUDGE_MAX * 2.0).min(work_width),
        height: height + CONTROL_SAFETY_INSET * 2.0,
    };
    let mut candidates = Vec::new();
    for window in listed {
        if window.layer != 0
            || window.alpha < 0.05
            || window.bounds.width < 24.0
            || window.bounds.height < 16.0
            || is_system_owner(&window.owner)
        {
            continue;
        }
        let frame = SeatRect {
            x: window.bounds.x,
            y: window.bounds.y,
            width: window.bounds.width,
            height: window.bounds.height,
        };
        if !intersects(frame, search) {
            continue;
        }
        if excluded_window_ids.contains(&window.id) {
            // Transparent Drifty overlays never occlude the app controls the
            // pet is visually resting on, even when their native frame fully
            // contains the seat.
            continue;
        }
        candidates.push(WindowCandidate {
            pid: window.pid as i32,
            frame,
        });
        // Keep collecting front-to-back windows until one fully covers the
        // resident footprint. The unique-process scan limit is applied by
        // choose_scan_targets; stopping here would let duplicate windows from
        // one app hide controls belonging to apps behind it.
        if contains(frame, seat) {
            break;
        }
    }
    let mut obstacles = Vec::new();
    let mut truncated = false;
    if candidates.is_empty() {
        return ControlScan {
            obstacles,
            truncated,
            failure: Some(SeatDecisionReason::NoCandidateWindow),
        };
    }
    for target in choose_scan_targets(seat, &candidates) {
        let scan = macos_ax::scan_controls(target.pid, &target.frames, search);
        truncated |= scan.truncated;
        if !scan.controls.is_empty() {
            for control in scan.controls {
                obstacles.push(control.inflate(CONTROL_SAFETY_INSET));
            }
            continue;
        }
    }
    ControlScan {
        obstacles,
        truncated,
        failure: None,
    }
}

#[cfg(target_os = "macos")]
fn is_system_owner(owner: &str) -> bool {
    matches!(
        owner,
        "Window Server"
            | "loginwindow"
            | "Dock"
            | "Control Center"
            | "제어 센터"
            | "SystemUIServer"
            | "Notification Center"
            | "UserNotificationCenter"
            | "NotificationCentre"
            | "Screen Sharing"
            | "화면 공유"
            | "문제 리포터"
            | "스크린샷"
            | "Problem Reporter"
            | "Screenshot"
    )
}

#[cfg(target_os = "macos")]
mod macos_ax {
    use super::{
        control_attached_to_window, intersects, SeatRect, AX_SCAN_BUDGET_MS, MAX_AX_CONTROLS,
        MAX_AX_VISITED,
    };
    use core_foundation::array::{CFArray, CFArrayRef};
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::string::CFString;
    use std::collections::HashSet;
    use std::ffi::c_void;
    use std::ptr;
    use std::time::{Duration, Instant};

    const KAX_VALUE_CGPOINT: u32 = 1;
    const KAX_VALUE_CGSIZE: u32 = 2;
    // A single unresponsive AX request must not exceed the per-process scan
    // budget before the traversal gets a chance to stop.
    const AX_TIMEOUT_SECONDS: f32 = AX_SCAN_BUDGET_MS as f32 / 1_000.0;

    type AXUIElementRef = *const c_void;
    type AXValueRef = *const c_void;
    type AXError = i32;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: core_foundation::string::CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout: f32) -> AXError;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: core_foundation::string::CFStringRef,
            value: CFTypeRef,
        ) -> AXError;
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyElementAtPosition(
            element: AXUIElementRef,
            x: f32,
            y: f32,
            copy: *mut AXUIElementRef,
        ) -> AXError;
        fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> AXError;
        fn AXValueGetValue(value: AXValueRef, the_type: u32, value_ptr: *mut c_void) -> u8;
    }

    struct ScanState {
        visited: usize,
        truncated: bool,
        seen: HashSet<usize>,
        controls: Vec<SeatRect>,
        started: Instant,
    }

    pub(super) struct WindowControlScan {
        pub controls: Vec<SeatRect>,
        pub truncated: bool,
    }

    unsafe fn enable_enhanced_ui(app: AXUIElementRef) {
        use core_foundation::boolean::CFBoolean;
        let key = CFString::new("AXEnhancedUserInterface");
        let _ = AXUIElementSetAttributeValue(
            app,
            key.as_concrete_TypeRef(),
            CFBoolean::true_value().as_CFTypeRef(),
        );
    }

    pub(super) fn is_trusted() -> bool {
        unsafe { AXIsProcessTrusted() != 0 }
    }

    pub(super) fn scan_controls(
        pid: i32,
        window_targets: &[SeatRect],
        search: SeatRect,
    ) -> WindowControlScan {
        unsafe {
            let app = AXUIElementCreateApplication(pid);
            if app.is_null() {
                return WindowControlScan {
                    controls: Vec::new(),
                    truncated: true,
                };
            }
            let app = CFType::wrap_under_create_rule(app as CFTypeRef);
            let app_ref = app.as_CFTypeRef() as AXUIElementRef;
            let _ = AXUIElementSetMessagingTimeout(app_ref, AX_TIMEOUT_SECONDS);
            enable_enhanced_ui(app_ref);
            let windows = copy_attribute_array(app_ref, "AXWindows");
            let mut state = ScanState {
                visited: 0,
                truncated: false,
                seen: HashSet::new(),
                controls: Vec::new(),
                started: Instant::now(),
            };
            for window_target in window_targets {
                if state.visited >= MAX_AX_VISITED
                    || state.controls.len() >= MAX_AX_CONTROLS
                    || state.started.elapsed() >= Duration::from_millis(AX_SCAN_BUDGET_MS)
                {
                    state.truncated = true;
                    break;
                }
                let window = windows
                    .as_ref()
                    .and_then(|windows| matching_window(windows, *window_target))
                    .or_else(|| first_window_in_children(app_ref, *window_target))
                    .or_else(|| {
                        windows
                            .as_ref()
                            .and_then(|windows| nested_window(windows, *window_target, 0))
                    })
                    .or_else(|| element_in_rect(pid, *window_target));
                let Some(window) = window else {
                    state.truncated = true;
                    continue;
                };
                let window_ref = window.as_CFTypeRef() as AXUIElementRef;
                let window_frame = element_frame(window_ref);
                // AppKit exposes the standard traffic-light controls as
                // dedicated window attributes. Some apps do not also include
                // them in AXChildren, so collect these four explicitly before
                // walking the generic hierarchy.
                for attribute in [
                    "AXCloseButton",
                    "AXMinimizeButton",
                    "AXZoomButton",
                    "AXFullScreenButton",
                ] {
                    scan_control_attribute(window_ref, window_frame, attribute, search, &mut state);
                }
                scan_element(window_ref, search, &mut state);
                if state.truncated {
                    break;
                }
            }
            WindowControlScan {
                controls: state.controls,
                truncated: state.truncated,
            }
        }
    }

    unsafe fn matching_window(
        windows: &CFArray<*const c_void>,
        target: SeatRect,
    ) -> Option<CFType> {
        let mut best: Option<(f64, AXUIElementRef)> = None;
        for index in 0..windows.len() {
            let Some(window) = windows
                .get(index as isize)
                .map(|value| *value as AXUIElementRef)
            else {
                continue;
            };
            let role = copy_attribute_string(window, "AXRole").unwrap_or_default();
            if role != "AXWindow" {
                continue;
            }
            let Some(frame) = element_frame(window) else {
                continue;
            };
            let overlap_x = (frame.right().min(target.right()) - frame.x.max(target.x)).max(0.0);
            let overlap_y = (frame.bottom().min(target.bottom()) - frame.y.max(target.y)).max(0.0);
            let overlap = overlap_x * overlap_y;
            if overlap <= 1.0 {
                continue;
            }
            let subrole = copy_attribute_string(window, "AXSubrole").unwrap_or_default();
            let child_count = copy_attribute_array(window, "AXChildren")
                .map(|children| children.len())
                .unwrap_or(0);
            let score = overlap
                + if subrole == "AXStandardWindow" {
                    80.0
                } else if subrole == "AXDialog" {
                    -80.0
                } else {
                    0.0
                }
                + child_count.min(200) as f64 * 0.2;
            if best.is_none_or(|(best_score, _)| score > best_score) {
                best = Some((score, window));
            }
        }
        best.map(|(_, window)| CFType::wrap_under_get_rule(window as CFTypeRef))
    }

    unsafe fn nested_window(
        elements: &CFArray<*const c_void>,
        target: SeatRect,
        depth: usize,
    ) -> Option<CFType> {
        if depth >= 2 {
            return None;
        }
        if let Some(window) = matching_window(elements, target) {
            return Some(window);
        }
        for index in 0..elements.len() {
            let Some(element) = elements
                .get(index as isize)
                .map(|value| *value as AXUIElementRef)
            else {
                continue;
            };
            let Some(children) = copy_attribute_array(element, "AXChildren") else {
                continue;
            };
            if let Some(window) = nested_window(&children, target, depth + 1) {
                return Some(window);
            }
        }
        None
    }

    unsafe fn first_window_in_children(app: AXUIElementRef, target: SeatRect) -> Option<CFType> {
        let children = copy_attribute_array(app, "AXChildren")?;
        matching_window(&children, target)
    }

    unsafe fn element_pid(element: AXUIElementRef) -> Option<i32> {
        let mut pid = 0;
        let error = AXUIElementGetPid(element, &mut pid);
        (error == 0).then_some(pid)
    }

    fn sample_points(target: SeatRect) -> [(f64, f64); 5] {
        let cx = target.x + target.width * 0.5;
        let cy = target.y + target.height * 0.5;
        [
            (cx, cy),
            (target.x + target.width * 0.2, cy),
            (target.x + target.width * 0.8, cy),
            (cx, target.y + target.height * 0.2),
            (cx, target.y + target.height * 0.8),
        ]
    }

    unsafe fn element_in_rect(pid: i32, target: SeatRect) -> Option<CFType> {
        let system = AXUIElementCreateSystemWide();
        if system.is_null() {
            return None;
        }
        let system = CFType::wrap_under_create_rule(system as CFTypeRef);
        let system_ref = system.as_CFTypeRef() as AXUIElementRef;
        let _ = AXUIElementSetMessagingTimeout(system_ref, AX_TIMEOUT_SECONDS);
        for (x, y) in sample_points(target) {
            let mut hit: AXUIElementRef = ptr::null();
            let error = AXUIElementCopyElementAtPosition(system_ref, x as f32, y as f32, &mut hit);
            if error != 0 || hit.is_null() {
                continue;
            }
            let mut current = CFType::wrap_under_create_rule(hit as CFTypeRef);
            if element_pid(current.as_CFTypeRef() as AXUIElementRef) != Some(pid) {
                continue;
            }
            for _ in 0..12 {
                let current_ref = current.as_CFTypeRef() as AXUIElementRef;
                let role = copy_attribute_string(current_ref, "AXRole").unwrap_or_default();
                if role == "AXWindow" {
                    return Some(current);
                }
                let Some(parent) = copy_attribute_value(current_ref, "AXParent") else {
                    break;
                };
                let parent = CFType::wrap_under_create_rule(parent);
                if element_pid(parent.as_CFTypeRef() as AXUIElementRef) != Some(pid) {
                    break;
                }
                current = parent;
            }
        }
        None
    }

    unsafe fn scan_element(element: AXUIElementRef, search: SeatRect, state: &mut ScanState) {
        if element.is_null()
            || state.visited >= MAX_AX_VISITED
            || state.controls.len() >= MAX_AX_CONTROLS
            || state.started.elapsed() >= Duration::from_millis(AX_SCAN_BUDGET_MS)
        {
            state.truncated = true;
            return;
        }
        let address = element as usize;
        if !state.seen.insert(address) {
            return;
        }
        state.visited += 1;
        let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
        let frame = element_frame(element);
        if is_control_role(&role) {
            if attribute_is_true(element, "AXHidden") {
                return;
            }
            if let Some(frame) = frame {
                if frame.is_valid() && intersects(frame, search) {
                    state.controls.push(frame);
                }
            }
            return;
        }
        if let Some(frame) = frame {
            if frame.is_valid() && !intersects(frame, search) {
                return;
            }
        }
        if state.truncated {
            return;
        }
        // Prefer the visible subtree so large browser/document hierarchies can
        // reach an on-screen button before the fixed node/time budgets expire.
        // `seen` makes overlapping AX child collections safe to traverse.
        for attribute in ["AXVisibleChildren", "AXChildren", "AXContents"] {
            let Some(children) = copy_attribute_array(element, attribute) else {
                continue;
            };
            for index in 0..children.len() {
                let Some(child) = children
                    .get(index as isize)
                    .map(|value| *value as AXUIElementRef)
                else {
                    continue;
                };
                scan_element(child, search, state);
                if state.truncated {
                    return;
                }
            }
        }
    }

    unsafe fn scan_control_attribute(
        window: AXUIElementRef,
        window_frame: Option<SeatRect>,
        attribute: &str,
        search: SeatRect,
        state: &mut ScanState,
    ) {
        if state.controls.len() >= MAX_AX_CONTROLS
            || state.started.elapsed() >= Duration::from_millis(AX_SCAN_BUDGET_MS)
        {
            state.truncated = true;
            return;
        }
        let Some(control) = copy_attribute_value(window, attribute) else {
            return;
        };
        let control = CFType::wrap_under_create_rule(control);
        let control_ref = control.as_CFTypeRef() as AXUIElementRef;
        if !attribute_is_true(control_ref, "AXHidden") {
            let address = control_ref as usize;
            if state.seen.insert(address) {
                state.visited += 1;
                if let Some(frame) = element_frame(control_ref) {
                    if control_attached_to_window(window_frame, frame)
                        && frame.is_valid()
                        && intersects(frame, search)
                    {
                        state.controls.push(frame);
                    }
                }
            }
        }
    }

    fn is_control_role(role: &str) -> bool {
        matches!(
            role,
            "AXButton"
                | "AXCheckBox"
                | "AXRadioButton"
                | "AXPopUpButton"
                | "AXMenuButton"
                | "AXComboBox"
                | "AXSlider"
                | "AXIncrementor"
                | "AXTab"
                | "AXLink"
                | "AXDisclosureTriangle"
                | "AXSwitch"
                | "AXMenuItem"
        )
    }

    unsafe fn element_frame(element: AXUIElementRef) -> Option<SeatRect> {
        let position = CFType::wrap_under_create_rule(copy_attribute_value(element, "AXPosition")?);
        let size = CFType::wrap_under_create_rule(copy_attribute_value(element, "AXSize")?);
        let mut point = CGPoint::default();
        let mut extent = CGSize::default();
        let ok_point = AXValueGetValue(
            position.as_CFTypeRef() as AXValueRef,
            KAX_VALUE_CGPOINT,
            &mut point as *mut CGPoint as *mut c_void,
        ) != 0;
        let ok_size = AXValueGetValue(
            size.as_CFTypeRef() as AXValueRef,
            KAX_VALUE_CGSIZE,
            &mut extent as *mut CGSize as *mut c_void,
        ) != 0;
        let frame = SeatRect {
            x: point.x,
            y: point.y,
            width: extent.width,
            height: extent.height,
        };
        (ok_point && ok_size && frame.is_valid()).then_some(frame)
    }

    unsafe fn copy_attribute_array(
        element: AXUIElementRef,
        attribute: &str,
    ) -> Option<CFArray<*const c_void>> {
        let value = copy_attribute_value(element, attribute)?;
        Some(CFArray::wrap_under_create_rule(value as CFArrayRef))
    }

    unsafe fn copy_attribute_string(element: AXUIElementRef, attribute: &str) -> Option<String> {
        let value = copy_attribute_value(element, attribute)?;
        let string = CFString::wrap_under_create_rule(value as _);
        Some(string.to_string())
    }

    unsafe fn copy_attribute_value(element: AXUIElementRef, attribute: &str) -> Option<CFTypeRef> {
        let key = CFString::new(attribute);
        let mut value: CFTypeRef = ptr::null();
        let error = AXUIElementCopyAttributeValue(
            element,
            key.as_concrete_TypeRef(),
            &mut value as *mut CFTypeRef,
        );
        (error == 0 && !value.is_null()).then_some(value)
    }

    unsafe fn attribute_is_true(element: AXUIElementRef, attribute: &str) -> bool {
        let Some(value) = copy_attribute_value(element, attribute) else {
            return false;
        };
        CFType::wrap_under_create_rule(value)
            .downcast_into::<CFBoolean>()
            .is_some_and(|boolean| boolean == CFBoolean::true_value())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> SeatRect {
        SeatRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn slides_left_of_a_single_right_edge_button() {
        let obstacles = [rect(1290.0, 8.0, 48.0, 28.0).inflate(CONTROL_SAFETY_INSET)];
        let nudged = slide_seat_horizontally(1272.0, 14.0, 144.0, 99.0, 0.0, 1440.0, &obstacles);
        assert_eq!(nudged.1, 14.0);
        assert!(nudged.0 < 1272.0);
        assert!(!intersects(
            SeatRect {
                x: nudged.0,
                y: 14.0,
                width: 144.0,
                height: 99.0,
            },
            obstacles[0],
        ));
    }

    #[test]
    fn dedicated_window_control_geometry_accepts_titlebar_buttons_but_rejects_ghosts() {
        let window = rect(500.0, 30.0, 800.0, 600.0);
        assert!(control_attached_to_window(
            Some(window),
            rect(512.0, 42.0, 14.0, 14.0),
        ));
        assert!(!control_attached_to_window(
            Some(window),
            rect(100.0, 42.0, 14.0, 14.0),
        ));
        assert!(control_attached_to_window(
            None,
            rect(512.0, 42.0, 14.0, 14.0),
        ));
    }

    #[test]
    fn stays_put_when_the_band_is_all_controls() {
        let obstacles = [rect(0.0, 0.0, 1440.0, 80.0)];
        let nudged = slide_seat_horizontally(1272.0, 14.0, 144.0, 99.0, 0.0, 1440.0, &obstacles);
        assert_eq!(nudged, (1272.0, 14.0));
    }

    #[test]
    fn stays_put_on_a_continuous_toolbar_strip() {
        let obstacles = [rect(1300.0, 40.0, 428.0, 50.0)];
        let home = slide_seat_horizontally(1560.0, 47.0, 144.0, 99.0, 0.0, 1728.0, &obstacles);
        assert_eq!(home, (1560.0, 47.0));
    }

    #[test]
    fn moves_past_a_dense_toolbar_when_clear_space_is_within_budget() {
        let buttons = [
            rect(1514.0, 79.0, 34.0, 34.0),
            rect(1550.0, 79.0, 34.0, 34.0),
            rect(1598.0, 84.0, 24.0, 24.0),
            rect(1600.0, 39.0, 28.0, 28.0),
            rect(1622.0, 33.0, 33.0, 41.0),
            rect(1637.0, 33.0, 33.0, 41.0),
            rect(1652.0, 33.0, 32.0, 41.0),
            rect(1666.0, 33.0, 32.0, 41.0),
            rect(1680.0, 33.0, 32.0, 41.0),
            rect(1694.0, 33.0, 32.0, 41.0),
            rect(1708.0, 33.0, 56.0, 41.0),
            rect(1758.0, 33.0, 28.0, 41.0),
            rect(1762.0, 84.0, 24.0, 24.0),
            rect(1794.0, 84.0, 24.0, 24.0),
            rect(1839.0, 79.0, 34.0, 34.0),
            rect(1840.0, 33.0, 168.0, 40.0),
            rect(1520.0, 45.0, 16.0, 16.0),
            rect(1543.0, 45.0, 16.0, 16.0),
            rect(1566.0, 45.0, 16.0, 16.0),
        ]
        .map(|button| button.inflate(CONTROL_SAFETY_INSET));
        let scan = ControlScan {
            obstacles: buttons.to_vec(),
            truncated: false,
            failure: None,
        };
        let merged = merge_obstacles(&buttons);
        let resolution = seat_from_scan(1560.0, 47.0, 144.0, 99.0, 0.0, 1728.0, scan);
        assert_eq!((resolution.x, resolution.y), (1344.0, 47.0));
        assert!(resolution.moved);
        assert_eq!(resolution.reason, SeatDecisionReason::ControlOverlap);
        assert!(!merged
            .iter()
            .any(|obstacle| intersects(rect(resolution.x, resolution.y, 144.0, 99.0), *obstacle,)));
    }

    #[test]
    fn reports_a_dense_strip_when_no_horizontal_gap_exists() {
        let scan = ControlScan {
            obstacles: vec![rect(0.0, 0.0, 1440.0, 80.0)],
            truncated: false,
            failure: None,
        };
        let resolution = seat_from_scan(1272.0, 14.0, 144.0, 99.0, 0.0, 1440.0, scan);
        assert_eq!((resolution.x, resolution.y), (1272.0, 14.0));
        assert_eq!(resolution.reason, SeatDecisionReason::DenseControlStrip);
    }

    #[test]
    fn prefers_the_left_slide_when_both_sides_are_clear() {
        let obstacles = [rect(1290.0, 8.0, 48.0, 28.0).inflate(CONTROL_SAFETY_INSET)];
        let nudged = slide_seat_horizontally(1272.0, 14.0, 144.0, 99.0, 0.0, 1440.0, &obstacles);
        assert_eq!(nudged.1, 14.0);
        assert!(nudged.0 < 1272.0);
    }

    #[test]
    fn fail_closed_scan_keeps_the_original_seat() {
        let scan = ControlScan {
            obstacles: Vec::new(),
            truncated: true,
            failure: None,
        };
        let resolution = seat_from_scan(1272.0, 14.0, 144.0, 99.0, 0.0, 1440.0, scan);
        assert_eq!((resolution.x, resolution.y), (1272.0, 14.0));
        assert_eq!(resolution.reason, SeatDecisionReason::ScanTruncated);
    }

    #[test]
    fn truncated_scan_still_slides_when_a_control_was_found() {
        let scan = ControlScan {
            obstacles: vec![rect(1290.0, 8.0, 48.0, 28.0).inflate(CONTROL_SAFETY_INSET)],
            truncated: true,
            failure: None,
        };
        let nudged = seat_from_scan(1272.0, 14.0, 144.0, 99.0, 0.0, 1440.0, scan);
        assert_eq!(nudged.y, 14.0);
        assert!(nudged.x < 1272.0);
        assert!(nudged.moved);
        assert_eq!(nudged.reason, SeatDecisionReason::ControlOverlap);
    }

    #[test]
    fn partial_scan_with_only_irrelevant_controls_never_claims_the_anchor_is_clear() {
        let resolution = seat_from_scan_with_visible(
            1272.0,
            14.0,
            1032.0,
            14.0,
            144.0,
            99.0,
            0.0,
            1440.0,
            ControlScan {
                obstacles: vec![rect(300.0, 8.0, 48.0, 28.0)],
                truncated: true,
                failure: None,
            },
        );
        assert_eq!((resolution.x, resolution.y), (1032.0, 14.0));
        assert!(!resolution.moved);
        assert_eq!(resolution.reason, SeatDecisionReason::ScanTruncated);
    }

    #[test]
    fn reports_a_clear_scan_separately_from_an_unavailable_scan() {
        let clear = seat_from_scan(
            1272.0,
            14.0,
            144.0,
            99.0,
            0.0,
            1440.0,
            ControlScan {
                obstacles: Vec::new(),
                truncated: false,
                failure: None,
            },
        );
        let unavailable = seat_from_scan(
            1272.0,
            14.0,
            144.0,
            99.0,
            0.0,
            1440.0,
            ControlScan {
                obstacles: Vec::new(),
                truncated: false,
                failure: Some(SeatDecisionReason::AccessibilityUnavailable),
            },
        );
        assert_eq!(clear.reason, SeatDecisionReason::NoControlOverlap);
        assert_eq!(
            unavailable.reason,
            SeatDecisionReason::AccessibilityUnavailable
        );
    }

    #[test]
    fn reconcile_preserves_a_verified_safe_visible_seat() {
        let resolution = seat_from_scan_with_visible(
            1272.0,
            14.0,
            1032.0,
            14.0,
            144.0,
            99.0,
            0.0,
            1440.0,
            ControlScan {
                obstacles: vec![rect(1290.0, 8.0, 48.0, 28.0).inflate(CONTROL_SAFETY_INSET)],
                truncated: false,
                failure: None,
            },
        );
        assert_eq!((resolution.x, resolution.y), (1032.0, 14.0));
        assert_eq!(resolution.reason, SeatDecisionReason::ControlOverlap);
    }

    #[test]
    fn reconcile_preserves_the_visible_seat_when_no_safe_gap_is_proven() {
        let resolution = seat_from_scan_with_visible(
            1272.0,
            14.0,
            1032.0,
            14.0,
            144.0,
            99.0,
            0.0,
            1440.0,
            ControlScan {
                obstacles: vec![rect(0.0, 0.0, 1440.0, 80.0)],
                truncated: false,
                failure: None,
            },
        );
        assert_eq!((resolution.x, resolution.y), (1032.0, 14.0));
        assert!(!resolution.moved);
        assert_eq!(resolution.reason, SeatDecisionReason::DenseControlStrip);
    }

    #[test]
    fn reconcile_returns_to_the_anchor_only_after_it_scans_clear() {
        let clear = seat_from_scan_with_visible(
            1272.0,
            14.0,
            1032.0,
            14.0,
            144.0,
            99.0,
            0.0,
            1440.0,
            ControlScan {
                obstacles: Vec::new(),
                truncated: false,
                failure: None,
            },
        );
        let unavailable = seat_from_scan_with_visible(
            1272.0,
            14.0,
            1032.0,
            14.0,
            144.0,
            99.0,
            0.0,
            1440.0,
            ControlScan {
                obstacles: Vec::new(),
                truncated: false,
                failure: Some(SeatDecisionReason::AccessibilityUnavailable),
            },
        );
        assert_eq!((clear.x, clear.y), (1272.0, 14.0));
        assert_eq!((unavailable.x, unavailable.y), (1032.0, 14.0));
    }

    #[test]
    fn stops_at_the_frontmost_window_that_fully_covers_the_seat() {
        let seat = rect(1560.0, 47.0, 144.0, 99.0);
        let overlay = WindowCandidate {
            pid: 1,
            frame: rect(352.0, 33.0, 1376.0, 1084.0),
        };
        let chrome = WindowCandidate {
            pid: 2,
            frame: rect(1508.0, 33.0, 500.0, 375.0),
        };
        let chosen = choose_scan_targets(seat, &[overlay, chrome]);
        assert_eq!(
            chosen.iter().map(|target| target.pid).collect::<Vec<_>>(),
            vec![1]
        );
    }

    #[test]
    fn preserves_front_to_back_order_until_the_seat_is_fully_covered() {
        let seat = rect(1560.0, 47.0, 144.0, 99.0);
        let partial = WindowCandidate {
            pid: 1,
            frame: rect(1560.0, 47.0, 60.0, 99.0),
        };
        let covering = WindowCandidate {
            pid: 2,
            frame: rect(1508.0, 33.0, 500.0, 375.0),
        };
        let hidden_behind = WindowCandidate {
            pid: 3,
            frame: rect(1500.0, 30.0, 520.0, 400.0),
        };
        let chosen = choose_scan_targets(seat, &[partial, covering, hidden_behind]);
        assert_eq!(
            chosen.iter().map(|target| target.pid).collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[test]
    fn duplicate_process_windows_do_not_consume_the_scan_budget() {
        let seat = rect(1560.0, 47.0, 144.0, 99.0);
        let stickies = WindowCandidate {
            pid: 3,
            frame: rect(1660.0, 33.0, 88.0, 120.0),
        };
        let calculator = WindowCandidate {
            pid: 4,
            frame: rect(1548.0, 100.0, 230.0, 408.0),
        };
        let chrome = WindowCandidate {
            pid: 5,
            frame: rect(1508.0, 33.0, 80.0, 375.0),
        };
        let duplicate_chrome = WindowCandidate {
            pid: 5,
            frame: rect(1580.0, 35.0, 40.0, 360.0),
        };
        let third_chrome = WindowCandidate {
            pid: 5,
            frame: rect(1620.0, 35.0, 24.0, 360.0),
        };
        let fourth_chrome = WindowCandidate {
            pid: 5,
            frame: rect(1644.0, 35.0, 16.0, 360.0),
        };
        let chosen = choose_scan_targets(
            seat,
            &[
                chrome,
                duplicate_chrome,
                third_chrome,
                fourth_chrome,
                stickies,
                calculator,
            ],
        );
        assert_eq!(
            chosen.iter().map(|target| target.pid).collect::<Vec<_>>(),
            vec![5, 3, 4]
        );
        assert_eq!(chosen[0].frames.len(), MAX_WINDOWS_PER_PROCESS);
    }
}
