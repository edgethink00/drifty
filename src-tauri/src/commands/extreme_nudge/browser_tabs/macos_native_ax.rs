//! Native Accessibility close adapter for browsers whose selected tab has no
//! scripted close: the Firefox family, Zen, and Whale.
//!
//! Resolution and action are deliberately separate. Pet Mode preflights the
//! exact close this adapter would perform before the cat runs toward the tab,
//! so the paw never acts out a close that the adapter is going to refuse.

use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use objc2::rc::autoreleasepool;
use objc2_app_kit::NSWorkspace;
use std::{
    ffi::c_void,
    ptr, thread,
    time::{Duration, Instant},
};

const SCAN_LIMIT: usize = 900;
const TAB_BUTTON_SCAN_LIMIT: usize = 64;
/// Firefox-family DOM ids reach macOS Accessibility as `AXDOMIdentifier`.
/// Unlike visible labels and tooltips they do not follow the browser's UI
/// language, so a German or Japanese Firefox resolves the same controls.
const ADDRESS_FIELD_DOM_ID: &str = "urlbar-input";
const TAB_STRIP_DOM_ID: &str = "tabbrowser-tabs";
/// Hotspot inset for a close that is an action on the tab itself rather than
/// a separate control with its own frame.
const INFERRED_CLOSE_EDGE_INSET: f64 = 14.0;
/// Pinned and collapsed vertical tabs are icon-sized and never show a close
/// button; the only button they can expose is the audio toggle.
const STRUCTURAL_CLOSE_MIN_TAB_WIDTH: f64 = 60.0;
/// Firefox draws the close button against the tab's end edge. Measured gaps in
/// Firefox 156: 6pt on horizontal tabs, 13pt on vertical tabs, and 17pt on
/// vertical tabs at touch density. The audio toggle is excluded by its place
/// before the title, not by this distance.
const STRUCTURAL_CLOSE_MAX_EDGE_GAP: f64 = 24.0;
const FRAME_TOLERANCE: f64 = 2.0;
/// How long a close waits for a Firefox-family browser to build the
/// accessibility tree it was just asked for. The toolbar appeared within 1s in
/// Firefox 156 QA.
const ACCESSIBILITY_WAKE_TIMEOUT: Duration = Duration::from_millis(1500);
const ACCESSIBILITY_WAKE_POLL: Duration = Duration::from_millis(100);
/// How long a close waits for the front address to change. Zen 1.22 animates
/// the tab away and still showed the closed page 250ms after the press, so a
/// single early check reported a close that did happen as a failure.
const POST_CLOSE_VERIFY_TIMEOUT: Duration = Duration::from_millis(1500);
const POST_CLOSE_VERIFY_POLL: Duration = Duration::from_millis(125);
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
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementCopyActionNames(element: AXUIElementRef, names: *mut CFArrayRef) -> AXError;
    fn AXUIElementCopyActionDescription(
        element: AXUIElementRef,
        action: CFStringRef,
        description: *mut CFStringRef,
    ) -> AXError;
    fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    fn AXValueGetValue(value: AXValueRef, the_type: u32, value_ptr: *mut c_void) -> u8;
    fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
    fn CFRelease(cf: CFTypeRef);
}

/// The point Pet Mode should touch for the close that [`close_frontmost_tab`]
/// would perform right now.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::commands) struct NativeAxCloseHotspot {
    pub(in crate::commands) x: f64,
    pub(in crate::commands) y: f64,
    /// True when the point is the centre of the control the close presses;
    /// false when it is inferred from the selected tab's frame.
    pub(in crate::commands) exact: bool,
    pub(in crate::commands) diagnostic: String,
}

pub(super) fn preflight_frontmost_tab(
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
    diagnostic_namespace: &str,
) -> Result<NativeAxCloseHotspot, String> {
    with_frontmost_window(browser_name, diagnostic_namespace, |_app, window| {
        // SAFETY: `window` stays retained by `with_frontmost_window` for the
        // whole closure; the resolution retains every element it keeps.
        unsafe {
            let resolution = resolve_close(
                window,
                browser_name,
                site_url,
                site_domain,
                diagnostic_namespace,
            )?;
            close_hotspot(
                resolution.control.kind(),
                resolution.control_frame,
                resolution.tab_frame,
                diagnostic_namespace,
            )
        }
    })
}

pub(super) fn close_frontmost_tab(
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
    diagnostic_namespace: &str,
) -> Result<String, String> {
    with_frontmost_window(browser_name, diagnostic_namespace, |app, window| {
        // SAFETY: `app` and `window` stay retained by `with_frontmost_window`
        // for the whole closure; the resolution retains every element it keeps.
        unsafe {
            let resolution = resolve_close(
                window,
                browser_name,
                site_url,
                site_domain,
                diagnostic_namespace,
            )?;
            let surface = perform_close(app, window, &resolution.control)
                .ok_or_else(|| format!("{diagnostic_namespace}_close_action_failed"))?;
            let deadline = Instant::now() + POST_CLOSE_VERIFY_TIMEOUT;
            loop {
                thread::sleep(POST_CLOSE_VERIFY_POLL);
                if current_address(window, allows_search_address_label(browser_name)).as_deref()
                    != Some(resolution.address_before.as_str())
                {
                    break;
                }
                if Instant::now() >= deadline {
                    return Err(format!(
                        "{diagnostic_namespace}_post_close_target_still_frontmost"
                    ));
                }
            }
            let suffix = match surface {
                CloseSurface::Tab => "front_tab",
                CloseSurface::StructuralTab => "structural_front_tab",
                CloseSurface::LastTabWindow => "last_tab_window",
            };
            Ok(format!("{diagnostic_namespace}_{suffix}"))
        }
    })
}

fn with_frontmost_window<T>(
    browser_name: &str,
    diagnostic_namespace: &str,
    body: impl FnOnce(AXUIElementRef, AXUIElementRef) -> Result<T, String>,
) -> Result<T, String> {
    let pid = active_browser_pid(browser_name)
        .ok_or_else(|| format!("{diagnostic_namespace}_not_frontmost"))?;

    // SAFETY: The application element is created under the CoreFoundation
    // create rule and released before this function returns. The focused
    // window is a copied value released after `body` finishes with it.
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return Err(format!("{diagnostic_namespace}_application_unavailable"));
        }
        if builds_accessibility_on_request(browser_name) {
            wake_accessibility_tree(app, allows_search_address_label(browser_name));
        }
        let result = match focused_content_window(app) {
            Some(window) => {
                let result = body(app, window);
                CFRelease(window as CFTypeRef);
                result
            }
            None => Err(format!("{diagnostic_namespace}_no_front_window")),
        };
        CFRelease(app as CFTypeRef);
        result
    }
}

fn allows_search_address_label(browser_name: &str) -> bool {
    browser_name == "Zen"
}

/// Firefox-family browsers build their accessibility tree only after an
/// assistive client asks for one. Until then a window exposes nothing but its
/// title-bar buttons, so neither the address nor the tab controls can be
/// read. Observed in Firefox 156 with the user's own profile: every close and
/// preflight failed with `no_address_candidate` until something (VoiceOver, or
/// Pet Mode's seat scan when the cat happened to sit on the browser) had set
/// `AXEnhancedUserInterface`. `AXManualAccessibility` is not settable there.
fn builds_accessibility_on_request(browser_name: &str) -> bool {
    matches!(
        browser_name,
        "Firefox" | "Firefox Developer Edition" | "Floorp" | "Zen"
    )
}

/// Asks a Firefox-family browser for its accessibility tree when its focused
/// window exposes only title-bar buttons, then waits briefly for the address
/// field. A browser whose tree is already built is left alone.
unsafe fn wake_accessibility_tree(app: AXUIElementRef, allow_search_label: bool) {
    let Some(window) = focused_content_window(app) else {
        return;
    };
    let asleep = window_exposes_only_title_bar(window);
    CFRelease(window as CFTypeRef);
    if !asleep {
        return;
    }
    let attribute = CFString::new("AXEnhancedUserInterface");
    if AXUIElementSetAttributeValue(
        app,
        attribute.as_concrete_TypeRef(),
        CFBoolean::true_value().as_CFTypeRef(),
    ) != 0
    {
        return;
    }
    let deadline = Instant::now() + ACCESSIBILITY_WAKE_TIMEOUT;
    while Instant::now() < deadline {
        thread::sleep(ACCESSIBILITY_WAKE_POLL);
        let Some(window) = focused_content_window(app) else {
            continue;
        };
        let readable = current_address(window, allow_search_label).is_some();
        CFRelease(window as CFTypeRef);
        if readable {
            return;
        }
    }
}

unsafe fn window_exposes_only_title_bar(window: AXUIElementRef) -> bool {
    let Some(children) = copy_attribute_array(window, "AXChildren") else {
        return true;
    };
    let roles: Vec<String> = (0..children.len())
        .filter_map(|index| children.get(index as isize))
        .map(|child| copy_attribute_string(*child as AXUIElementRef, "AXRole").unwrap_or_default())
        .collect();
    exposes_only_title_bar(&roles)
}

fn exposes_only_title_bar(child_roles: &[String]) -> bool {
    child_roles.iter().all(|role| role == "AXButton")
}

/// Browsers whose tab close button can be recognised by its position when its
/// label is in a language the label matcher does not know. Zen 1.22 shows the
/// same selected-tab close button inside the same tab strip; its context-menu
/// close stays as the fallback for builds without one.
fn uses_structural_close(browser_name: &str) -> bool {
    matches!(
        browser_name,
        "Firefox" | "Firefox Developer Edition" | "Floorp" | "Zen"
    )
}

/// Browsers whose tested builds expose no direct selected-tab close action.
fn uses_context_menu_close(browser_name: &str) -> bool {
    matches!(browser_name, "Whale" | "Zen")
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Rect {
    fn max_x(self) -> f64 {
        self.x + self.width
    }

    fn max_y(self) -> f64 {
        self.y + self.height
    }

    fn center(self) -> (f64, f64) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }

    fn is_positive(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.width > 0.0
            && self.height > 0.0
    }

    fn contains(self, inner: Rect, tolerance: f64) -> bool {
        inner.x >= self.x - tolerance
            && inner.max_x() <= self.max_x() + tolerance
            && inner.y >= self.y - tolerance
            && inner.max_y() <= self.max_y() + tolerance
    }
}

/// An AX element borrowed from a CoreFoundation container, retained so it
/// outlives the container it was read from.
struct OwnedElement(AXUIElementRef);

impl OwnedElement {
    unsafe fn retain(element: AXUIElementRef) -> Self {
        CFRetain(element as CFTypeRef);
        Self(element)
    }

    fn get(&self) -> AXUIElementRef {
        self.0
    }
}

impl Drop for OwnedElement {
    fn drop(&mut self) {
        // SAFETY: `retain` took exactly one reference for this value.
        unsafe { CFRelease(self.0 as CFTypeRef) }
    }
}

enum CloseControl {
    /// A close action exposed by the selected tab or one of its descendants.
    Action {
        element: OwnedElement,
        action: CFString,
    },
    /// The selected tab's own close button. `structural` means it was
    /// recognised by position because its label is in an unknown language.
    Button {
        element: OwnedElement,
        structural: bool,
    },
    /// Zen and Whale: the selected tab's exact `Close Tab` context-menu item.
    ContextMenu { tab: OwnedElement },
    /// The validated window holds exactly one tab and exposes no tab close.
    LastTabWindow,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CloseControlKind {
    Action,
    LabelledButton,
    StructuralButton,
    ContextMenu,
    LastTabWindow,
}

impl CloseControl {
    fn kind(&self) -> CloseControlKind {
        match self {
            Self::Action { .. } => CloseControlKind::Action,
            Self::Button {
                structural: false, ..
            } => CloseControlKind::LabelledButton,
            Self::Button {
                structural: true, ..
            } => CloseControlKind::StructuralButton,
            Self::ContextMenu { .. } => CloseControlKind::ContextMenu,
            Self::LastTabWindow => CloseControlKind::LastTabWindow,
        }
    }
}

struct CloseResolution {
    address_before: String,
    control: CloseControl,
    control_frame: Option<Rect>,
    tab_frame: Option<Rect>,
}

enum CloseSurface {
    Tab,
    StructuralTab,
    LastTabWindow,
}

/// Validates the front address and chooses the one control the close will
/// press. Nothing here performs an action.
unsafe fn resolve_close(
    window: AXUIElementRef,
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
    diagnostic_namespace: &str,
) -> Result<CloseResolution, String> {
    let address_before = current_address(window, allows_search_address_label(browser_name))
        .ok_or_else(|| format!("{diagnostic_namespace}_no_address_candidate"))?;
    if !exact_url_matches(&address_before, site_url)
        && !domain_matches(&address_before, site_domain)
    {
        return Err(format!("{diagnostic_namespace}_target_mismatch"));
    }

    let mut visited = 0;
    if let Some(found) = find_labelled_close(window, None, &mut visited) {
        return Ok(CloseResolution {
            address_before,
            control: found.control,
            control_frame: found.control_frame,
            tab_frame: found.tab_frame,
        });
    }

    if uses_structural_close(browser_name) {
        if let Some(found) = find_structural_close(window) {
            return Ok(CloseResolution {
                address_before,
                control: CloseControl::Button {
                    element: found.button,
                    structural: true,
                },
                control_frame: Some(found.button_frame),
                tab_frame: Some(found.tab_frame),
            });
        }
    }

    if uses_context_menu_close(browser_name) {
        let mut visited = 0;
        if let Some(tab) = find_first_selected_tab(window, &mut visited) {
            let tab_frame = element_frame(tab.get());
            return Ok(CloseResolution {
                address_before,
                control: CloseControl::ContextMenu { tab },
                control_frame: None,
                tab_frame,
            });
        }
    }

    // Firefox-family browsers can retain one tab element without a close
    // action. Closing that exact, already-validated window is the browser's
    // native equivalent of closing its last tab. Never take this fallback if
    // the AX tree exposes zero or multiple tabs: an unknown hierarchy must fail
    // closed instead of risking an unrelated window.
    if window_holds_single_tab(window) {
        let mut visited = 0;
        let tab_frame =
            find_first_selected_tab(window, &mut visited).and_then(|tab| element_frame(tab.get()));
        return Ok(CloseResolution {
            address_before,
            control: CloseControl::LastTabWindow,
            control_frame: window_close_button_frame(window),
            tab_frame,
        });
    }

    Err(format!("{diagnostic_namespace}_no_close_action"))
}

unsafe fn perform_close(
    app: AXUIElementRef,
    window: AXUIElementRef,
    control: &CloseControl,
) -> Option<CloseSurface> {
    match control {
        CloseControl::Action { element, action } => {
            (AXUIElementPerformAction(element.get(), action.as_concrete_TypeRef()) == 0)
                .then_some(CloseSurface::Tab)
        }
        CloseControl::Button {
            element,
            structural,
        } => perform_named_action(element.get(), "AXPress").then_some(if *structural {
            CloseSurface::StructuralTab
        } else {
            CloseSurface::Tab
        }),
        CloseControl::ContextMenu { tab } => {
            if perform_named_action(tab.get(), "AXShowMenu") {
                thread::sleep(Duration::from_millis(100));
                let mut visited = 0;
                if press_exact_close_tab_menu_item(app, &mut visited) {
                    return Some(CloseSurface::Tab);
                }
                let mut visited = 0;
                cancel_open_menu(app, &mut visited);
            }
            (window_holds_single_tab(window) && perform_window_close(window))
                .then_some(CloseSurface::LastTabWindow)
        }
        CloseControl::LastTabWindow => {
            perform_window_close(window).then_some(CloseSurface::LastTabWindow)
        }
    }
}

/// Pure hotspot choice so the geometry contract is testable without AX.
fn close_hotspot(
    kind: CloseControlKind,
    control_frame: Option<Rect>,
    tab_frame: Option<Rect>,
    diagnostic_namespace: &str,
) -> Result<NativeAxCloseHotspot, String> {
    let exact_suffix = match kind {
        CloseControlKind::LabelledButton => Some("close_button"),
        CloseControlKind::StructuralButton => Some("structural_close_button"),
        CloseControlKind::LastTabWindow => Some("window_close_button"),
        CloseControlKind::Action | CloseControlKind::ContextMenu => None,
    };
    if let (Some(suffix), Some(frame)) = (
        exact_suffix,
        control_frame.filter(|frame| frame.is_positive()),
    ) {
        let (x, y) = frame.center();
        return Ok(NativeAxCloseHotspot {
            x,
            y,
            exact: true,
            diagnostic: format!("{diagnostic_namespace}_{suffix}"),
        });
    }
    let tab = tab_frame
        .filter(|frame| frame.is_positive())
        .ok_or_else(|| format!("{diagnostic_namespace}_no_close_hotspot"))?;
    Ok(NativeAxCloseHotspot {
        x: tab.max_x() - INFERRED_CLOSE_EDGE_INSET.min(tab.width / 2.0),
        y: tab.y + tab.height / 2.0,
        exact: false,
        diagnostic: format!("{diagnostic_namespace}_selected_tab_edge"),
    })
}

/// The parts of a selected tab that the structural close rule reads, in
/// document order.
#[derive(Clone, Copy, Debug, PartialEq)]
enum TabPart {
    /// Text outside any button: the tab's title.
    Title,
    /// A button, with its frame when readable.
    Button(Option<Rect>),
}

/// Picks the selected tab's close button by structure. A Firefox tab lays out
/// its site icon and audio toggle, then its title, then its close button, and
/// a right-to-left layout mirrors only the positions, never that order. The
/// close button is therefore the last button, it follows the title, and it
/// sits against one of the tab's edges. Position alone cannot separate the
/// two: in Firefox 156 the audio toggle sits 10pt from the start edge and the
/// close button 6pt from the end edge. Requiring the title first rejects a
/// lone audio toggle on a close-less tab instead of pressing it.
fn structural_close_index(tab: Rect, parts: &[TabPart]) -> Option<usize> {
    if !tab.is_positive() || tab.width < STRUCTURAL_CLOSE_MIN_TAB_WIDTH {
        return None;
    }
    let index = parts
        .iter()
        .rposition(|part| matches!(part, TabPart::Button(_)))?;
    if !parts[..index].contains(&TabPart::Title) {
        return None;
    }
    let TabPart::Button(Some(candidate)) = parts[index] else {
        return None;
    };
    if !candidate.is_positive() || !tab.contains(candidate, FRAME_TOLERANCE) {
        return None;
    }
    let leading_gap = candidate.x - tab.x;
    let trailing_gap = tab.max_x() - candidate.max_x();
    let at_trailing_edge = trailing_gap <= leading_gap;
    let edge_gap = leading_gap.min(trailing_gap).max(0.0);
    if edge_gap > STRUCTURAL_CLOSE_MAX_EDGE_GAP {
        return None;
    }
    let competitor_at_same_edge = parts[..index]
        .iter()
        .filter_map(|part| match part {
            TabPart::Button(frame) => *frame,
            TabPart::Title => None,
        })
        .any(|other| {
            let other_gap = if at_trailing_edge {
                tab.max_x() - other.max_x()
            } else {
                other.x - tab.x
            };
            other_gap <= edge_gap + FRAME_TOLERANCE
        });
    (!competitor_at_same_edge).then_some(index)
}

struct LabelledClose {
    control: CloseControl,
    control_frame: Option<Rect>,
    tab_frame: Option<Rect>,
}

/// Finds a close action or close-labelled button inside the first selected
/// tab subtree that offers one, in document order.
unsafe fn find_labelled_close(
    element: AXUIElementRef,
    selected_tab: Option<AXUIElementRef>,
    visited: &mut usize,
) -> Option<LabelledClose> {
    if element.is_null() || *visited >= SCAN_LIMIT {
        return None;
    }
    *visited += 1;
    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if is_skipped_subtree_role(&role) {
        return None;
    }
    let selected_tab = selected_tab
        .or_else(|| (is_tab_role(&role) && is_selected_tab(element)).then_some(element));
    if let Some(tab) = selected_tab {
        if let Some(action) = labelled_close_action(element) {
            return Some(LabelledClose {
                control: CloseControl::Action {
                    element: OwnedElement::retain(element),
                    action,
                },
                control_frame: None,
                tab_frame: element_frame(tab),
            });
        }
        if role == "AXButton" && has_close_label(element) {
            return Some(LabelledClose {
                control: CloseControl::Button {
                    element: OwnedElement::retain(element),
                    structural: false,
                },
                control_frame: element_frame(element),
                tab_frame: element_frame(tab),
            });
        }
    }
    let children = copy_attribute_array(element, "AXChildren")?;
    for index in 0..children.len() {
        let Some(child) = children
            .get(index as isize)
            .map(|value| *value as AXUIElementRef)
        else {
            continue;
        };
        if let Some(found) = find_labelled_close(child, selected_tab, visited) {
            return Some(found);
        }
    }
    None
}

struct StructuralClose {
    button: OwnedElement,
    button_frame: Rect,
    tab_frame: Rect,
}

unsafe fn find_structural_close(window: AXUIElementRef) -> Option<StructuralClose> {
    let mut visited = 0;
    let tab = find_selected_tab_in_strip(window, false, &mut visited)?;
    let tab_frame = element_frame(tab.get())?;
    let mut parts = Vec::new();
    let mut visited = 0;
    collect_tab_parts(tab.get(), false, &mut parts, &mut visited);
    let layout: Vec<TabPart> = parts.iter().map(|collected| collected.part).collect();
    let index = structural_close_index(tab_frame, &layout)?;
    let TabPart::Button(Some(button_frame)) = layout[index] else {
        return None;
    };
    let button = parts.swap_remove(index).button?;
    Some(StructuralClose {
        button,
        button_frame,
        tab_frame,
    })
}

/// Only a tab inside Firefox's own tab strip may use the structural rule.
unsafe fn find_selected_tab_in_strip(
    element: AXUIElementRef,
    inside_strip: bool,
    visited: &mut usize,
) -> Option<OwnedElement> {
    if element.is_null() || *visited >= SCAN_LIMIT {
        return None;
    }
    *visited += 1;
    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if is_skipped_subtree_role(&role) {
        return None;
    }
    if inside_strip && is_tab_role(&role) {
        // Unselected tabs are leaves for this search; their buttons are never
        // candidates.
        return is_selected_tab(element).then(|| OwnedElement::retain(element));
    }
    let inside_strip = inside_strip
        || (may_contain_tabs(&role)
            && dom_identifier(element).as_deref() == Some(TAB_STRIP_DOM_ID));
    let children = copy_attribute_array(element, "AXChildren")?;
    for index in 0..children.len() {
        let Some(child) = children
            .get(index as isize)
            .map(|value| *value as AXUIElementRef)
        else {
            continue;
        };
        if let Some(found) = find_selected_tab_in_strip(child, inside_strip, visited) {
            return Some(found);
        }
    }
    None
}

struct CollectedTabPart {
    part: TabPart,
    button: Option<OwnedElement>,
}

/// Collects the selected tab's buttons and title text in document order.
/// Text inside a button is that button's own label, not the tab title.
unsafe fn collect_tab_parts(
    element: AXUIElementRef,
    inside_button: bool,
    parts: &mut Vec<CollectedTabPart>,
    visited: &mut usize,
) {
    let Some(children) = copy_attribute_array(element, "AXChildren") else {
        return;
    };
    for index in 0..children.len() {
        if *visited >= TAB_BUTTON_SCAN_LIMIT {
            return;
        }
        let Some(child) = children
            .get(index as isize)
            .map(|value| *value as AXUIElementRef)
        else {
            continue;
        };
        if child.is_null() {
            continue;
        }
        *visited += 1;
        let role = copy_attribute_string(child, "AXRole").unwrap_or_default();
        if is_skipped_subtree_role(&role) {
            continue;
        }
        let is_button = role == "AXButton";
        if is_button {
            parts.push(CollectedTabPart {
                part: TabPart::Button(element_frame(child)),
                button: Some(OwnedElement::retain(child)),
            });
        } else if role == "AXStaticText" && !inside_button {
            parts.push(CollectedTabPart {
                part: TabPart::Title,
                button: None,
            });
        }
        collect_tab_parts(child, inside_button || is_button, parts, visited);
    }
}

unsafe fn find_first_selected_tab(
    element: AXUIElementRef,
    visited: &mut usize,
) -> Option<OwnedElement> {
    if element.is_null() || *visited >= SCAN_LIMIT {
        return None;
    }
    *visited += 1;
    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if matches!(role.as_str(), "AXWebArea" | "AXMenuBar" | "AXMenu") {
        return None;
    }
    if is_tab_role(&role) && is_selected_tab(element) {
        return Some(OwnedElement::retain(element));
    }
    let children = copy_attribute_array(element, "AXChildren")?;
    for index in 0..children.len() {
        let Some(child) = children
            .get(index as isize)
            .map(|value| *value as AXUIElementRef)
        else {
            continue;
        };
        if let Some(found) = find_first_selected_tab(child, visited) {
            return Some(found);
        }
    }
    None
}

unsafe fn window_holds_single_tab(window: AXUIElementRef) -> bool {
    let mut tab_count = 0;
    let mut visited = 0;
    count_tab_elements(window, &mut tab_count, &mut visited);
    is_last_tab_window_candidate(tab_count) && window_has_close_button(window)
}

fn is_last_tab_window_candidate(tab_count: usize) -> bool {
    tab_count == 1
}

fn is_tab_role(role: &str) -> bool {
    matches!(role, "AXRadioButton" | "AXTab")
}

fn is_skipped_subtree_role(role: &str) -> bool {
    matches!(role, "AXWebArea" | "AXMenuBar" | "AXMenu" | "AXMenuItem")
}

/// Leaf controls cannot be the tab strip; skipping their DOM id read keeps the
/// scan within the tracker timeout on long toolbars.
fn may_contain_tabs(role: &str) -> bool {
    !matches!(
        role,
        "AXButton"
            | "AXCheckBox"
            | "AXComboBox"
            | "AXImage"
            | "AXLink"
            | "AXMenuButton"
            | "AXPopUpButton"
            | "AXRadioButton"
            | "AXStaticText"
            | "AXTab"
            | "AXTextField"
    )
}

fn active_browser_pid(browser_name: &str) -> Option<PidT> {
    let expected = browser_name.trim().to_ascii_lowercase();
    autoreleasepool(|_| {
        let applications = NSWorkspace::sharedWorkspace().runningApplications();
        for index in 0..applications.count() {
            let application = applications.objectAtIndex(index);
            if !application.isActive() {
                continue;
            }
            let Some(name) = application.localizedName() else {
                continue;
            };
            let normalized = name.to_string().trim().to_ascii_lowercase();
            if normalized == expected || (expected == "whale" && normalized == "naver whale") {
                return Some(application.processIdentifier());
            }
        }
        None
    })
}

unsafe fn current_address(window: AXUIElementRef, allow_search_label: bool) -> Option<String> {
    let mut visited = 0;
    find_address_value(window, allow_search_label, &mut visited)
}

unsafe fn focused_content_window(app: AXUIElementRef) -> Option<AXUIElementRef> {
    for attribute in ["AXFocusedWindow", "AXMainWindow"] {
        let Some(value) = copy_attribute_value(app, attribute) else {
            continue;
        };
        let window = value as AXUIElementRef;
        if copy_attribute_string(window, "AXRole").as_deref() == Some("AXWindow") {
            return Some(window);
        }
        CFRelease(value);
    }
    None
}

unsafe fn find_address_value(
    element: AXUIElementRef,
    allow_search_label: bool,
    visited: &mut usize,
) -> Option<String> {
    if element.is_null() || *visited >= SCAN_LIMIT {
        return None;
    }
    *visited += 1;
    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if is_skipped_subtree_role(&role) {
        return None;
    }
    if matches!(role.as_str(), "AXTextField" | "AXComboBox") {
        let description = copy_attribute_string(element, "AXDescription").unwrap_or_default();
        if looks_like_address_label(&description, allow_search_label)
            || dom_identifier(element).as_deref() == Some(ADDRESS_FIELD_DOM_ID)
        {
            if let Some(value) = copy_attribute_string(element, "AXValue") {
                if !value.trim().is_empty() {
                    return Some(value.trim().to_string());
                }
            }
        }
    }
    // The tab strip can hold hundreds of tabs and never contains the address
    // field, so walking it only spends the scan budget.
    if role == "AXTabGroup" && dom_identifier(element).as_deref() == Some(TAB_STRIP_DOM_ID) {
        return None;
    }
    let children = copy_attribute_array(element, "AXChildren")?;
    for index in 0..children.len() {
        let child = *children.get(index as isize)? as AXUIElementRef;
        if let Some(value) = find_address_value(child, allow_search_label, visited) {
            return Some(value);
        }
    }
    None
}

unsafe fn press_exact_close_tab_menu_item(element: AXUIElementRef, visited: &mut usize) -> bool {
    if element.is_null() || *visited >= SCAN_LIMIT {
        return false;
    }
    *visited += 1;
    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if role == "AXWebArea" {
        return false;
    }
    if role == "AXMenuItem" {
        let title = copy_attribute_string(element, "AXTitle").unwrap_or_default();
        if is_exact_close_tab_menu_label(&title) && perform_named_action(element, "AXPress") {
            return true;
        }
    }
    let Some(children) = copy_attribute_array(element, "AXChildren") else {
        return false;
    };
    for index in 0..children.len() {
        let Some(child) = children
            .get(index as isize)
            .map(|value| *value as AXUIElementRef)
        else {
            continue;
        };
        if press_exact_close_tab_menu_item(child, visited) {
            return true;
        }
    }
    false
}

unsafe fn cancel_open_menu(element: AXUIElementRef, visited: &mut usize) {
    if element.is_null() || *visited >= SCAN_LIMIT {
        return;
    }
    *visited += 1;
    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if role == "AXWebArea" {
        return;
    }
    if role == "AXMenu" && perform_named_action(element, "AXCancel") {
        return;
    }
    let Some(children) = copy_attribute_array(element, "AXChildren") else {
        return;
    };
    for index in 0..children.len() {
        let Some(child) = children
            .get(index as isize)
            .map(|value| *value as AXUIElementRef)
        else {
            continue;
        };
        cancel_open_menu(child, visited);
    }
}

unsafe fn count_tab_elements(element: AXUIElementRef, tab_count: &mut usize, visited: &mut usize) {
    if element.is_null() || *visited >= SCAN_LIMIT || *tab_count > 1 {
        return;
    }
    *visited += 1;
    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if is_skipped_subtree_role(&role) {
        return;
    }
    if is_tab_role(&role) {
        *tab_count += 1;
    }
    let Some(children) = copy_attribute_array(element, "AXChildren") else {
        return;
    };
    for index in 0..children.len() {
        let Some(child) = children
            .get(index as isize)
            .map(|value| *value as AXUIElementRef)
        else {
            continue;
        };
        count_tab_elements(child, tab_count, visited);
    }
}

unsafe fn window_has_close_button(window: AXUIElementRef) -> bool {
    let Some(close_button) = copy_attribute_value(window, "AXCloseButton") else {
        return false;
    };
    CFRelease(close_button);
    true
}

unsafe fn window_close_button_frame(window: AXUIElementRef) -> Option<Rect> {
    let close_button = copy_attribute_value(window, "AXCloseButton")?;
    let frame = element_frame(close_button as AXUIElementRef);
    CFRelease(close_button);
    frame
}

unsafe fn perform_window_close(window: AXUIElementRef) -> bool {
    let Some(close_button) = copy_attribute_value(window, "AXCloseButton") else {
        return false;
    };
    let performed = perform_named_action(close_button as AXUIElementRef, "AXPress");
    CFRelease(close_button);
    performed
}

unsafe fn labelled_close_action(element: AXUIElementRef) -> Option<CFString> {
    let mut names_ref: CFArrayRef = ptr::null();
    if AXUIElementCopyActionNames(element, &mut names_ref) != 0 || names_ref.is_null() {
        return None;
    }
    let names = CFArray::<*const c_void>::wrap_under_create_rule(names_ref);
    for index in 0..names.len() {
        let Some(raw_action) = names.get(index as isize).map(|value| *value as CFStringRef) else {
            continue;
        };
        if raw_action.is_null() {
            continue;
        }
        let action = CFString::wrap_under_get_rule(raw_action);
        let description = copy_action_description(element, raw_action).unwrap_or_default();
        if looks_like_close_label(&action.to_string()) || looks_like_close_label(&description) {
            return Some(action);
        }
    }
    None
}

unsafe fn has_close_label(element: AXUIElementRef) -> bool {
    let description = copy_attribute_string(element, "AXDescription").unwrap_or_default();
    let title = copy_attribute_string(element, "AXTitle").unwrap_or_default();
    looks_like_close_label(&description) || looks_like_close_label(&title)
}

unsafe fn perform_named_action(element: AXUIElementRef, name: &str) -> bool {
    let action = CFString::new(name);
    AXUIElementPerformAction(element, action.as_concrete_TypeRef()) == 0
}

unsafe fn copy_action_description(element: AXUIElementRef, action: CFStringRef) -> Option<String> {
    let mut description_ref: CFStringRef = ptr::null();
    if AXUIElementCopyActionDescription(element, action, &mut description_ref) != 0
        || description_ref.is_null()
    {
        return None;
    }
    Some(CFString::wrap_under_create_rule(description_ref).to_string())
}

unsafe fn is_selected_tab(element: AXUIElementRef) -> bool {
    for attribute in ["AXSelected", "AXValue"] {
        let Some(value) = copy_attribute_value(element, attribute) else {
            continue;
        };
        let selected = cf_truthy(value);
        CFRelease(value);
        if selected {
            return true;
        }
    }
    false
}

unsafe fn cf_truthy(value: CFTypeRef) -> bool {
    let cf_type = CFType::wrap_under_get_rule(value);
    if let Some(boolean) = cf_type.clone().downcast_into::<CFBoolean>() {
        return boolean == CFBoolean::true_value();
    }
    if let Some(number) = cf_type.clone().downcast_into::<CFNumber>() {
        return number.to_i64().is_some_and(|value| value != 0);
    }
    if let Some(string) = cf_type.downcast_into::<CFString>() {
        return matches!(
            string.to_string().to_ascii_lowercase().as_str(),
            "1" | "true" | "on" | "yes"
        );
    }
    false
}

unsafe fn dom_identifier(element: AXUIElementRef) -> Option<String> {
    copy_attribute_string(element, "AXDOMIdentifier").filter(|value| !value.is_empty())
}

unsafe fn element_frame(element: AXUIElementRef) -> Option<Rect> {
    let position = copy_attribute_value(element, "AXPosition")?;
    let Some(size) = copy_attribute_value(element, "AXSize") else {
        CFRelease(position);
        return None;
    };
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
    (ok_point && ok_size).then_some(Rect {
        x: point.x,
        y: point.y,
        width: extent.width,
        height: extent.height,
    })
}

unsafe fn copy_attribute_value(element: AXUIElementRef, attribute: &str) -> Option<CFTypeRef> {
    let key = CFString::new(attribute);
    let mut value: CFTypeRef = ptr::null();
    let status = AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut value);
    (status == 0 && !value.is_null()).then_some(value)
}

unsafe fn copy_attribute_string(element: AXUIElementRef, attribute: &str) -> Option<String> {
    let value = copy_attribute_value(element, attribute)?;
    let cf_type = CFType::wrap_under_get_rule(value);
    let result = cf_type
        .downcast_into::<CFString>()
        .map(|value| value.to_string());
    CFRelease(value);
    result
}

unsafe fn copy_attribute_array(
    element: AXUIElementRef,
    attribute: &str,
) -> Option<CFArray<*const c_void>> {
    let value = copy_attribute_value(element, attribute)?;
    Some(CFArray::wrap_under_create_rule(value as CFArrayRef))
}

fn looks_like_address_label(value: &str, allow_search_label: bool) -> bool {
    let lowered = value.to_ascii_lowercase();
    lowered.contains("smart search")
        || lowered.contains("address")
        || lowered.contains("url")
        || value.contains("스마트 검색")
        || value.contains("주소")
        || (allow_search_label && lowered.contains("search"))
}

fn looks_like_close_label(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    (lowered.contains("close") && lowered.contains("tab"))
        || (value.contains("탭") && value.contains("닫기"))
}

fn is_exact_close_tab_menu_label(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "close tab" | "탭 닫기"
    )
}

fn exact_url_matches(current: &str, target: &str) -> bool {
    let current = current.trim();
    let target = target.trim();
    if current.is_empty() || target.is_empty() {
        return false;
    }
    current == target
        || target
            .strip_prefix("https://")
            .or_else(|| target.strip_prefix("http://"))
            .is_some_and(|schemaless| current == schemaless)
}

fn domain_matches(current: &str, target_domain: Option<&str>) -> bool {
    let Some(target) = super::normalized_site_domain(target_domain) else {
        return false;
    };
    super::site_domain_from_url(current).as_deref() == Some(target.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NAMESPACE: &str = "firefox_native_ax";

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    /// A 240pt horizontal Firefox tab: icon at the start, close at the end.
    fn horizontal_tab() -> Rect {
        rect(100.0, 40.0, 240.0, 36.0)
    }

    fn close_button_at_end() -> Rect {
        rect(310.0, 46.0, 24.0, 24.0)
    }

    /// The selected tab measured in German Firefox 156 while it played audio
    /// (2026-09-25 QA): 225pt wide, audio toggle 10pt from the start edge,
    /// title, close button 6pt from the end edge.
    fn measured_tab() -> Rect {
        rect(556.0, 25.0, 225.0, 44.0)
    }

    fn measured_audio_toggle() -> Rect {
        rect(566.0, 35.0, 24.0, 24.0)
    }

    fn measured_close_button() -> Rect {
        rect(757.0, 35.0, 18.0, 24.0)
    }

    /// The same tab mirrored for a right-to-left layout. Document order is
    /// unchanged: audio toggle, title, close button.
    fn mirrored_audio_toggle() -> Rect {
        rect(747.0, 35.0, 24.0, 24.0)
    }

    fn mirrored_close_button() -> Rect {
        rect(562.0, 35.0, 18.0, 24.0)
    }

    /// A selected vertical tab at touch density, measured in the same QA run:
    /// its close button sits 17pt from the end edge.
    fn measured_vertical_touch_tab() -> Rect {
        rect(0.0, 322.0, 239.0, 50.0)
    }

    fn measured_vertical_touch_audio_toggle() -> Rect {
        rect(39.0, 335.0, 24.0, 24.0)
    }

    fn measured_vertical_touch_close_button() -> Rect {
        rect(198.0, 335.0, 24.0, 24.0)
    }

    fn button(frame: Rect) -> TabPart {
        TabPart::Button(Some(frame))
    }

    #[test]
    fn strict_url_match_allows_only_scheme_omission() {
        assert!(exact_url_matches(
            "example.com/watch?v=1",
            "https://example.com/watch?v=1"
        ));
        assert!(!exact_url_matches(
            "example.com/watch?v=2",
            "https://example.com/watch?v=1"
        ));
    }

    #[test]
    fn close_labels_cover_supported_browser_locales() {
        assert!(looks_like_close_label("Close Tab"));
        assert!(looks_like_close_label("탭 1개 닫기"));
        assert!(looks_like_close_label(
            "Name:탭 닫기\nSelector:_closeButtonClicked:"
        ));
        assert!(!looks_like_close_label("AXPress"));
        assert!(is_exact_close_tab_menu_label("Close Tab"));
        assert!(is_exact_close_tab_menu_label("탭 닫기"));
        assert!(!is_exact_close_tab_menu_label("Close Other Tabs"));
    }

    #[test]
    fn localized_firefox_close_labels_need_the_structural_rule() {
        // Firefox's own `tabbrowser-close-tabs-button` strings (one tab). The
        // label matcher knows only English and Korean; every other UI language
        // reaches the close button through `structural_close_index`.
        for label in [
            "Tab schließen",
            "Fermer l’onglet",
            "Cerrar pestaña",
            "タブを閉じます",
            "关闭 1 个标签页",
            "Fechar aba",
        ] {
            assert!(!looks_like_close_label(label), "{label}");
        }
    }

    #[test]
    fn zen_search_label_is_accepted_only_for_zen_address_scans() {
        assert!(looks_like_address_label("Search...", true));
        assert!(!looks_like_address_label("Search...", false));
        assert!(looks_like_address_label("Address and search bar", false));
        // Localized Firefox address placeholders are found by DOM id instead.
        assert!(!looks_like_address_label(
            "Suche oder Adresse eingeben",
            false
        ));
    }

    #[test]
    fn last_tab_window_fallback_requires_exactly_one_visible_tab() {
        assert!(is_last_tab_window_candidate(1));
        assert!(!is_last_tab_window_candidate(0));
        assert!(!is_last_tab_window_candidate(2));
    }

    #[test]
    fn structural_close_picks_the_end_edge_button_after_the_audio_toggle() {
        let parts = [
            button(measured_audio_toggle()),
            TabPart::Title,
            button(measured_close_button()),
        ];
        assert_eq!(structural_close_index(measured_tab(), &parts), Some(2));
        assert_eq!(
            structural_close_index(
                measured_tab(),
                &[TabPart::Title, button(measured_close_button())]
            ),
            Some(1)
        );
    }

    #[test]
    fn structural_close_accepts_the_mirrored_right_to_left_layout() {
        assert_eq!(
            structural_close_index(
                measured_tab(),
                &[
                    button(mirrored_audio_toggle()),
                    TabPart::Title,
                    button(mirrored_close_button()),
                ]
            ),
            Some(2)
        );
    }

    #[test]
    fn structural_close_accepts_vertical_tabs_at_touch_density() {
        assert_eq!(
            structural_close_index(
                measured_vertical_touch_tab(),
                &[
                    button(measured_vertical_touch_audio_toggle()),
                    TabPart::Title,
                    button(measured_vertical_touch_close_button()),
                ]
            ),
            Some(2)
        );
        assert_eq!(
            structural_close_index(
                measured_vertical_touch_tab(),
                &[
                    button(measured_vertical_touch_audio_toggle()),
                    TabPart::Title
                ]
            ),
            None
        );
    }

    #[test]
    fn structural_close_never_presses_a_lone_audio_toggle() {
        // The measured toggle is as close to its edge as a close button would
        // be, so only its place before the title rules it out, in either
        // direction.
        for audio in [measured_audio_toggle(), mirrored_audio_toggle()] {
            assert_eq!(
                structural_close_index(measured_tab(), &[button(audio), TabPart::Title]),
                None
            );
        }
        // A pinned tab is icon-sized and has no close button at all.
        let pinned_tab = rect(100.0, 40.0, 36.0, 36.0);
        let pinned_audio = rect(106.0, 46.0, 24.0, 24.0);
        assert_eq!(
            structural_close_index(pinned_tab, &[button(pinned_audio), TabPart::Title]),
            None
        );
    }

    #[test]
    fn structural_close_requires_the_title_before_the_button() {
        // Without a title before it, even an end-edge button is not known to
        // be the close button.
        assert_eq!(
            structural_close_index(measured_tab(), &[button(measured_close_button())]),
            None
        );
        assert_eq!(
            structural_close_index(
                measured_tab(),
                &[button(measured_close_button()), TabPart::Title]
            ),
            None
        );
    }

    #[test]
    fn structural_close_fails_closed_on_unreadable_or_ambiguous_geometry() {
        assert_eq!(structural_close_index(measured_tab(), &[]), None);
        assert_eq!(
            structural_close_index(measured_tab(), &[TabPart::Title]),
            None
        );
        assert_eq!(
            structural_close_index(
                measured_tab(),
                &[
                    TabPart::Title,
                    button(measured_close_button()),
                    TabPart::Button(None)
                ]
            ),
            None
        );
        let outside_tab = rect(790.0, 35.0, 18.0, 24.0);
        assert_eq!(
            structural_close_index(measured_tab(), &[TabPart::Title, button(outside_tab)]),
            None
        );
        let second_end_button = rect(759.0, 35.0, 18.0, 24.0);
        assert_eq!(
            structural_close_index(
                measured_tab(),
                &[
                    TabPart::Title,
                    button(second_end_button),
                    button(measured_close_button())
                ]
            ),
            None
        );
        let empty = rect(757.0, 35.0, 0.0, 24.0);
        assert_eq!(
            structural_close_index(measured_tab(), &[TabPart::Title, button(empty)]),
            None
        );
        let middle_button = rect(660.0, 35.0, 18.0, 24.0);
        assert_eq!(
            structural_close_index(measured_tab(), &[TabPart::Title, button(middle_button)]),
            None
        );
    }

    #[test]
    fn hotspot_points_at_the_exact_control_the_close_presses() {
        let hotspot = close_hotspot(
            CloseControlKind::StructuralButton,
            Some(close_button_at_end()),
            Some(horizontal_tab()),
            NAMESPACE,
        )
        .unwrap();
        assert_eq!((hotspot.x, hotspot.y), (322.0, 58.0));
        assert!(hotspot.exact);
        assert_eq!(
            hotspot.diagnostic,
            "firefox_native_ax_structural_close_button"
        );

        let labelled = close_hotspot(
            CloseControlKind::LabelledButton,
            Some(close_button_at_end()),
            Some(horizontal_tab()),
            NAMESPACE,
        )
        .unwrap();
        assert_eq!(labelled.diagnostic, "firefox_native_ax_close_button");

        let window = close_hotspot(
            CloseControlKind::LastTabWindow,
            Some(rect(8.0, 8.0, 14.0, 14.0)),
            Some(horizontal_tab()),
            NAMESPACE,
        )
        .unwrap();
        assert_eq!((window.x, window.y), (15.0, 15.0));
        assert_eq!(window.diagnostic, "firefox_native_ax_window_close_button");
    }

    #[test]
    fn hotspot_infers_the_tab_end_for_actions_on_the_tab_itself() {
        for kind in [CloseControlKind::Action, CloseControlKind::ContextMenu] {
            let hotspot =
                close_hotspot(kind, None, Some(horizontal_tab()), "whale_native_ax").unwrap();
            assert_eq!((hotspot.x, hotspot.y), (326.0, 58.0));
            assert!(!hotspot.exact);
            assert_eq!(hotspot.diagnostic, "whale_native_ax_selected_tab_edge");
        }
        assert_eq!(
            close_hotspot(CloseControlKind::Action, None, None, NAMESPACE),
            Err("firefox_native_ax_no_close_hotspot".to_string())
        );
    }

    #[test]
    fn only_gecko_browsers_use_the_structural_close_rule() {
        for name in ["Firefox", "Firefox Developer Edition", "Floorp", "Zen"] {
            assert!(uses_structural_close(name), "{name}");
        }
        for name in ["Firefox", "Firefox Developer Edition", "Floorp"] {
            assert!(!uses_context_menu_close(name), "{name}");
        }
        assert!(!uses_structural_close("Whale"));
        for name in ["Zen", "Whale"] {
            assert!(uses_context_menu_close(name), "{name}");
        }
    }

    #[test]
    fn a_window_exposing_only_title_bar_buttons_has_no_tree_yet() {
        let roles = |values: &[&str]| {
            values
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        };
        // Firefox 156 before any assistive client asked: close, full screen,
        // minimize.
        assert!(exposes_only_title_bar(&roles(&[
            "AXButton", "AXButton", "AXButton"
        ])));
        assert!(exposes_only_title_bar(&[]));
        assert!(!exposes_only_title_bar(&roles(&[
            "AXGroup", "AXButton", "AXButton", "AXButton"
        ])));
        for name in ["Firefox", "Firefox Developer Edition", "Floorp", "Zen"] {
            assert!(builds_accessibility_on_request(name), "{name}");
        }
        assert!(!builds_accessibility_on_request("Whale"));
    }
}
