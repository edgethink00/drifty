use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use objc2::rc::autoreleasepool;
use objc2_app_kit::NSWorkspace;
use std::{ffi::c_void, ptr, thread, time::Duration};

const SCAN_LIMIT: usize = 900;

type AXUIElementRef = *const c_void;
type AXError = i32;
type PidT = i32;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: PidT) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: core_foundation::string::CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementCopyActionNames(element: AXUIElementRef, names: *mut CFArrayRef) -> AXError;
    fn AXUIElementCopyActionDescription(
        element: AXUIElementRef,
        action: CFStringRef,
        description: *mut CFStringRef,
    ) -> AXError;
    fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
    fn CFRelease(cf: CFTypeRef);
}

pub(super) fn close_frontmost_tab(
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
    diagnostic_namespace: &str,
) -> Result<String, String> {
    let pid = active_browser_pid(browser_name)
        .ok_or_else(|| format!("{diagnostic_namespace}_not_frontmost"))?;

    // SAFETY: The application element is created under the CoreFoundation
    // create rule and released before this function returns. All copied AX/CF
    // values are similarly wrapped or released in the helpers below.
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return Err(format!("{diagnostic_namespace}_application_unavailable"));
        }
        let allow_search_address_label = browser_name == "Zen";
        let result = close_frontmost_tab_in_app(
            app,
            browser_name,
            site_url,
            site_domain,
            allow_search_address_label,
            diagnostic_namespace,
        );
        CFRelease(app as CFTypeRef);
        result
    }
}

unsafe fn close_frontmost_tab_in_app(
    app: AXUIElementRef,
    browser_name: &str,
    site_url: &str,
    site_domain: Option<&str>,
    allow_search_address_label: bool,
    diagnostic_namespace: &str,
) -> Result<String, String> {
    let window = focused_content_window(app)
        .ok_or_else(|| format!("{diagnostic_namespace}_no_front_window"))?;
    let result = (|| {
        let address_before = current_address(window, allow_search_address_label)
            .ok_or_else(|| format!("{diagnostic_namespace}_no_address_candidate"))?;
        if !exact_url_matches(&address_before, site_url)
            && !domain_matches(&address_before, site_domain)
        {
            return Err(format!("{diagnostic_namespace}_target_mismatch"));
        }
        let Some(close_surface) =
            perform_selected_tab_close(app, window, matches!(browser_name, "Whale" | "Zen"))
        else {
            return Err(format!("{diagnostic_namespace}_no_close_action"));
        };
        thread::sleep(Duration::from_millis(250));
        if current_address(window, allow_search_address_label).as_deref()
            == Some(address_before.as_str())
        {
            return Err(format!(
                "{diagnostic_namespace}_post_close_target_still_frontmost"
            ));
        }
        let suffix = match close_surface {
            CloseSurface::Tab => "front_tab",
            CloseSurface::LastTabWindow => "last_tab_window",
        };
        Ok(format!("{diagnostic_namespace}_{suffix}"))
    })();
    CFRelease(window as CFTypeRef);
    result
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
    if matches!(
        role.as_str(),
        "AXWebArea" | "AXMenuBar" | "AXMenu" | "AXMenuItem"
    ) {
        return None;
    }
    if matches!(role.as_str(), "AXTextField" | "AXComboBox") {
        let description = copy_attribute_string(element, "AXDescription").unwrap_or_default();
        if looks_like_address_label(&description, allow_search_label) {
            if let Some(value) = copy_attribute_string(element, "AXValue") {
                if !value.trim().is_empty() {
                    return Some(value.trim().to_string());
                }
            }
        }
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

enum CloseSurface {
    Tab,
    LastTabWindow,
}

unsafe fn perform_selected_tab_close(
    app: AXUIElementRef,
    window: AXUIElementRef,
    allow_selected_tab_context_menu: bool,
) -> Option<CloseSurface> {
    let mut visited = 0;
    if scan_selected_tab_for_close(window, false, &mut visited) {
        return Some(CloseSurface::Tab);
    }
    if allow_selected_tab_context_menu {
        let mut visited = 0;
        if show_selected_tab_context_menu(window, &mut visited) {
            thread::sleep(Duration::from_millis(100));
            let mut visited = 0;
            if press_exact_close_tab_menu_item(app, &mut visited) {
                return Some(CloseSurface::Tab);
            }
            let mut visited = 0;
            cancel_open_menu(app, &mut visited);
        }
    }

    // Firefox-family browsers can retain one tab element without a close
    // action. Closing that exact, already-validated window is the browser's
    // native equivalent of closing its last tab. Never take this fallback if
    // the AX tree exposes zero or multiple tabs: an unknown hierarchy must fail
    // closed instead of risking an unrelated window.
    let mut tab_count = 0;
    let mut visited = 0;
    count_tab_elements(window, &mut tab_count, &mut visited);
    let is_last_tab = is_last_tab_window_candidate(tab_count);
    if is_last_tab && perform_window_close(window) {
        return Some(CloseSurface::LastTabWindow);
    }
    None
}

unsafe fn show_selected_tab_context_menu(element: AXUIElementRef, visited: &mut usize) -> bool {
    if element.is_null() || *visited >= SCAN_LIMIT {
        return false;
    }
    *visited += 1;
    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if matches!(role.as_str(), "AXWebArea" | "AXMenuBar" | "AXMenu") {
        return false;
    }
    if matches!(role.as_str(), "AXRadioButton" | "AXTab")
        && is_selected_tab(element)
        && perform_named_action(element, "AXShowMenu")
    {
        return true;
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
        if show_selected_tab_context_menu(child, visited) {
            return true;
        }
    }
    false
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

fn is_last_tab_window_candidate(tab_count: usize) -> bool {
    tab_count == 1
}

unsafe fn count_tab_elements(element: AXUIElementRef, tab_count: &mut usize, visited: &mut usize) {
    if element.is_null() || *visited >= SCAN_LIMIT || *tab_count > 1 {
        return;
    }
    *visited += 1;
    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if matches!(
        role.as_str(),
        "AXWebArea" | "AXMenuBar" | "AXMenu" | "AXMenuItem"
    ) {
        return;
    }
    if matches!(role.as_str(), "AXRadioButton" | "AXTab") {
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

unsafe fn perform_window_close(window: AXUIElementRef) -> bool {
    let Some(close_button) = copy_attribute_value(window, "AXCloseButton") else {
        return false;
    };
    let performed = perform_named_action(close_button as AXUIElementRef, "AXPress");
    CFRelease(close_button);
    performed
}

unsafe fn scan_selected_tab_for_close(
    element: AXUIElementRef,
    inside_selected_tab: bool,
    visited: &mut usize,
) -> bool {
    if element.is_null() || *visited >= SCAN_LIMIT {
        return false;
    }
    *visited += 1;
    let role = copy_attribute_string(element, "AXRole").unwrap_or_default();
    if matches!(
        role.as_str(),
        "AXWebArea" | "AXMenuBar" | "AXMenu" | "AXMenuItem"
    ) {
        return false;
    }
    let selected_here = inside_selected_tab
        || (matches!(role.as_str(), "AXRadioButton" | "AXTab") && is_selected_tab(element));

    if selected_here && perform_close_action(element) {
        return true;
    }
    if selected_here && role == "AXButton" {
        let description = copy_attribute_string(element, "AXDescription").unwrap_or_default();
        let title = copy_attribute_string(element, "AXTitle").unwrap_or_default();
        if (looks_like_close_label(&description) || looks_like_close_label(&title))
            && perform_named_action(element, "AXPress")
        {
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
        if scan_selected_tab_for_close(child, selected_here, visited) {
            return true;
        }
    }
    false
}

unsafe fn perform_close_action(element: AXUIElementRef) -> bool {
    let mut names_ref: CFArrayRef = ptr::null();
    if AXUIElementCopyActionNames(element, &mut names_ref) != 0 || names_ref.is_null() {
        return false;
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
        let action_name = action.to_string();
        let description = copy_action_description(element, raw_action).unwrap_or_default();
        if (looks_like_close_label(&action_name) || looks_like_close_label(&description))
            && AXUIElementPerformAction(element, raw_action) == 0
        {
            return true;
        }
    }
    false
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
    fn zen_search_label_is_accepted_only_for_zen_address_scans() {
        assert!(looks_like_address_label("Search...", true));
        assert!(!looks_like_address_label("Search...", false));
        assert!(looks_like_address_label("Address and search bar", false));
    }

    #[test]
    fn last_tab_window_fallback_requires_exactly_one_visible_tab() {
        assert!(is_last_tab_window_candidate(1));
        assert!(!is_last_tab_window_candidate(0));
        assert!(!is_last_tab_window_candidate(2));
    }
}
