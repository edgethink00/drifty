//! Resident-seat AX control veto.
//!
//! Keep the right-top home. If that footprint overlaps an AX control, slide
//! only on the same Y. If every nearby X still hits a control, or AX is
//! missing or truncated, keep the original seat. Titles, values, and text
//! content are never read.

use tauri::WebviewWindow;

const CONTROL_NUDGE_STEP: f64 = 24.0;
const CONTROL_NUDGE_MAX: f64 = 240.0;
const CONTROL_SAFETY_INSET: f64 = 12.0;
const CONTROL_MERGE_GAP: f64 = 24.0;
const MAX_AX_VISITED: usize = 400;
const MAX_AX_CONTROLS: usize = 80;
const MAX_SCANNED_WINDOWS: usize = 4;
const AX_SCAN_BUDGET_MS: u64 = 120;

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

fn seat_from_scan(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    work_x: f64,
    work_width: f64,
    scan: ControlScan,
) -> (f64, f64) {
    if scan.truncated && scan.obstacles.is_empty() {
        return (x, y);
    }
    let merged = merge_obstacles(&scan.obstacles);
    let seat = SeatRect {
        x,
        y,
        width,
        height,
    };
    if merged
        .iter()
        .any(|obstacle| is_unsidable_strip(*obstacle, seat))
    {
        return (x, y);
    }
    slide_seat_horizontally(x, y, width, height, work_x, work_width, &merged)
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct WindowCandidate {
    pid: i32,
    frame: SeatRect,
}

fn window_scan_priority(seat: SeatRect, frame: SeatRect) -> (u8, i64, i64) {
    let covers_seat = intersects(seat, frame);
    let area = (frame.width * frame.height).round() as i64;
    let dx = ((frame.x + frame.width * 0.5) - (seat.x + seat.width * 0.5)).round() as i64;
    let dy = ((frame.y + frame.height * 0.5) - (seat.y + seat.height * 0.5)).round() as i64;
    let dist = dx.abs().saturating_add(dy.abs());
    (if covers_seat { 0 } else { 1 }, area, dist)
}

fn choose_scan_targets(seat: SeatRect, candidates: &[WindowCandidate]) -> Vec<WindowCandidate> {
    let mut ranked = candidates.to_vec();
    ranked.sort_by(|left, right| {
        window_scan_priority(seat, left.frame).cmp(&window_scan_priority(seat, right.frame))
    });
    let mut unique = Vec::new();
    for candidate in ranked {
        if unique
            .iter()
            .any(|existing: &WindowCandidate| existing.pid == candidate.pid)
        {
            continue;
        }
        unique.push(candidate);
        if unique.len() == MAX_SCANNED_WINDOWS {
            break;
        }
    }
    unique
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
pub(crate) fn nudge_seat_off_ax_controls(
    excluded_window_ids: Vec<i64>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    work_x: f64,
    work_width: f64,
) -> (f64, f64) {
    let scan =
        control_obstacles_near_seat(excluded_window_ids, x, y, width, height, work_x, work_width);
    seat_from_scan(x, y, width, height, work_x, work_width, scan)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn nudge_seat_off_ax_controls(
    _excluded_window_ids: Vec<i64>,
    x: f64,
    y: f64,
    _width: f64,
    _height: f64,
    _work_x: f64,
    _work_width: f64,
) -> (f64, f64) {
    (x, y)
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
        };
    }
    let Ok(listed) = super::pet_drop_windows::copy_listed_windows() else {
        return ControlScan {
            obstacles: Vec::new(),
            truncated: false,
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
    let own_pid = std::process::id() as i64;
    let mut candidates = Vec::new();
    for window in listed {
        if excluded_window_ids.contains(&window.id)
            || window.pid == own_pid
            || window.layer != 0
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
        candidates.push(WindowCandidate {
            pid: window.pid as i32,
            frame,
        });
    }
    let mut obstacles = Vec::new();
    let mut truncated = false;
    for target in choose_scan_targets(seat, &candidates) {
        let scan = macos_ax::scan_controls(target.pid, search);
        if !scan.controls.is_empty() {
            for control in scan.controls {
                obstacles.push(control.inflate(CONTROL_SAFETY_INSET));
            }
            continue;
        }
        if scan.truncated && intersects(target.frame, seat) {
            truncated = true;
        }
    }
    if !obstacles.is_empty() {
        truncated = false;
    }
    ControlScan {
        obstacles,
        truncated,
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
    use super::{intersects, SeatRect, AX_SCAN_BUDGET_MS, MAX_AX_CONTROLS, MAX_AX_VISITED};
    use core_foundation::array::{CFArray, CFArrayRef};
    use core_foundation::base::{CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use std::collections::HashSet;
    use std::ffi::c_void;
    use std::ptr;
    use std::time::{Duration, Instant};

    const KAX_VALUE_CGPOINT: u32 = 1;
    const KAX_VALUE_CGSIZE: u32 = 2;
    const AX_TIMEOUT_SECONDS: f32 = 0.25;

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
        fn CFRelease(cf: CFTypeRef);
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

    pub(super) fn scan_controls(pid: i32, target: SeatRect) -> WindowControlScan {
        unsafe {
            let app = AXUIElementCreateApplication(pid);
            if app.is_null() {
                return WindowControlScan {
                    controls: Vec::new(),
                    truncated: true,
                };
            }
            let _ = AXUIElementSetMessagingTimeout(app, AX_TIMEOUT_SECONDS);
            enable_enhanced_ui(app);
            let scan = (|| {
                let windows = copy_attribute_array(app, "AXWindows")?;
                let window = matching_window(&windows, target)
                    .or_else(|| first_window_in_children(app, target))
                    .or_else(|| nested_window(&windows, target, 0))
                    .or_else(|| element_in_rect(pid, target))?;
                let mut state = ScanState {
                    visited: 0,
                    truncated: false,
                    seen: HashSet::new(),
                    controls: Vec::new(),
                    started: Instant::now(),
                };
                scan_element(window, target, &mut state);
                Some(WindowControlScan {
                    controls: state.controls,
                    truncated: state.truncated,
                })
            })()
            .unwrap_or(WindowControlScan {
                controls: Vec::new(),
                truncated: true,
            });
            CFRelease(app as CFTypeRef);
            scan
        }
    }

    unsafe fn matching_window(
        windows: &CFArray<*const c_void>,
        target: SeatRect,
    ) -> Option<AXUIElementRef> {
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
        best.map(|(_, window)| window)
    }

    unsafe fn nested_window(
        elements: &CFArray<*const c_void>,
        target: SeatRect,
        depth: usize,
    ) -> Option<AXUIElementRef> {
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

    unsafe fn first_window_in_children(
        app: AXUIElementRef,
        target: SeatRect,
    ) -> Option<AXUIElementRef> {
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

    unsafe fn element_in_rect(pid: i32, target: SeatRect) -> Option<AXUIElementRef> {
        let system = AXUIElementCreateSystemWide();
        if system.is_null() {
            return None;
        }
        let _ = AXUIElementSetMessagingTimeout(system, AX_TIMEOUT_SECONDS);
        let mut found = None;
        for (x, y) in sample_points(target) {
            let mut hit: AXUIElementRef = ptr::null();
            let error = AXUIElementCopyElementAtPosition(system, x as f32, y as f32, &mut hit);
            if error != 0 || hit.is_null() {
                continue;
            }
            if element_pid(hit) != Some(pid) {
                CFRelease(hit as CFTypeRef);
                continue;
            }
            let mut current = hit;
            let mut window = None;
            for _ in 0..12 {
                let role = copy_attribute_string(current, "AXRole").unwrap_or_default();
                if role == "AXWindow" {
                    window = Some(current);
                    break;
                }
                let Some(parent) = copy_attribute_value(current, "AXParent") else {
                    break;
                };
                if current != hit {
                    CFRelease(current as CFTypeRef);
                }
                current = parent as AXUIElementRef;
                if element_pid(current) != Some(pid) {
                    break;
                }
            }
            if let Some(window) = window {
                found = Some(window);
                break;
            }
            CFRelease(hit as CFTypeRef);
        }
        CFRelease(system as CFTypeRef);
        found
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
            if let Some(frame) = frame {
                if frame.is_valid() && intersects(frame, search) {
                    state.controls.push(frame);
                }
            }
            return;
        }
        if should_skip_descendants(&role) {
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
        for attribute in ["AXChildren", "AXContents", "AXVisibleChildren"] {
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

    fn should_skip_descendants(role: &str) -> bool {
        matches!(
            role,
            "AXWebArea"
                | "AXDocument"
                | "AXTextArea"
                | "AXScrollArea"
                | "AXOutline"
                | "AXTable"
                | "AXGrid"
        )
    }

    unsafe fn element_frame(element: AXUIElementRef) -> Option<SeatRect> {
        let position = copy_attribute_value(element, "AXPosition")?;
        let size = copy_attribute_value(element, "AXSize")?;
        let mut point = CGPoint::default();
        let mut extent = CGSize::default();
        let ok_point = AXValueGetValue(
            position as AXValueRef,
            KAX_VALUE_CGPOINT,
            &mut point as *mut CGPoint as *mut c_void,
        ) != 0;
        let ok_size = AXValueGetValue(
            size as AXValueRef,
            KAX_VALUE_CGSIZE,
            &mut extent as *mut CGSize as *mut c_void,
        ) != 0;
        CFRelease(position);
        CFRelease(size);
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
    fn merges_dense_toolbar_buttons_into_an_unsidable_strip() {
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
        };
        assert_eq!(
            seat_from_scan(1560.0, 47.0, 144.0, 99.0, 0.0, 1728.0, scan),
            (1560.0, 47.0)
        );
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
        };
        assert_eq!(
            seat_from_scan(1272.0, 14.0, 144.0, 99.0, 0.0, 1440.0, scan),
            (1272.0, 14.0)
        );
    }

    #[test]
    fn truncated_scan_still_slides_when_a_control_was_found() {
        let scan = ControlScan {
            obstacles: vec![rect(1290.0, 8.0, 48.0, 28.0).inflate(CONTROL_SAFETY_INSET)],
            truncated: true,
        };
        let nudged = seat_from_scan(1272.0, 14.0, 144.0, 99.0, 0.0, 1440.0, scan);
        assert_eq!(nudged.1, 14.0);
        assert!(nudged.0 < 1272.0);
    }

    #[test]
    fn prefers_the_small_covering_window_over_a_huge_overlay() {
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
            chosen.iter().map(|window| window.pid).collect::<Vec<_>>(),
            vec![2, 1]
        );
    }

    #[test]
    fn extra_nearby_windows_do_not_consume_the_scan_budget() {
        let seat = rect(1560.0, 47.0, 144.0, 99.0);
        let stickies = WindowCandidate {
            pid: 3,
            frame: rect(1548.0, 33.0, 200.0, 120.0),
        };
        let calculator = WindowCandidate {
            pid: 4,
            frame: rect(1548.0, 33.0, 230.0, 408.0),
        };
        let chrome = WindowCandidate {
            pid: 5,
            frame: rect(1508.0, 33.0, 500.0, 375.0),
        };
        let chosen = choose_scan_targets(seat, &[chrome, calculator, stickies]);
        assert_eq!(
            chosen.iter().map(|window| window.pid).collect::<Vec<_>>(),
            vec![3, 4, 5]
        );
        let duplicate_chrome = WindowCandidate {
            pid: 5,
            frame: rect(1510.0, 35.0, 490.0, 360.0),
        };
        let chosen = choose_scan_targets(seat, &[chrome, duplicate_chrome, stickies, calculator]);
        assert_eq!(
            chosen.iter().map(|window| window.pid).collect::<Vec<_>>(),
            vec![3, 4, 5]
        );
    }
}
