use super::pet_drop::PetRect;
use std::ffi::c_void;

const MIN_WINDOW_WIDTH: f64 = 80.0;
const MIN_WINDOW_HEIGHT: f64 = 48.0;
const MAX_WINDOW_EDGE: f64 = 20_000.0;
const DOCK_STRIP_MIN_HEIGHT: f64 = 20.0;
const DOCK_STRIP_MAX_HEIGHT: f64 = 140.0;
const DOCK_STRIP_MIN_WIDTH: f64 = 200.0;

#[derive(Clone, Debug, PartialEq)]
pub struct ListedWindow {
    pub id: i64,
    pub pid: i64,
    pub owner: String,
    pub name: String,
    pub layer: i64,
    pub alpha: f64,
    pub bounds: PetRect,
}

pub fn list_on_screen_ledges(
    pet_window_number: i64,
) -> Result<(Vec<(String, PetRect)>, Option<PetRect>), String> {
    #[cfg(target_os = "macos")]
    {
        let windows = copy_listed_windows()?;
        Ok(ledges_from_windows(&windows, pet_window_number))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pet_window_number;
        Err("Window listing is unavailable".into())
    }
}

pub fn inferred_bottom_dock(work: &PetRect, screen: &PetRect) -> Option<PetRect> {
    let gap = screen.bottom() - work.bottom();
    if gap < DOCK_STRIP_MIN_HEIGHT || gap > DOCK_STRIP_MAX_HEIGHT {
        return None;
    }
    Some(PetRect {
        x: work.x,
        y: work.bottom(),
        width: work.width,
        height: gap,
    })
}

pub fn ledges_from_windows(
    windows: &[ListedWindow],
    pet_window_number: i64,
) -> (Vec<(String, PetRect)>, Option<PetRect>) {
    let mut ledges = Vec::new();
    let mut dock = None;
    for window in windows {
        if !is_usable_window(window, pet_window_number) {
            continue;
        }
        if is_dock_strip(window) {
            if dock
                .as_ref()
                .is_none_or(|current: &PetRect| window.bounds.y < current.y)
            {
                dock = Some(window.bounds.clone());
            }
            continue;
        }
        if window.layer != 0 || is_system_chrome(&window.owner) {
            continue;
        }
        ledges.push((ledge_name(window), window.bounds.clone()));
    }
    (ledges, dock)
}

fn is_usable_window(window: &ListedWindow, pet_window_number: i64) -> bool {
    if window.id == pet_window_number && pet_window_number > 0 {
        return false;
    }
    if window.alpha < 0.05 {
        return false;
    }
    if window.bounds.width < MIN_WINDOW_WIDTH || window.bounds.height < MIN_WINDOW_HEIGHT {
        return false;
    }
    if !window.bounds.x.is_finite()
        || !window.bounds.y.is_finite()
        || window.bounds.width > MAX_WINDOW_EDGE
        || window.bounds.height > MAX_WINDOW_EDGE
        || window.bounds.x.abs() > MAX_WINDOW_EDGE
        || window.bounds.y.abs() > MAX_WINDOW_EDGE
    {
        return false;
    }
    true
}

fn is_dock_strip(window: &ListedWindow) -> bool {
    window.owner == "Dock"
        && window.bounds.height >= DOCK_STRIP_MIN_HEIGHT
        && window.bounds.height <= DOCK_STRIP_MAX_HEIGHT
        && window.bounds.width >= DOCK_STRIP_MIN_WIDTH
}

fn is_system_chrome(owner: &str) -> bool {
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
    )
}

fn ledge_name(window: &ListedWindow) -> String {
    if !window.owner.trim().is_empty() {
        window.owner.clone()
    } else if !window.name.trim().is_empty() {
        window.name.clone()
    } else {
        "window".into()
    }
}

#[cfg(target_os = "macos")]
pub(super) fn copy_listed_windows() -> Result<Vec<ListedWindow>, String> {
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionary;
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowAlpha, kCGWindowBounds, kCGWindowLayer,
        kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, kCGWindowName,
        kCGWindowNumber, kCGWindowOwnerName, kCGWindowOwnerPID,
    };

    let array = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )
    .ok_or_else(|| "Window listing is unavailable".to_string())?;

    let mut windows = Vec::new();
    for value in array.get_all_values() {
        if value.is_null() {
            continue;
        }
        // SAFETY: CGWindowListCopyWindowInfo yields CFDictionary rows. The
        // array retains them, so wrap_under_get_rule matches the borrow.
        let dict = unsafe { CFDictionary::wrap_under_get_rule(value as _) };
        if let Some(window) = listed_window_from_dictionary(
            &dict,
            unsafe { kCGWindowNumber },
            unsafe { kCGWindowOwnerPID },
            unsafe { kCGWindowOwnerName },
            unsafe { kCGWindowName },
            unsafe { kCGWindowLayer },
            unsafe { kCGWindowAlpha },
            unsafe { kCGWindowBounds },
        ) {
            windows.push(window);
        }
    }
    let _ = array;
    Ok(windows)
}

#[cfg(target_os = "macos")]
fn listed_window_from_dictionary(
    dict: &core_foundation::dictionary::CFDictionary,
    number_key: core_foundation::string::CFStringRef,
    pid_key: core_foundation::string::CFStringRef,
    owner_key: core_foundation::string::CFStringRef,
    name_key: core_foundation::string::CFStringRef,
    layer_key: core_foundation::string::CFStringRef,
    alpha_key: core_foundation::string::CFStringRef,
    bounds_key: core_foundation::string::CFStringRef,
) -> Option<ListedWindow> {
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;

    let id = dict_number(dict, number_key)?.round() as i64;
    let pid = dict_number(dict, pid_key)?.round() as i64;
    let owner = dict_string(dict, owner_key).unwrap_or_default();
    let name = dict_string(dict, name_key).unwrap_or_default();
    let layer = dict_number(dict, layer_key).unwrap_or(0.0).round() as i64;
    let alpha = dict_number(dict, alpha_key).unwrap_or(1.0);
    let bounds_value = dict_value(dict.as_concrete_TypeRef(), bounds_key)?;
    let bounds_dict = unsafe { CFDictionary::wrap_under_get_rule(bounds_value as _) };
    let x = dict_named_number(&bounds_dict, "X")?;
    let y = dict_named_number(&bounds_dict, "Y")?;
    let width = dict_named_number(&bounds_dict, "Width")?;
    let height = dict_named_number(&bounds_dict, "Height")?;
    let _ = (CFNumber::type_id(), CFString::type_id());
    Some(ListedWindow {
        id,
        pid,
        owner,
        name,
        layer,
        alpha,
        bounds: PetRect {
            x,
            y,
            width,
            height,
        },
    })
}

#[cfg(target_os = "macos")]
fn dict_value(
    dict: core_foundation::dictionary::CFDictionaryRef,
    key: core_foundation::string::CFStringRef,
) -> Option<*const c_void> {
    use core_foundation::dictionary::CFDictionaryGetValueIfPresent;
    let mut value: *const c_void = std::ptr::null();
    let present = unsafe { CFDictionaryGetValueIfPresent(dict, key as *const c_void, &mut value) };
    if present != 0 && !value.is_null() {
        Some(value)
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn dict_string(
    dict: &core_foundation::dictionary::CFDictionary,
    key: core_foundation::string::CFStringRef,
) -> Option<String> {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;
    let value = dict_value(dict.as_concrete_TypeRef(), key)?;
    let text = unsafe { CFString::wrap_under_get_rule(value as _) }.to_string();
    Some(text)
}

#[cfg(target_os = "macos")]
fn dict_number(
    dict: &core_foundation::dictionary::CFDictionary,
    key: core_foundation::string::CFStringRef,
) -> Option<f64> {
    use core_foundation::base::TCFType;
    use core_foundation::number::CFNumber;
    let value = dict_value(dict.as_concrete_TypeRef(), key)?;
    let number = unsafe { CFNumber::wrap_under_get_rule(value as _) };
    number
        .to_f64()
        .or_else(|| number.to_i64().map(|value| value as f64))
}

#[cfg(target_os = "macos")]
fn dict_named_number(dict: &core_foundation::dictionary::CFDictionary, name: &str) -> Option<f64> {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;
    let key = CFString::new(name);
    dict_number(dict, key.as_concrete_TypeRef())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(
        id: i64,
        owner: &str,
        layer: i64,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> ListedWindow {
        ListedWindow {
            id,
            pid: id,
            owner: owner.into(),
            name: String::new(),
            layer,
            alpha: 1.0,
            bounds: PetRect {
                x,
                y,
                width,
                height,
            },
        }
    }

    #[test]
    fn keeps_layer_zero_app_windows_and_skips_overlays() {
        let (ledges, dock) = ledges_from_windows(
            &[
                window(1, "Safari", 0, 120.0, 180.0, 400.0, 240.0),
                window(2, "Control Center", 25, 1400.0, 0.0, 80.0, 33.0),
                window(3, "UserNotificationCenter", 8, 700.0, 200.0, 260.0, 256.0),
                window(4, "Window Server", 0, 0.0, 0.0, 1728.0, 1117.0),
            ],
            -1,
        );
        assert_eq!(ledges.len(), 1);
        assert_eq!(ledges[0].0, "Safari");
        assert!(dock.is_none());
    }

    #[test]
    fn excludes_the_pet_window() {
        let (ledges, _) =
            ledges_from_windows(&[window(77, "drifty", 0, 80.0, 40.0, 144.0, 99.0)], 77);
        assert!(ledges.is_empty());
    }

    #[test]
    fn treats_a_thin_dock_as_a_dock_ledge() {
        let (ledges, dock) = ledges_from_windows(
            &[
                window(8, "Dock", -2147483624, 0.0, 0.0, 1728.0, 1117.0),
                window(9, "Dock", 20, 420.0, 1048.0, 880.0, 69.0),
            ],
            -1,
        );
        assert!(ledges.is_empty());
        let dock = dock.expect("dock strip");
        assert!((dock.y - 1048.0).abs() < 0.01);
        assert!((dock.height - 69.0).abs() < 0.01);
    }

    #[test]
    fn infers_a_bottom_dock_from_the_work_area_gap() {
        let work = PetRect {
            x: 0.0,
            y: 33.0,
            width: 1728.0,
            height: 1015.0,
        };
        let screen = PetRect {
            x: 0.0,
            y: 0.0,
            width: 1728.0,
            height: 1117.0,
        };
        let dock = inferred_bottom_dock(&work, &screen).expect("gap");
        assert!((dock.y - 1048.0).abs() < 0.01);
        assert!((dock.height - 69.0).abs() < 0.01);
    }

    #[test]
    fn does_not_invent_a_dock_when_the_work_area_fills_the_screen() {
        let work = PetRect {
            x: 0.0,
            y: 33.0,
            width: 1728.0,
            height: 1084.0,
        };
        let screen = PetRect {
            x: 0.0,
            y: 0.0,
            width: 1728.0,
            height: 1117.0,
        };
        assert!(inferred_bottom_dock(&work, &screen).is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn live_listing_is_available_and_skips_window_server() {
        let (ledges, _) = list_on_screen_ledges(-1).expect("listing");
        assert!(ledges.iter().all(|(name, _)| name != "Window Server"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn live_windows_plan_catch_above_and_never_teleport_from_inside() {
        let (ledges, dock) = list_on_screen_ledges(-1).expect("listing");
        let work = PetRect {
            x: 0.0,
            y: 25.0,
            width: 1728.0,
            height: 1084.0,
        };
        // Stay-top wins when the panel itself is still in the menu-bar band, so
        // the catch probe has to start below that home lane.
        let Some((name, rect)) = ledges.iter().find(|(_, rect)| {
            rect.width >= 200.0 && rect.height >= 120.0 && rect.y >= 280.0 && rect.y <= 520.0
        }) else {
            return;
        };
        let pet_x = rect.x + (rect.width - 144.0).max(0.0) / 2.0;
        let above = PetRect {
            x: pet_x,
            y: rect.y - 93.0 - 45.0,
            width: 144.0,
            height: 99.0,
        };
        let catch = crate::commands::pet_drop::plan_pet_drop(
            false,
            &above,
            &work,
            &[(name.as_str(), rect.clone())],
            dock.as_ref(),
        );
        assert_eq!(catch.kind, crate::commands::pet_drop::PetDropKind::Catch);
        assert_eq!(catch.ledge, *name);
        assert!(catch.target_y > above.y);

        let inside = PetRect {
            x: pet_x,
            y: rect.y + 40.0,
            width: 144.0,
            height: 99.0,
        };
        let stay = crate::commands::pet_drop::plan_pet_drop(
            false,
            &inside,
            &work,
            &[(name.as_str(), rect.clone())],
            dock.as_ref(),
        );
        assert_ne!(stay.kind, crate::commands::pet_drop::PetDropKind::AlreadyOn);
        assert!(stay.target_y >= inside.y);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn live_windows_never_plan_an_upward_teleport() {
        let (ledges, dock) = list_on_screen_ledges(-1).expect("listing");
        let named: Vec<(&str, PetRect)> = ledges
            .iter()
            .map(|(name, rect)| (name.as_str(), rect.clone()))
            .collect();
        let work = PetRect {
            x: 0.0,
            y: 33.0,
            width: 1728.0,
            height: 1084.0,
        };
        for y in [14.0, 39.0, 80.0, 160.0, 240.0, 360.0, 520.0, 700.0, 820.0] {
            let pet = PetRect {
                x: 640.0,
                y,
                width: 144.0,
                height: 99.0,
            };
            let plan =
                crate::commands::pet_drop::plan_pet_drop(false, &pet, &work, &named, dock.as_ref());
            assert!(plan.target_y + 0.01 >= pet.y, "{y} {:?}", plan);
            if matches!(plan.kind, crate::commands::pet_drop::PetDropKind::Hop) {
                assert!(plan.distance <= crate::commands::pet_drop::PET_DROP_HOP_PT + 0.01);
            }
            if matches!(plan.kind, crate::commands::pet_drop::PetDropKind::Catch) {
                assert!(plan.distance > crate::commands::pet_drop::PET_DROP_ON_LEDGE_PT);
                assert!(plan.distance <= crate::commands::pet_drop::PET_DROP_CATCH_PT);
            }
        }
    }
}
