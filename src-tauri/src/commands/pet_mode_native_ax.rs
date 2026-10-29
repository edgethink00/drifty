//! Native Accessibility targeting for Pet Mode browser tab X.
//!
//! System Events AppleScript often resolves Chromium-class browsers like Aside
//! to an auxiliary AXDialog window. That path never reaches the selected tab,
//! so Lab Browser X fails closed. This module walks the real AXUIElement tree
//! and prefers the AXStandardWindow that owns the tab strip.

#![cfg(target_os = "macos")]

use crate::commands::ax_values::AxElements;
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use objc2::rc::autoreleasepool;
use objc2_app_kit::NSWorkspace;
use objc2_foundation::NSString;
use std::ffi::c_void;
use std::ptr;

use super::{PetModeTargetConfidence, PetModeTargetKind, PetModeTargetPoint};

const NATIVE_AX_SCAN_LIMIT: usize = 2400;
const TAB_CLOSE_EDGE_INSET: f64 = 14.0;
const KAX_VALUE_CGPOINT: u32 = 1;
const KAX_VALUE_CGSIZE: u32 = 2;

type AXUIElementRef = *const c_void;
type AXValueRef = *const c_void;
type AXError = i32;
type PidT = i32;

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
    fn AXUIElementCreateApplication(pid: PidT) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: core_foundation::string::CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXValueGetValue(value: AXValueRef, the_type: u32, value_ptr: *mut c_void) -> u8;
    fn CFRelease(cf: CFTypeRef);
}

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

struct ScanState {
    visited: usize,
    found: Option<PetModeTargetPoint>,
    inferred: Option<PetModeTargetPoint>,
    /// Visible label of the AX tab that claimed selection. The tab strip's
    /// `AXSelected` flag is not the browser's active tab: Aside keeps it on the
    /// last ordinary tab while an Agent Tab or side-panel session is showing.
    selected_tab_label: Option<String>,
}

/// A selected-tab close hotspot together with the label of the tab it was
/// derived from, so the caller can prove the hotspot belongs to the tab that
/// the automatic close is about to act on.
pub(super) struct SelectedBrowserTabClose {
    pub(super) point: PetModeTargetPoint,
    pub(super) selected_tab_label: Option<String>,
}

pub(super) fn resolve_selected_browser_tab_close(
    app_name: &str,
    browser_name: Option<&str>,
) -> Option<SelectedBrowserTabClose> {
    let pid = find_pid_by_app_name(app_name).or_else(|| {
        browser_name
            .filter(|name| !name.trim().is_empty())
            .and_then(find_pid_by_app_name)
    })?;
    if is_this_process(pid) {
        // AX reads of Drifty itself run WebKit off the main thread; macOS 26
        // traps the app for that. Drifty's own close targets use the main thread.
        return None;
    }
    let prefer_left_edge = prefers_left_edge_close(app_name, browser_name);

    // SAFETY: Category 8 - FFI boundary. We own the application AXUIElement
    // created below and release it before returning. Attribute copies are
    // wrapped with create/get rules so CoreFoundation refcounts stay balanced.
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return None;
        }
        let result = (|| {
            let windows = copy_attribute_array(app, "AXWindows")?;
            let window = choose_browser_content_window(app, &windows)?;
            let mut state = ScanState {
                visited: 0,
                found: None,
                inferred: None,
                selected_tab_label: None,
            };
            scan_for_selected_tab_close(window, prefer_left_edge, false, &mut state);
            let point = state.found.or(state.inferred)?;
            Some(SelectedBrowserTabClose {
                point,
                selected_tab_label: state.selected_tab_label,
            })
        })();
        CFRelease(app as CFTypeRef);
        result
    }
}

/// Only the targeted, frontmost app can own a full-screen intervention.
/// AX bounds are global logical points, including displays left of the primary.
pub(super) fn fullscreen_target_frame(app_name: &str, browser_name: Option<&str>) -> Option<(f64, f64, f64, f64)> {
    let pid = find_pid_by_app_name(app_name).or_else(|| browser_name.and_then(find_pid_by_app_name))?;
    if is_this_process(pid) { return None; }
    if NSWorkspace::sharedWorkspace().frontmostApplication()?.processIdentifier() != pid { return None; }
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() { return None; }
        let result = (|| {
            let window = copy_attribute_value(app, "AXFocusedWindow")?;
            if !crate::commands::ax_values::is_ax_element(window) {
                CFRelease(window);
                return None;
            }
            let result = (|| {
                let value = copy_attribute_value(window as AXUIElementRef, "AXFullScreen")?;
                let fullscreen = CFType::wrap_under_create_rule(value)
                    .downcast_into::<CFBoolean>()
                    .is_some_and(|value| value == CFBoolean::true_value());
                if !fullscreen { return None; }
                let rect = element_frame(window as AXUIElementRef)?;
                Some((rect.x, rect.y, rect.width, rect.height))
            })();
            CFRelease(window);
            result
        })();
        CFRelease(app as CFTypeRef);
        result
    }
}

fn prefers_left_edge_close(app_name: &str, browser_name: Option<&str>) -> bool {
    [Some(app_name), browser_name]
        .into_iter()
        .flatten()
        .any(|name| name.to_ascii_lowercase().contains("safari"))
}

fn find_pid_by_app_name(app_name: &str) -> Option<PidT> {
    let needle = normalize_app_name(app_name);
    if needle.is_empty() {
        return None;
    }

    // SAFETY: Category 8 - FFI boundary. NSWorkspace/NSRunningApplication
    // objects stay inside this autorelease scope and no Objective-C
    // pointer escapes.
    autoreleasepool(|_| {
        let workspace = NSWorkspace::sharedWorkspace();
        let applications = workspace.runningApplications();
        for index in 0..applications.count() {
            let application = applications.objectAtIndex(index);
            let Some(localized_name) = application.localizedName() else {
                continue;
            };
            let localized = nsstring_to_string(&localized_name);
            if app_name_matches(&needle, &localized) {
                return Some(application.processIdentifier());
            }
            if let Some(bundle_url) = application.bundleURL() {
                if let Some(last_path) = bundle_url.lastPathComponent() {
                    let bundle_name = nsstring_to_string(&last_path)
                        .trim_end_matches(".app")
                        .to_string();
                    if app_name_matches(&needle, &bundle_name) {
                        return Some(application.processIdentifier());
                    }
                }
            }
        }
        None
    })
}

fn normalize_app_name(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn app_name_matches(needle: &str, candidate: &str) -> bool {
    let candidate = normalize_app_name(candidate);
    !candidate.is_empty()
        && (candidate == needle || candidate.contains(needle) || needle.contains(&candidate))
}

unsafe fn choose_browser_content_window(
    app: AXUIElementRef,
    windows: &CFArray<*const c_void>,
) -> Option<AXUIElementRef> {
    let focused = copy_attribute_value(app, "AXFocusedWindow")
        .map(|value| CFType::wrap_under_create_rule(value));
    let main = copy_attribute_value(app, "AXMainWindow")
        .map(|value| CFType::wrap_under_create_rule(value));
    let mut best: Option<((u8, i32), AXUIElementRef)> = None;
    for index in 0..windows.len() {
        let Some(window) = windows
            .ax_element(index as isize)
        else {
            continue;
        };
        if window.is_null() {
            continue;
        }
        let role = copy_attribute_string(window, "AXRole").unwrap_or_default();
        if role != "AXWindow" {
            continue;
        }
        let subrole = copy_attribute_string(window, "AXSubrole").unwrap_or_default();
        let child_count = copy_attribute_array(window, "AXChildren")
            .map(|children| children.len())
            .unwrap_or(0);
        let candidate = CFType::wrap_under_get_rule(window as CFTypeRef);
        let score = browser_content_window_rank(
            &subrole,
            child_count as usize,
            focused.as_ref() == Some(&candidate),
            main.as_ref() == Some(&candidate),
        );
        if best
            .map(|(best_score, _)| score > best_score)
            .unwrap_or(true)
        {
            best = Some((score, window));
        }
    }
    best.map(|(_, window)| window)
}

fn browser_content_window_rank(
    subrole: &str,
    child_count: usize,
    focused: bool,
    main: bool,
) -> (u8, i32) {
    // A single-tab Safari window has fewer children than a background window
    // with a tab bar. Child count must never choose that other window's X.
    // Keep the standard-window preference: Aside can focus an auxiliary
    // AXDialog while its main browser window still owns the active tab.
    let active = if subrole == "AXStandardWindow" {
        if focused { 2 } else { u8::from(main) }
    } else {
        0
    };
    let score = child_count as i32
        + if subrole == "AXStandardWindow" { 1000 } else { 0 }
        - if subrole == "AXDialog" && child_count <= 1 { 500 } else { 0 };
    (active, score)
}

unsafe fn scan_for_selected_tab_close(
    element: AXUIElementRef,
    prefer_left_edge: bool,
    inside_selected_tab: bool,
    state: &mut ScanState,
) {
    if state.found.is_some() || state.visited >= NATIVE_AX_SCAN_LIMIT || element.is_null() {
        return;
    }
    state.visited += 1;

    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if matches!(
        role.as_str(),
        "AXWebArea" | "AXMenuBar" | "AXMenu" | "AXMenuItem"
    ) {
        return;
    }

    let mut selected_here = inside_selected_tab;
    let is_tab_like = role == "AXRadioButton" || role == "AXTab";
    if is_tab_like && is_selected_tab(element) {
        selected_here = true;
        state.selected_tab_label = Some(tab_label(element));
        if let Some(frame) = element_frame(element) {
            let close_x = if prefer_left_edge {
                frame.x + TAB_CLOSE_EDGE_INSET.min(frame.width.max(1.0) / 2.0)
            } else {
                frame.x + frame.width - TAB_CLOSE_EDGE_INSET.min(frame.width.max(1.0) / 2.0)
            };
            let close_y = frame.y + frame.height / 2.0;
            state.inferred = Some(PetModeTargetPoint {
                x: close_x,
                y: close_y,
                kind: PetModeTargetKind::BrowserTabClose,
                confidence: PetModeTargetConfidence::Medium,
                diagnostic: "ax_selected_tab_edge".to_string(),
            });
        }
    }

    if role == "AXButton" && selected_here {
        let description = copy_attribute_string(element, "AXDescription").unwrap_or_default();
        let title = copy_attribute_string(element, "AXTitle").unwrap_or_default();
        if looks_like_close_label(&description) || looks_like_close_label(&title) {
            if let Some(frame) = element_frame(element) {
                state.found = Some(PetModeTargetPoint {
                    x: frame.x + frame.width / 2.0,
                    y: frame.y + frame.height / 2.0,
                    kind: PetModeTargetKind::BrowserTabClose,
                    confidence: PetModeTargetConfidence::High,
                    diagnostic: "ax_selected_tab_close".to_string(),
                });
                return;
            }
        }
    }

    let Some(children) = copy_attribute_array(element, "AXChildren") else {
        return;
    };
    let mut prioritized = Vec::new();
    let mut deferred = Vec::new();
    for index in 0..children.len() {
        let Some(child) = children
            .ax_element(index as isize)
        else {
            continue;
        };
        let child_role = copy_attribute_string(child, "AXRole").unwrap_or_default();
        if child_role == "AXTabGroup"
            || child_role == "AXRadioButton"
            || child_role == "AXTab"
            || child_role == "AXToolbar"
            || child_role == "AXGroup"
        {
            prioritized.push(child);
        } else {
            deferred.push(child);
        }
    }
    for child in prioritized.into_iter().chain(deferred) {
        scan_for_selected_tab_close(child, prefer_left_edge, selected_here, state);
        if state.found.is_some() || state.visited >= NATIVE_AX_SCAN_LIMIT {
            break;
        }
    }
}

unsafe fn is_selected_tab(element: AXUIElementRef) -> bool {
    if let Some(value) = copy_attribute_value(element, "AXSelected") {
        if cf_truthy(value) {
            CFRelease(value);
            return true;
        }
        CFRelease(value);
    }
    if let Some(value) = copy_attribute_value(element, "AXValue") {
        let selected = cf_truthy(value);
        CFRelease(value);
        return selected;
    }
    false
}

/// Chromium exposes the tab title as `AXDescription` on the tab button;
/// other engines use `AXTitle`. Either is the same string the scripting
/// interface reports as the tab's title.
unsafe fn tab_label(element: AXUIElementRef) -> String {
    let description = copy_attribute_string(element, "AXDescription").unwrap_or_default();
    if !description.trim().is_empty() {
        return description;
    }
    copy_attribute_string(element, "AXTitle").unwrap_or_default()
}

unsafe fn cf_truthy(value: CFTypeRef) -> bool {
    if value.is_null() {
        return false;
    }
    let cf_type = CFType::wrap_under_get_rule(value);
    if let Some(boolean) = cf_type.clone().downcast_into::<CFBoolean>() {
        return boolean == CFBoolean::true_value();
    }
    if let Some(number) = cf_type.clone().downcast_into::<CFNumber>() {
        if let Some(int_value) = number.to_i64() {
            return int_value != 0;
        }
        if let Some(float_value) = number.to_f64() {
            return float_value != 0.0;
        }
    }
    if let Some(string) = cf_type.downcast_into::<CFString>() {
        let text = string.to_string().to_ascii_lowercase();
        return matches!(text.as_str(), "1" | "true" | "on" | "yes");
    }
    false
}

unsafe fn element_frame(element: AXUIElementRef) -> Option<Rect> {
    let position = copy_attribute_value(element, "AXPosition")?;
    let size = copy_attribute_value(element, "AXSize")?;
    let mut point = CGPoint::default();
    let mut extent = CGSize::default();
    let ok_point = crate::commands::ax_values::is_ax_value(position as _)
        && AXValueGetValue(
            position as AXValueRef,
            KAX_VALUE_CGPOINT,
            &mut point as *mut CGPoint as *mut c_void,
        ) != 0;
    let ok_size = crate::commands::ax_values::is_ax_value(size as _)
        && AXValueGetValue(
            size as AXValueRef,
            KAX_VALUE_CGSIZE,
            &mut extent as *mut CGSize as *mut c_void,
        ) != 0;
    CFRelease(position);
    CFRelease(size);
    if !ok_point || !ok_size {
        return None;
    }
    Some(Rect {
        x: point.x,
        y: point.y,
        width: extent.width,
        height: extent.height,
    })
}

fn is_this_process(pid: i32) -> bool {
    i64::from(pid) == i64::from(std::process::id())
}

unsafe fn copy_attribute_value(element: AXUIElementRef, attribute: &str) -> Option<CFTypeRef> {
    let key = CFString::new(attribute);
    let mut value: CFTypeRef = ptr::null();
    let status = AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut value);
    if status != 0 || value.is_null() {
        return None;
    }
    Some(value)
}

unsafe fn copy_attribute_array(
    element: AXUIElementRef,
    attribute: &str,
) -> Option<CFArray<*const c_void>> {
    let value = copy_attribute_value(element, attribute)?;
    crate::commands::ax_values::owned_array(value)
}

unsafe fn copy_attribute_string(element: AXUIElementRef, attribute: &str) -> Option<String> {
    let value = copy_attribute_value(element, attribute)?;
    crate::commands::ax_values::owned_string(value)
}

fn looks_like_close_label(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("close") || lower.contains("닫기")
}

fn nsstring_to_string(value: &NSString) -> String {
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn front_safari_window_wins_over_a_larger_background_tab_strip() {
        // Observed in the native Sonoma guest: one front tab has 5 children;
        // a background window with two tabs has 6.
        let front = browser_content_window_rank("AXStandardWindow", 5, true, true);
        let background = browser_content_window_rank("AXStandardWindow", 6, false, false);
        assert!(front > background);
        assert!(browser_content_window_rank("AXStandardWindow", 5, false, true) > background);
    }

    #[test]
    fn focused_auxiliary_dialog_does_not_displace_the_main_browser_window() {
        let dialog = browser_content_window_rank("AXDialog", 1, true, false);
        let main = browser_content_window_rank("AXStandardWindow", 5, false, true);
        assert!(main > dialog);
        let focused = browser_content_window_rank("AXStandardWindow", 5, true, false);
        assert!(focused > browser_content_window_rank("AXStandardWindow", 6, false, true));
    }

    #[test]
    fn safari_prefers_left_edge_close_hotspot() {
        assert!(prefers_left_edge_close("Safari", Some("Safari")));
        assert!(!prefers_left_edge_close("Aside", Some("Aside")));
        assert!(!prefers_left_edge_close("Google Chrome", None));
    }

    #[test]
    fn app_name_matching_accepts_bundle_style_aliases() {
        assert!(app_name_matches("aside", "Aside"));
        assert!(app_name_matches("aside", "Aside Browser"));
        assert!(app_name_matches("google chrome", "Google Chrome.app"));
    }
}
