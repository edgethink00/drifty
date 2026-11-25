use std::{
    path::Path,
    thread,
    time::{Duration, Instant},
};

use uiautomation::{
    patterns::{UIInvokePattern, UISelectionItemPattern, UIValuePattern},
    types::{ControlType, Handle, TreeScope, UIProperty},
    variants::Variant,
    UIAutomation, UIElement, UITreeWalker,
};
use url::Url;
use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND},
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::{
        HiDpi::GetDpiForWindow,
        WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId, IsWindow},
    },
};

use super::windows_browser_uia_operation::{OperationGate, OperationKind, ReadRecovery};

// UIA target resolution must finish inside this budget before any browser
// mutation starts. Keep it separate from the caller's completion budget: once
// Invoke has closed a tab, Chromium can take several more seconds to expose a
// stable post-close tree that proves the exact runtime ID disappeared.
const UIA_ACTION_TIMEOUT: Duration = Duration::from_secs(5);
const UIA_CLOSE_COMPLETION_TIMEOUT: Duration = Duration::from_secs(10);
// Match the previously live-proven PowerShell verifier's settle window before
// checking that the closed runtime ID vanished and a survivor became selected.
const POST_CLOSE_SETTLE: Duration = Duration::from_millis(500);
// A page with slow pagehide/unload handlers keeps its closing tab in the strip
// after Invoke (1.5 s of handler work reproduced this in Chrome, Edge and Brave
// on 2026-10-25). Re-read the strip until the exact runtime ID is gone instead
// of reporting the first read as a failure. Pre-invoke budget, settle and this
// wait together stay inside UIA_CLOSE_COMPLETION_TIMEOUT.
const POST_CLOSE_VERIFY_WAIT: Duration = Duration::from_secs(3);
const POST_CLOSE_VERIFY_INTERVAL: Duration = Duration::from_millis(150);
// The last Chrome tab destroys its window instead of selecting a survivor.
// Observe only the original HWND after Invoke; do not act on the new foreground.
const LAST_TAB_WINDOW_CLOSE_WAIT: Duration = Duration::from_secs(2);
static UIA_OPERATIONS: OperationGate = OperationGate::new();
// Failed geometry does not animate, so this read-completion wait plus the
// original five-second lookup remains inside the existing 18s pet failsafe.
// It never extends a provider deadline or performs another provider call.
const UIA_READ_RECOVERY_WAIT: Duration = Duration::from_secs(5);
// Firefox's native UI Automation provider exposes DOM ids as AutomationId and
// DOM classes as ClassName, independent of the UI language (measured on
// Firefox 154, Windows 11). Floorp 12.18 and Waterfox 6.7 expose the same tab
// strip, close button, and tab panels. The tab close button therefore has
// a stable name, which matters because position cannot identify it: a playing
// tab's audio toggle is the rightmost button in a right-to-left layout, and
// the only button left when a userChrome.css hides the close button.
const FIREFOX_TAB_CLASS: &str = "tabbrowser-tab";
const FIREFOX_TAB_STRIP_ID: &str = "tabbrowser-tabs";
const FIREFOX_TAB_PANELS_ID: &str = "tabbrowser-tabpanels";
// The selected tab's panel carries this class. After a tab switch LibreWolf
// 156 kept reporting the previous tab's Document as on-screen with an empty
// rectangle, so visibility alone cannot pick the page.
const FIREFOX_SELECTED_PANEL_CLASS: &str = "deck-selected";
const FIREFOX_CLOSE_BUTTON_CLASS: &str = "tab-close-button";
const FIREFOX_GEOMETRY_REREAD_DELAY: Duration = Duration::from_millis(50);

#[derive(Clone, Debug)]
struct TargetRequest {
    process_name: String,
    browser_identity: String,
    site_url: String,
    site_domain: String,
}

#[derive(Clone, Debug)]
pub(super) struct ForegroundTabClosePoint {
    pub x: f64,
    pub y: f64,
    pub diagnostic: String,
}

#[derive(Debug)]
struct ForegroundSnapshot {
    hwnd: HWND,
    pid: u32,
    dpi: u32,
}

// UIAutomation may synchronously call into a browser provider. Keep that work
// off Tauri and bound the caller. A provider that ignores cancellation owns at
// most one quarantined thread; later actions fail closed instead of leaking an
// unbounded queue of automation threads.
pub(super) fn locate_foreground_tab_close(
    process_name: &str,
    browser_identity: &str,
    site_url: &str,
    site_domain: &str,
) -> Result<ForegroundTabClosePoint, String> {
    locate_tab_close(process_name, browser_identity, site_url, site_domain, None)
}

pub(super) fn locate_foreground_tab_close_for_pet(
    process_name: &str,
    browser_identity: &str,
    site_url: &str,
    site_domain: &str,
    intervention_id: &str,
) -> Result<ForegroundTabClosePoint, String> {
    let result = locate_tab_close(
        process_name,
        browser_identity,
        site_url,
        site_domain,
        Some(intervention_id.to_string()),
    );
    if result.as_ref().err().map(String::as_str) != Some("windows_uia_geometry_timeout") {
        return result;
    }
    // Discard late geometry. The renderer still reports a technical rejection,
    // then App rechecks authorization/current identity before its first close.
    match UIA_OPERATIONS.wait_for_read(intervention_id, UIA_READ_RECOVERY_WAIT) {
        ReadRecovery::Ready => result,
        ReadRecovery::Blocked => Err("windows_uia_geometry_recovery_blocked".to_string()),
        ReadRecovery::TimedOut => Err("windows_uia_geometry_recovery_timeout".to_string()),
    }
}

fn locate_tab_close(
    process_name: &str,
    browser_identity: &str,
    site_url: &str,
    site_domain: &str,
    owner: Option<String>,
) -> Result<ForegroundTabClosePoint, String> {
    let request = owned_request(process_name, browser_identity, site_url, site_domain)?;
    run_bounded(
        OperationKind::Read { owner },
        "windows_uia_geometry_timeout",
        UIA_ACTION_TIMEOUT,
        UIA_ACTION_TIMEOUT,
        move |deadline| locate_impl(&request, deadline),
    )
}

pub(super) fn close_foreground_tab(
    process_name: &str,
    browser_identity: &str,
    site_url: &str,
    site_domain: &str,
) -> Result<String, String> {
    let request = owned_request(process_name, browser_identity, site_url, site_domain)?;
    run_bounded(
        OperationKind::Close,
        "windows_uia_timeout",
        UIA_ACTION_TIMEOUT,
        UIA_CLOSE_COMPLETION_TIMEOUT,
        move |deadline| close_impl(&request, deadline),
    )
}

fn owned_request(
    process_name: &str,
    browser_identity: &str,
    site_url: &str,
    site_domain: &str,
) -> Result<TargetRequest, String> {
    let process_name = process_name.trim().to_ascii_lowercase();
    if !matches!(
        process_name.as_str(),
        "chrome" | "msedge" | "brave" | "firefox" | "floorp" | "waterfox"
    ) {
        return Err("windows_uia_unsupported_browser".to_string());
    }
    let browser_identity = browser_identity.trim();
    if browser_identity.is_empty() || !Path::new(browser_identity).is_absolute() {
        return Err("windows_uia_invalid_browser_identity".to_string());
    }
    let site_url = site_url.trim().to_string();
    let site_domain = normalize_domain(site_domain);
    if site_url.is_empty() && site_domain.is_empty() {
        return Err("windows_uia_missing_target".to_string());
    }
    if !site_url.is_empty() && normalize_http_url(&site_url).is_none() {
        return Err("windows_uia_invalid_target_url".to_string());
    }
    Ok(TargetRequest {
        process_name,
        browser_identity: browser_identity.to_string(),
        site_url,
        site_domain,
    })
}

fn run_bounded<T: Send + 'static>(
    kind: OperationKind,
    timeout_diagnostic: &'static str,
    action_timeout: Duration,
    completion_timeout: Duration,
    work: impl FnOnce(Instant) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let guard = UIA_OPERATIONS.acquire(kind)?;
    let deadline = Instant::now() + action_timeout;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    thread::spawn(move || {
        let _guard = guard;
        let _ = sender.send(work(deadline));
    });
    receiver
        .recv_timeout(completion_timeout)
        .map_err(|_| timeout_diagnostic.to_string())?
}

fn locate_impl(
    request: &TargetRequest,
    deadline: Instant,
) -> Result<ForegroundTabClosePoint, String> {
    let snapshot = foreground_snapshot(request)?;
    let resolved = resolve_selected_tab(request, &snapshot, deadline)?;
    let scale = if snapshot.dpi > 0 {
        f64::from(snapshot.dpi) / 96.0
    } else {
        1.0
    };
    Ok(ForegroundTabClosePoint {
        x: f64::from(resolved.close_rect.get_left() + resolved.close_rect.get_right())
            / 2.0
            / scale,
        y: f64::from(resolved.close_rect.get_top() + resolved.close_rect.get_bottom())
            / 2.0
            / scale,
        diagnostic: format!("windows_uia_{}_close_button", resolved.match_kind),
    })
}

fn close_impl(request: &TargetRequest, deadline: Instant) -> Result<String, String> {
    let snapshot = foreground_snapshot(request)?;
    let resolved = resolve_selected_tab(request, &snapshot, deadline)?;
    // No automation action may start after the caller's deadline. If a browser
    // provider returns late, the quarantined thread exits without touching it.
    if Instant::now() >= deadline {
        return Err("windows_uia_timeout".to_string());
    }
    verify_invoke_target(
        deadline,
        || resolved.selection.is_selected().unwrap_or(false),
        || {
            if request.process_name == "chrome" {
                verify_chrome_display_address(
                    &resolved.automation,
                    &resolved.walker,
                    &resolved.window,
                    &resolved.verified_url,
                )?;
            }
            Ok(())
        },
        || verify_foreground_snapshot(request, &snapshot),
    )?;
    let invoke_result = resolved.close_invoke.invoke();
    if invoke_result.is_err() && !resolved.last_tab_window_close {
        return Err("windows_uia_invoke_failed".to_string());
    }
    thread::sleep(POST_CLOSE_SETTLE);

    if resolved.last_tab_window_close {
        // The provider may disconnect while the last-tab Invoke returns. Its
        // error alone cannot disprove a close, but only destruction of the
        // exact pre-invoke window can prove this outcome. A focus switch, an
        // empty UIA tree or a before-unload prompt is not sufficient.
        if wait_for_original_window_close(
            snapshot.hwnd,
            Instant::now() + LAST_TAB_WINDOW_CLOSE_WAIT,
        ) {
            return Ok(close_success_diagnostic(resolved.match_kind));
        }
    }
    invoke_result.map_err(|_| "windows_uia_invoke_failed".to_string())?;
    verify_foreground_snapshot(request, &snapshot)?;
    wait_for_verified_close(
        Instant::now() + POST_CLOSE_VERIFY_WAIT,
        || {
            browser_tabs(
                &resolved.automation,
                &resolved.walker,
                &resolved.window,
                &request.process_name,
            )?
            .iter()
            .map(|tab| {
                tab.get_runtime_id()
                    .map_err(|_| "windows_uia_no_verified_close".to_string())
            })
            .collect()
        },
        &resolved.runtime_id,
        thread::sleep,
    )?;
    // Chromium can briefly expose zero or multiple selected UIA tab items while
    // it promotes the survivor. That transition state does not weaken the close
    // proof: the exact pre-invoke tab runtime ID is gone, every remaining ID was
    // readable, at least one tab survived, and the same browser window/process
    // is still foreground. Requiring a selected-count here caused a real close
    // to be reported as a failure and incorrectly showed the fallback alarm.
    // Keep the externally observed diagnostic stable across the PowerShell to
    // in-process implementation change. Foreground binding is a safety
    // invariant above, not a new product outcome category.
    Ok(close_success_diagnostic(resolved.match_kind))
}

// Selection reads can synchronously block in the browser's UIA provider.
// Recheck Chrome's native address after the final selection read: the same tab
// can navigate while that provider call waits. Window/process identity and the
// original action budget are checked after the address provider returns too.
fn verify_invoke_target(
    deadline: Instant,
    is_selected: impl FnOnce() -> bool,
    verify_address: impl FnOnce() -> Result<(), String>,
    verify_foreground: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if !is_selected() {
        return Err("windows_uia_stale_target".to_string());
    }
    ensure_deadline(deadline)?;
    verify_address()?;
    verify_foreground()?;
    ensure_deadline(deadline)
}

fn close_success_diagnostic(match_kind: &str) -> String {
    format!("windows_uia_{match_kind}")
}

fn wait_for_original_window_close(hwnd: HWND, deadline: Instant) -> bool {
    loop {
        if unsafe { IsWindow(hwnd) } == 0 {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn post_close_runtime_ids_verify(remaining: &[Vec<i32>], closed: &[i32]) -> bool {
    !remaining.is_empty() && remaining.iter().all(|runtime_id| runtime_id != closed)
}

/// Read the surviving tabs until the closed runtime ID is gone or the deadline
/// passes. Only observation repeats; nothing is invoked again. The last read's
/// result is reported, so a window that went stale still says so.
fn wait_for_verified_close(
    deadline: Instant,
    mut read_remaining: impl FnMut() -> Result<Vec<Vec<i32>>, String>,
    closed: &[i32],
    mut sleep: impl FnMut(Duration),
) -> Result<(), String> {
    loop {
        let outcome = read_remaining().and_then(|remaining| {
            post_close_runtime_ids_verify(&remaining, closed)
                .then_some(())
                .ok_or_else(|| "windows_uia_no_verified_close".to_string())
        });
        if outcome.is_ok() || Instant::now() >= deadline {
            return outcome;
        }
        sleep(POST_CLOSE_VERIFY_INTERVAL);
    }
}

struct ResolvedSelectedTab {
    automation: UIAutomation,
    walker: UITreeWalker,
    window: UIElement,
    selection: UISelectionItemPattern,
    close_invoke: UIInvokePattern,
    close_rect: uiautomation::types::Rect,
    runtime_id: Vec<i32>,
    verified_url: String,
    match_kind: &'static str,
    last_tab_window_close: bool,
}

fn resolve_selected_tab(
    request: &TargetRequest,
    snapshot: &ForegroundSnapshot,
    deadline: Instant,
) -> Result<ResolvedSelectedTab, String> {
    ensure_deadline(deadline)?;
    let automation =
        UIAutomation::new().map_err(|_| "windows_uia_initialize_failed".to_string())?;
    let walker = automation
        .get_control_view_walker()
        .map_err(|_| "windows_uia_walker_failed".to_string())?;
    let window = automation
        .element_from_handle(Handle::from(snapshot.hwnd as isize))
        .map_err(|_| "windows_uia_window_unavailable".to_string())?;
    if window.get_control_type().ok() != Some(ControlType::Window)
        || window.get_process_id().ok() != Some(snapshot.pid)
        || Into::<isize>::into(
            window
                .get_native_window_handle()
                .map_err(|_| "windows_uia_stale_window".to_string())?,
        ) != snapshot.hwnd as isize
    {
        return Err("windows_uia_stale_window".to_string());
    }

    let tabs = browser_tabs(&automation, &walker, &window, &request.process_name)?;
    if tabs.is_empty() {
        // Nothing in this window matched the browser's tab strip: a window
        // without one, such as an installed site, or a strip the browser has
        // reworked. Chrome 158's renamed container made every close read as a
        // last-tab refusal; report the actual condition instead.
        return Err("windows_uia_no_recognized_tabs".to_string());
    }
    let last_tab_window_close =
        closes_window_with_last_tab(&request.process_name) && tabs.len() == 1;
    if tabs.len() < 2 && !last_tab_window_close {
        return Err("windows_uia_last_tab_refused".to_string());
    }
    let mut selected = Vec::new();
    for tab in tabs {
        let Ok(pattern) = tab.get_pattern::<UISelectionItemPattern>() else {
            return Err("windows_uia_incomplete_tabs".to_string());
        };
        if pattern.is_selected().unwrap_or(false) {
            selected.push((tab, pattern));
        }
    }
    if selected.len() != 1 {
        return Err("windows_uia_ambiguous_selected_tab".to_string());
    }
    let (tab, selection) = selected.pop().expect("one selected tab");
    let actual_url = read_page_url(&automation, &walker, &window, &request.process_name)?;
    let match_kind = target_match_kind(request, &actual_url)?;
    let tab_rect = tab
        .get_bounding_rectangle()
        .map_err(|_| "windows_uia_invalid_tab_geometry".to_string())?;
    if !positive_rect(&tab_rect) {
        return Err("windows_uia_invalid_tab_geometry".to_string());
    }

    let button_condition = automation
        .create_property_condition(
            UIProperty::ControlType,
            Variant::from(ControlType::Button as i32),
            None,
        )
        .map_err(|_| "windows_uia_condition_failed".to_string())?;
    let buttons = tab
        .find_all(TreeScope::Descendants, &button_condition)
        .map_err(|_| "windows_uia_no_close_button".to_string())?;
    let mut close_buttons = Vec::new();
    for button in buttons {
        if button.is_offscreen().unwrap_or(true) {
            continue;
        }
        let Ok(rect) = button.get_bounding_rectangle() else {
            continue;
        };
        if !positive_rect(&rect) || !rect_inside(&rect, &tab_rect, 2) {
            continue;
        }
        let Ok(invoke) = button.get_pattern::<UIInvokePattern>() else {
            continue;
        };
        let class_name = button.get_classname().unwrap_or_default();
        close_buttons.push((rect, invoke, class_name));
    }
    let (close_rect, close_invoke) = select_close_button(&request.process_name, close_buttons)
        .ok_or_else(|| "windows_uia_no_close_button".to_string())?;

    ensure_deadline(deadline)?;
    verify_foreground_snapshot(request, snapshot)?;
    if !selection.is_selected().unwrap_or(false)
        || read_page_url(&automation, &walker, &window, &request.process_name)
            .ok()
            .as_deref()
            != Some(&actual_url)
    {
        return Err("windows_uia_stale_target".to_string());
    }

    Ok(ResolvedSelectedTab {
        automation,
        walker,
        window,
        selection,
        close_invoke,
        close_rect,
        runtime_id: tab
            .get_runtime_id()
            .map_err(|_| "windows_uia_stale_target".to_string())?,
        verified_url: actual_url,
        match_kind,
        last_tab_window_close,
    })
}

/// Identify the selected tab's close control by its browser-owned class,
/// independently of UI language or layout direction. The audio indicator can
/// also expose Invoke and be the rightmost button in RTL.
fn select_close_button<T>(
    process_name: &str,
    mut candidates: Vec<(uiautomation::types::Rect, T, String)>,
) -> Option<(uiautomation::types::Rect, T)> {
    if is_gecko_process(process_name) {
        candidates.retain(|(_, _, class_name)| {
            class_tokens_contain(class_name, FIREFOX_CLOSE_BUTTON_CLASS)
        });
        if candidates.len() != 1 {
            return None;
        }
        return candidates.pop().map(|(rect, invoke, _)| (rect, invoke));
    }
    let close_class = match process_name {
        "chrome" | "brave" => "TabCloseButton",
        "msedge" => "EdgeTabCloseButton",
        _ => return None,
    };
    candidates.retain(|(_, _, class_name)| class_name == close_class);
    if candidates.len() != 1 {
        return None;
    }
    candidates.pop().map(|(rect, invoke, _)| (rect, invoke))
}

fn class_tokens_contain(class_name: &str, token: &str) -> bool {
    class_name.split_whitespace().any(|value| value == token)
}

/// Chromium browsers close their window together with its last tab, and the
/// close is proven by the original window disappearing. Chrome was measured
/// first (2026-10-04). Edge and Brave refused every one-tab window, so a drift
/// page watched alone in its own window was never closed (Windows feedback
/// 2026-10-15..23; reproduced in native QA 2026-10-25).
fn closes_window_with_last_tab(process_name: &str) -> bool {
    matches!(process_name, "chrome" | "msedge" | "brave")
}

/// Firefox and the forks whose tab close was measured end to end. Zen's
/// selected tab exposes no close button, and LibreWolf 156 ignored Invoke on
/// its close button under its default fingerprinting resistance, so both keep
/// page capture only.
fn is_gecko_process(process_name: &str) -> bool {
    matches!(process_name, "firefox" | "floorp" | "waterfox")
}

fn browser_tabs(
    automation: &UIAutomation,
    walker: &UITreeWalker,
    window: &UIElement,
    process_name: &str,
) -> Result<Vec<UIElement>, String> {
    let condition = automation
        .create_property_condition(
            UIProperty::ControlType,
            Variant::from(ControlType::TabItem as i32),
            None,
        )
        .map_err(|_| "windows_uia_condition_failed".to_string())?;
    let candidates = window
        .find_all(TreeScope::Descendants, &condition)
        .map_err(|_| "windows_uia_incomplete_tabs".to_string())?;
    let mut tabs = Vec::new();
    for tab in candidates {
        if !expected_tab_shape(walker, &tab, process_name)
            || !has_exact_window_ancestry(automation, walker, &tab, window, true, false, None)
        {
            continue;
        }
        let Ok(rect) = tab.get_bounding_rectangle() else {
            continue;
        };
        let Ok(window_rect) = window.get_bounding_rectangle() else {
            return Err("windows_uia_stale_window".to_string());
        };
        if positive_rect(&rect)
            && positive_rect(&window_rect)
            && overlaps(&rect, &window_rect)
            && !tab.is_offscreen().unwrap_or(true)
        {
            tabs.push(tab);
        }
    }
    Ok(tabs)
}

fn expected_tab_shape(walker: &UITreeWalker, tab: &UIElement, process_name: &str) -> bool {
    let Ok(class_name) = tab.get_classname() else {
        return false;
    };
    if is_gecko_process(process_name) {
        if !class_tokens_contain(&class_name, FIREFOX_TAB_CLASS) {
            return false;
        }
        let Ok(parent) = walker.get_parent(tab) else {
            return false;
        };
        return parent.get_control_type().ok() == Some(ControlType::Tab)
            && parent.get_automation_id().ok().as_deref() == Some(FIREFOX_TAB_STRIP_ID);
    }
    if process_name == "chrome" && class_name == CHROME_TAB_VIEW_CLASS {
        // Read up to the strip itself: the optional split and group wrappers,
        // the pinned or unpinned container and its scroll view.
        let mut ancestors = Vec::with_capacity(CHROME_TAB_VIEW_MAX_ANCESTORS);
        let mut cursor = tab.clone();
        while ancestors.len() < CHROME_TAB_VIEW_MAX_ANCESTORS {
            let Ok(parent) = walker.get_parent(&cursor) else {
                break;
            };
            let Ok(control_type) = parent.get_control_type() else {
                break;
            };
            let class_name = parent.get_classname().unwrap_or_default();
            let reached_strip = class_name == CHROME_TAB_STRIP_VIEW;
            ancestors.push((control_type, class_name));
            if reached_strip {
                break;
            }
            cursor = parent;
        }
        return chrome_tab_view_ancestry_matches(&ancestors);
    }
    let (tab_class, container_classes): (&str, &[&str]) = match process_name {
        "chrome" => ("Tab", &CHROME_TAB_CONTAINER_CLASSES),
        "msedge" => ("EdgeTab", &["EdgeTabContainerImpl"]),
        "brave" => ("BraveTab", &["BraveTabContainer"]),
        _ => return false,
    };
    if class_name != tab_class {
        return false;
    }
    // Read just enough ancestors to recognise the strip: the direct parent for
    // horizontal strips, plus Edge's vertical scroll wrappers.
    let mut ancestors = Vec::with_capacity(EDGE_VERTICAL_TAB_WRAPPERS.len() + 1);
    let mut cursor = tab.clone();
    for _ in 0..=EDGE_VERTICAL_TAB_WRAPPERS.len() {
        let Ok(parent) = walker.get_parent(&cursor) else {
            break;
        };
        let Ok(control_type) = parent.get_control_type() else {
            break;
        };
        let class_name = parent.get_classname().unwrap_or_default();
        let reached_container =
            control_type == ControlType::Tab && container_classes.contains(&class_name.as_str());
        ancestors.push((control_type, class_name));
        if reached_container || process_name != "msedge" {
            break;
        }
        cursor = parent;
    }
    tab_strip_ancestry_matches(process_name, container_classes, &ancestors)
}

/// Chrome 158 folded `TabContainerImpl` into `TabContainer` (Chromium commit
/// 6eb8428, 2026-10-21), so the same tab strip reports either class depending
/// on the installed version. Every tab of a Chrome 158 window was refused as
/// `windows_uia_last_tab_refused` while only the old class was accepted.
const CHROME_TAB_CONTAINER_CLASSES: [&str; 2] = ["TabContainerImpl", "TabContainer"];

/// Chrome's own vertical tabs use its newer tab strip (measured in Chrome 158
/// and 159 on 2026-11-26): `TabView` items in a scroll view under
/// `TabStripView`. From the tab's parent upward, a split pair and then a group
/// may wrap the tab before its pinned or unpinned container. The strip reads as
/// a pane in Chrome 158 and as a tab list in Chrome 159. Before this was
/// recognised, every vertical-tab window was refused as
/// `windows_uia_last_tab_refused`.
const CHROME_TAB_VIEW_CLASS: &str = "TabView";
const CHROME_TAB_VIEW_WRAPPERS: [&str; 2] = ["SplitTabView", "TabGroupView"];
const CHROME_TAB_VIEW_CONTAINERS: [&str; 2] =
    ["UnpinnedTabContainerView", "PinnedTabContainerView"];
const CHROME_TAB_STRIP_VIEW: &str = "TabStripView";
const CHROME_TAB_VIEW_MAX_ANCESTORS: usize = CHROME_TAB_VIEW_WRAPPERS.len() + 4;

fn is_pane(ancestor: &(ControlType, String), class_name: &str) -> bool {
    ancestor.0 == ControlType::Pane && ancestor.1 == class_name
}

/// Whether a `TabView`'s ancestors, from its parent upward, are exactly the
/// measured path to Chrome's `TabStripView`.
fn chrome_tab_view_ancestry_matches(ancestors: &[(ControlType, String)]) -> bool {
    let mut rest = ancestors;
    for wrapper in CHROME_TAB_VIEW_WRAPPERS {
        if rest
            .first()
            .is_some_and(|ancestor| is_pane(ancestor, wrapper))
        {
            rest = &rest[1..];
        }
    }
    let [container, viewport, scroll_view, strip] = rest else {
        return false;
    };
    CHROME_TAB_VIEW_CONTAINERS
        .iter()
        .any(|class_name| is_pane(container, class_name))
        && is_pane(viewport, "ScrollView::Viewport")
        && is_pane(scroll_view, "ScrollView")
        && matches!(strip.0, ControlType::Pane | ControlType::Tab)
        && strip.1 == CHROME_TAB_STRIP_VIEW
}

/// Edge's vertical tab pane keeps the same `EdgeTab` items and
/// `EdgeTabContainerImpl`, but puts a scroll view between them. The classes are
/// listed from the tab's parent upward.
const EDGE_VERTICAL_TAB_WRAPPERS: [&str; 3] = ["View", "ScrollView::Viewport", "ScrollView"];

/// Whether a tab's ancestors, from its parent upward, end in the browser's tab
/// container. Horizontal strips hold their tabs directly; only Edge's exact
/// vertical scroll wrappers may sit in between.
fn tab_strip_ancestry_matches(
    process_name: &str,
    container_classes: &[&str],
    ancestors: &[(ControlType, String)],
) -> bool {
    let is_container = |(control_type, class_name): &(ControlType, String)| {
        *control_type == ControlType::Tab && container_classes.contains(&class_name.as_str())
    };
    if ancestors.first().is_some_and(is_container) {
        return true;
    }
    process_name == "msedge"
        && ancestors.len() > EDGE_VERTICAL_TAB_WRAPPERS.len()
        && ancestors
            .iter()
            .zip(EDGE_VERTICAL_TAB_WRAPPERS)
            .all(|((control_type, class_name), wrapper)| {
                *control_type == ControlType::Pane && class_name == wrapper
            })
        && is_container(&ancestors[EDGE_VERTICAL_TAB_WRAPPERS.len()])
}

fn read_page_url(
    automation: &UIAutomation,
    walker: &UITreeWalker,
    window: &UIElement,
    process_name: &str,
) -> Result<String, String> {
    // Firefox shows its own panels (translations, for example) as Documents
    // directly under the window. Only a Document inside the selected tab
    // panel is the page.
    let required_ancestor = is_gecko_process(process_name)
        .then_some((FIREFOX_TAB_PANELS_ID, FIREFOX_SELECTED_PANEL_CLASS));
    let condition = automation
        .create_property_condition(
            UIProperty::ControlType,
            Variant::from(ControlType::Document as i32),
            None,
        )
        .map_err(|_| "windows_uia_condition_failed".to_string())?;
    let documents = window
        .find_all(TreeScope::Descendants, &condition)
        .map_err(|_| "windows_uia_document_unavailable".to_string())?;
    let mut values = Vec::new();
    for document in documents {
        if document.is_offscreen().unwrap_or(true)
            || !has_exact_window_ancestry(
                automation,
                walker,
                &document,
                window,
                true,
                true,
                required_ancestor,
            )
        {
            continue;
        }
        let Ok(rect) = document.get_bounding_rectangle() else {
            continue;
        };
        // Firefox can answer the first bounds query for a page it has just
        // exposed with an empty rectangle and the real bounds on the next.
        let rect = if required_ancestor.is_some() && !positive_rect(&rect) {
            thread::sleep(FIREFOX_GEOMETRY_REREAD_DELAY);
            match document.get_bounding_rectangle() {
                Ok(rect) => rect,
                Err(_) => continue,
            }
        } else {
            rect
        };
        let Ok(window_rect) = window.get_bounding_rectangle() else {
            return Err("windows_uia_stale_window".to_string());
        };
        if !positive_rect(&rect) || !overlaps(&rect, &window_rect) {
            continue;
        }
        let Ok(pattern) = document.get_pattern::<UIValuePattern>() else {
            continue;
        };
        let Ok(value) = pattern.get_value() else {
            continue;
        };
        if let Some(normalized) = normalize_http_url(&value) {
            values.push(normalized);
        }
    }
    if values.len() != 1 {
        return Err("windows_uia_document_unavailable".to_string());
    }
    let document_url = values
        .pop()
        .ok_or_else(|| "windows_uia_document_unavailable".to_string())?;
    if process_name == "chrome" {
        verify_chrome_display_address(automation, walker, window, &document_url)?;
    }
    Ok(document_url)
}

fn verify_chrome_display_address(
    automation: &UIAutomation,
    walker: &UITreeWalker,
    window: &UIElement,
    document_url: &str,
) -> Result<(), String> {
    // Chrome's Document ValuePattern can retain the loaded URL after a
    // same-document history change. Veto disagreement with the native omnibox;
    // never replace the existing exact Document URL proof with display text.
    let unavailable = || "windows_uia_address_unavailable".to_string();
    let condition = automation
        .create_property_condition(
            UIProperty::ControlType,
            Variant::from(ControlType::Edit as i32),
            None,
        )
        .map_err(|_| unavailable())?;
    let edits = window
        .find_all(TreeScope::Descendants, &condition)
        .map_err(|_| unavailable())?;
    let window_rect = window.get_bounding_rectangle().map_err(|_| unavailable())?;
    let mut values = Vec::new();
    for edit in edits {
        if edit.is_offscreen().unwrap_or(true)
            || edit.get_classname().ok().as_deref() != Some("OmniboxViewViews")
            || edit.get_automation_id().ok().as_deref() != Some("view_1012")
            || !has_exact_window_ancestry(automation, walker, &edit, window, true, false, None)
        {
            continue;
        }
        // A focused omnibox may contain uncommitted user text, including the
        // old URL. It cannot corroborate the displayed page's current address.
        if edit.has_keyboard_focus().unwrap_or(true) {
            return Err(unavailable());
        }
        let rect = edit.get_bounding_rectangle().map_err(|_| unavailable())?;
        if !positive_rect(&rect) || !rect_inside(&rect, &window_rect, 2) {
            return Err(unavailable());
        }
        let value = edit
            .get_pattern::<UIValuePattern>()
            .and_then(|pattern| pattern.get_value())
            .map_err(|_| unavailable())?;
        values.push(value);
    }
    if values.len() != 1 {
        return Err(unavailable());
    }
    if !chrome_display_address_matches_document(&values[0], document_url) {
        return Err("windows_uia_address_mismatch".to_string());
    }
    Ok(())
}

fn chrome_display_address_matches_document(display: &str, document_url: &str) -> bool {
    if display != display.trim() {
        return false;
    }
    let Some(document_url) = normalize_http_url(document_url) else {
        return false;
    };
    if let Some(explicit_url) = normalize_http_url(display) {
        return explicit_url == document_url;
    }
    if display.contains("://") || display.starts_with("//") {
        return false;
    }
    let Ok(document) = Url::parse(&document_url) else {
        return false;
    };
    // Chrome may elide the scheme and a leading www in its displayed text.
    // These allowances only corroborate the already validated Document URL;
    // they are never a source of target URL, origin, or browser identity.
    let Some(display_url) = normalize_http_url(&format!("{}://{}", document.scheme(), display))
    else {
        return false;
    };
    let Ok(display) = Url::parse(&display_url) else {
        return false;
    };
    let same_host = display.host_str() == document.host_str()
        || document
            .host_str()
            .and_then(|host| host.strip_prefix("www."))
            == display.host_str();
    same_host
        && display.port_or_known_default() == document.port_or_known_default()
        && display.path() == document.path()
        && display.query() == document.query()
        && display.fragment() == document.fragment()
}

fn has_exact_window_ancestry(
    automation: &UIAutomation,
    walker: &UITreeWalker,
    element: &UIElement,
    window: &UIElement,
    reject_document_ancestor: bool,
    reject_toolbar_ancestor: bool,
    required_ancestors: Option<(&str, &str)>,
) -> bool {
    let mut cursor = match walker.get_parent(element) {
        Ok(parent) => parent,
        Err(_) => return false,
    };
    let mut toolbar_seen = false;
    let (mut required_id_seen, mut required_class_seen) = match required_ancestors {
        Some(_) => (false, false),
        None => (true, true),
    };
    for _ in 0..64 {
        let Ok(control_type) = cursor.get_control_type() else {
            return false;
        };
        if reject_document_ancestor && control_type == ControlType::Document {
            return false;
        }
        if reject_toolbar_ancestor && control_type == ControlType::ToolBar {
            toolbar_seen = true;
        }
        if let Some((id, class)) = required_ancestors {
            if !required_id_seen && cursor.get_automation_id().ok().as_deref() == Some(id) {
                required_id_seen = true;
            }
            if !required_class_seen
                && cursor
                    .get_classname()
                    .is_ok_and(|class_name| class_tokens_contain(&class_name, class))
            {
                required_class_seen = true;
            }
        }
        if control_type == ControlType::Window {
            return !toolbar_seen
                && required_id_seen
                && required_class_seen
                && automation
                    .compare_elements(&cursor, window)
                    .unwrap_or(false);
        }
        cursor = match walker.get_parent(&cursor) {
            Ok(parent) => parent,
            Err(_) => return false,
        };
    }
    false
}

fn target_match_kind(request: &TargetRequest, actual_url: &str) -> Result<&'static str, String> {
    if !request.site_url.is_empty() {
        let expected = normalize_http_url(&request.site_url)
            .ok_or_else(|| "windows_uia_invalid_target_url".to_string())?;
        return (actual_url == expected)
            .then_some("exact_url")
            .ok_or_else(|| "windows_uia_target_mismatch".to_string());
    }
    let actual_domain = Url::parse(actual_url)
        .ok()
        .and_then(|url| url.host_str().map(normalize_domain))
        .unwrap_or_default();
    (actual_domain == request.site_domain)
        .then_some("unique_domain")
        .ok_or_else(|| "windows_uia_target_mismatch".to_string())
}

fn foreground_snapshot(request: &TargetRequest) -> Result<ForegroundSnapshot, String> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return Err("windows_uia_geometry_no_foreground".to_string());
    }
    let mut pid = 0_u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    if pid == 0 || !process_identity_matches(pid, &request.browser_identity) {
        return Err("windows_uia_geometry_wrong_foreground".to_string());
    }
    Ok(ForegroundSnapshot {
        hwnd,
        pid,
        dpi: unsafe { GetDpiForWindow(hwnd) },
    })
}

fn verify_foreground_snapshot(
    request: &TargetRequest,
    snapshot: &ForegroundSnapshot,
) -> Result<(), String> {
    if unsafe { GetForegroundWindow() } != snapshot.hwnd {
        return Err("windows_uia_stale_target".to_string());
    }
    let mut pid = 0_u32;
    unsafe {
        GetWindowThreadProcessId(snapshot.hwnd, &mut pid);
    }
    if pid != snapshot.pid || !process_identity_matches(pid, &request.browser_identity) {
        return Err("windows_uia_stale_browser_identity".to_string());
    }
    Ok(())
}

fn process_identity_matches(pid: u32, expected: &str) -> bool {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return false;
    }
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let read =
        unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) } != 0;
    unsafe {
        CloseHandle(process);
    }
    if !read {
        return false;
    }
    let observed = String::from_utf16_lossy(&buffer[..length as usize]);
    normalize_windows_path(&observed) == normalize_windows_path(expected)
}

fn normalize_windows_path(value: &str) -> String {
    value.trim().replace('/', "\\").to_ascii_lowercase()
}

fn normalize_http_url(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().any(char::is_whitespace) || value.contains('\\') {
        return None;
    }
    let parsed = Url::parse(value).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    Some(parsed.to_string())
}

fn normalize_domain(value: &str) -> String {
    let normalized = value.trim().to_ascii_lowercase();
    normalized
        .strip_prefix("www.")
        .unwrap_or(&normalized)
        .to_string()
}

fn positive_rect(rect: &uiautomation::types::Rect) -> bool {
    rect.get_right() > rect.get_left() && rect.get_bottom() > rect.get_top()
}

fn overlaps(left: &uiautomation::types::Rect, right: &uiautomation::types::Rect) -> bool {
    left.get_right() > right.get_left()
        && left.get_left() < right.get_right()
        && left.get_bottom() > right.get_top()
        && left.get_top() < right.get_bottom()
}

fn rect_inside(
    child: &uiautomation::types::Rect,
    parent: &uiautomation::types::Rect,
    tolerance: i32,
) -> bool {
    child.get_left() >= parent.get_left() - tolerance
        && child.get_right() <= parent.get_right() + tolerance
        && child.get_top() >= parent.get_top() - tolerance
        && child.get_bottom() <= parent.get_bottom() + tolerance
}

fn ensure_deadline(deadline: Instant) -> Result<(), String> {
    (Instant::now() < deadline)
        .then_some(())
        .ok_or_else(|| "windows_uia_timeout".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ancestor classes measured in Edge on Windows 11 (2026-10-25): horizontal
    /// tabs sit directly in the container, vertical tabs inside a scroll view.
    #[test]
    fn edge_vertical_tabs_are_recognised_only_under_the_exact_scroll_wrappers() {
        let container = (ControlType::Tab, "EdgeTabContainerImpl".to_string());
        let pane = |class_name: &str| (ControlType::Pane, class_name.to_string());
        let edge = |ancestors: &[(ControlType, String)]| {
            tab_strip_ancestry_matches("msedge", &["EdgeTabContainerImpl"], ancestors)
        };

        assert!(edge(&[container.clone()]));
        let vertical = [
            pane("View"),
            pane("ScrollView::Viewport"),
            pane("ScrollView"),
            container.clone(),
        ];
        assert!(edge(&vertical));

        // Only the measured wrappers, in order, ending in the container.
        assert!(!edge(&[
            pane("ScrollView"),
            pane("ScrollView::Viewport"),
            pane("View"),
            container.clone(),
        ]));
        assert!(!edge(&[
            pane("View"),
            pane("View"),
            pane("ScrollView::Viewport"),
            pane("ScrollView"),
            container.clone(),
        ]));
        assert!(!edge(&[
            pane("View"),
            pane("ScrollView::Viewport"),
            pane("ScrollView"),
            (ControlType::Tab, "EdgeSomethingElse".to_string()),
        ]));
        assert!(!edge(&vertical[..3]));
        assert!(!edge(&[]));

        // Chrome and Brave keep requiring tabs directly in their container.
        assert!(!tab_strip_ancestry_matches("chrome", &["EdgeTabContainerImpl"], &vertical));
        assert!(!tab_strip_ancestry_matches(
            "brave",
            &["BraveTabContainer"],
            &[pane("View"), (ControlType::Tab, "BraveTabContainer".to_string())],
        ));
    }

    /// Chrome 157 and earlier name the strip `TabContainerImpl`; Chrome 158
    /// (measured 158.0.8127.38 on Windows 11) names it `TabContainer`.
    #[test]
    fn chrome_tabs_are_recognised_under_either_tab_container_class() {
        let chrome = |ancestors: &[(ControlType, String)]| {
            tab_strip_ancestry_matches("chrome", &CHROME_TAB_CONTAINER_CLASSES, ancestors)
        };
        let tab_list = |class_name: &str| (ControlType::Tab, class_name.to_string());

        assert!(chrome(&[tab_list("TabContainerImpl")]));
        assert!(chrome(&[tab_list("TabContainer")]));

        // Still only the tab list control directly above the tab.
        assert!(!chrome(&[tab_list("TabContainerX")]));
        assert!(!chrome(&[(ControlType::Pane, "TabContainer".to_string())]));
        assert!(!chrome(&[
            (ControlType::Pane, "View".to_string()),
            tab_list("TabContainer"),
        ]));
        assert!(!chrome(&[]));
    }

    /// Ancestor classes measured under Chrome 158 and 159 vertical tabs
    /// (2026-11-26): plain, pinned, grouped and split tabs.
    #[test]
    fn chrome_tab_views_are_recognised_only_on_the_measured_strip_path() {
        let pane = |class_name: &str| (ControlType::Pane, class_name.to_string());
        let path = |wrappers: &[&str], container: &str, strip_type: ControlType| {
            let mut ancestors: Vec<_> = wrappers.iter().map(|wrapper| pane(wrapper)).collect();
            ancestors.extend([
                pane(container),
                pane("ScrollView::Viewport"),
                pane("ScrollView"),
                (strip_type, "TabStripView".to_string()),
            ]);
            ancestors
        };
        let matches = |wrappers: &[&str], container: &str, strip_type: ControlType| {
            chrome_tab_view_ancestry_matches(&path(wrappers, container, strip_type))
        };
        let unpinned = "UnpinnedTabContainerView";
        let tab_list = ControlType::Tab;

        assert!(matches(&[], unpinned, ControlType::Pane));
        assert!(matches(&[], unpinned, tab_list));
        assert!(matches(&[], "PinnedTabContainerView", tab_list));
        assert!(matches(&["TabGroupView"], unpinned, tab_list));
        assert!(matches(&["SplitTabView"], unpinned, tab_list));
        assert!(matches(&["SplitTabView", "TabGroupView"], unpinned, tab_list));

        // Only the known wrappers, at most once each and in that order.
        assert!(!matches(&["TabGroupView", "SplitTabView"], unpinned, tab_list));
        assert!(!matches(&["TabGroupView", "TabGroupView"], unpinned, tab_list));
        assert!(!matches(&["View"], unpinned, tab_list));
        assert!(!matches(&[], "TabContainer", tab_list));
        assert!(!matches(&[], unpinned, ControlType::Group));
        let mut no_scroll_view = path(&[], unpinned, tab_list);
        no_scroll_view.remove(2);
        assert!(!chrome_tab_view_ancestry_matches(&no_scroll_view));
        let mut container_as_tab_list = path(&[], unpinned, tab_list);
        container_as_tab_list[0].0 = ControlType::Tab;
        assert!(!chrome_tab_view_ancestry_matches(&container_as_tab_list));
        assert!(!chrome_tab_view_ancestry_matches(&[]));
    }

    #[test]
    fn delayed_selection_read_cannot_extend_the_action_budget() {
        let deadline = Instant::now() + Duration::from_millis(10);
        let result = verify_invoke_target(
            deadline,
            || {
                thread::sleep(Duration::from_millis(20));
                true
            },
            || panic!("expired selection must not start another provider read"),
            || Ok(()),
        );
        assert_eq!(result, Err("windows_uia_timeout".to_string()));
    }

    #[test]
    fn foreground_is_verified_after_the_final_selection_read() {
        let selected_read_finished = std::cell::Cell::new(false);
        let result = verify_invoke_target(
            Instant::now() + UIA_ACTION_TIMEOUT,
            || {
                selected_read_finished.set(true);
                true
            },
            || Ok(()),
            || {
                assert!(selected_read_finished.get());
                Err("windows_uia_stale_target".to_string())
            },
        );
        assert_eq!(result, Err("windows_uia_stale_target".to_string()));
    }

    #[test]
    fn current_selected_target_is_allowed_and_deselected_target_is_refused() {
        let deadline = Instant::now() + UIA_ACTION_TIMEOUT;
        assert_eq!(
            verify_invoke_target(deadline, || true, || Ok(()), || Ok(())),
            Ok(())
        );
        assert_eq!(
            verify_invoke_target(
                deadline,
                || false,
                || panic!("deselected target"),
                || panic!("deselected target"),
            ),
            Err("windows_uia_stale_target".to_string())
        );
    }

    #[test]
    fn address_is_verified_after_the_final_selection_read() {
        let selected_read_finished = std::cell::Cell::new(false);
        let result = verify_invoke_target(
            Instant::now() + UIA_ACTION_TIMEOUT,
            || {
                selected_read_finished.set(true);
                true
            },
            || {
                assert!(selected_read_finished.get());
                Err("windows_uia_address_mismatch".to_string())
            },
            || panic!("changed URL cannot reach Invoke"),
        );
        assert_eq!(result, Err("windows_uia_address_mismatch".to_string()));
    }

    #[test]
    fn delayed_address_read_cannot_extend_the_action_budget() {
        let result = verify_invoke_target(
            Instant::now() + Duration::from_millis(10),
            || true,
            || {
                thread::sleep(Duration::from_millis(20));
                Ok(())
            },
            || Ok(()),
        );
        assert_eq!(result, Err("windows_uia_timeout".to_string()));
    }

    #[test]
    fn foreground_is_verified_after_the_final_address_read() {
        let address_read_finished = std::cell::Cell::new(false);
        let result = verify_invoke_target(
            Instant::now() + UIA_ACTION_TIMEOUT,
            || true,
            || {
                address_read_finished.set(true);
                Ok(())
            },
            || {
                assert!(address_read_finished.get());
                Err("windows_uia_stale_target".to_string())
            },
        );
        assert_eq!(result, Err("windows_uia_stale_target".to_string()));
    }

    #[test]
    fn unavailable_address_is_refused_before_invoke() {
        let result = verify_invoke_target(
            Instant::now() + UIA_ACTION_TIMEOUT,
            || true,
            || Err("windows_uia_address_unavailable".to_string()),
            || panic!("unverified URL cannot reach Invoke"),
        );
        assert_eq!(result, Err("windows_uia_address_unavailable".to_string()));
    }

    #[test]
    fn close_completion_budget_does_not_extend_the_pre_invoke_action_budget() {
        assert_eq!(UIA_ACTION_TIMEOUT, Duration::from_secs(5));
        assert!(UIA_CLOSE_COMPLETION_TIMEOUT > UIA_ACTION_TIMEOUT);
        assert!(UIA_CLOSE_COMPLETION_TIMEOUT >= UIA_ACTION_TIMEOUT + POST_CLOSE_SETTLE);
        assert!(
            UIA_CLOSE_COMPLETION_TIMEOUT
                >= UIA_ACTION_TIMEOUT + POST_CLOSE_SETTLE + LAST_TAB_WINDOW_CLOSE_WAIT
        );
    }

    #[test]
    fn url_identity_is_exact_and_case_sensitive_below_the_authority() {
        assert_eq!(
            normalize_http_url("HTTPS://Example.COM:443/Case?Token=AbC#Frag"),
            Some("https://example.com/Case?Token=AbC#Frag".to_string())
        );
        assert_ne!(
            normalize_http_url("https://example.com/Case?Token=AbC"),
            normalize_http_url("https://example.com/case?Token=abc")
        );
    }

    #[test]
    fn url_identity_rejects_unsafe_or_unverifiable_targets() {
        for value in [
            "example.com/path",
            "file:///C:/private.txt",
            "https://user@example.com/path",
            "https://example.com/a b",
            r"https:\\example.com\path",
        ] {
            assert_eq!(normalize_http_url(value), None, "{value}");
        }
    }

    #[test]
    fn chrome_address_corroboration_accepts_only_supported_display_elision() {
        let document = "https://www.example.com/Case?Token=AbC#Frag";
        for display in [
            document,
            "www.example.com/Case?Token=AbC#Frag",
            "example.com/Case?Token=AbC#Frag",
        ] {
            assert!(
                chrome_display_address_matches_document(display, document),
                "{display}"
            );
        }
        assert!(chrome_display_address_matches_document(
            "127.0.0.1:19517/?role=target",
            "http://127.0.0.1:19517/?role=target"
        ));
        assert!(!chrome_display_address_matches_document(
            "https://example.com/Case?Token=AbC#Frag",
            document
        )); // Explicit URLs still require the complete authority.
    }

    #[test]
    fn chrome_address_corroboration_refuses_changed_path_query_fragment_and_port() {
        let document = "https://www.example.com/Case?Token=AbC#Frag";
        for display in [
            "example.com/case?Token=AbC#Frag",
            "example.com/Case?Token=abc#Frag",
            "example.com/Case?Token=AbC&changed=1#Frag",
            "example.com/Case?Token=AbC#Other",
            "example.com:444/Case?Token=AbC#Frag",
            "other.example.com/Case?Token=AbC#Frag",
            "http://www.example.com/Case?Token=AbC#Frag",
        ] {
            assert!(
                !chrome_display_address_matches_document(display, document),
                "{display}"
            );
        }
    }

    #[test]
    fn chrome_address_corroboration_refuses_edited_or_unsupported_text() {
        for display in [
            "",
            " https://example.com/",
            "https://example.com/ ",
            "example.com/ ",
            "Search example.com",
            "file:///C:/private.txt",
            "//example.com/",
            "example.com/a b",
            "user@example.com/",
            r"example.com\path",
        ] {
            assert!(
                !chrome_display_address_matches_document(display, "https://example.com/"),
                "{display}"
            );
        }
    }

    #[test]
    fn rectangle_guards_require_positive_contained_geometry() {
        let tab = uiautomation::types::Rect::new(100, 10, 300, 50);
        let close = uiautomation::types::Rect::new(270, 20, 290, 40);
        assert!(positive_rect(&tab));
        assert!(rect_inside(&close, &tab, 2));
        assert!(overlaps(&close, &tab));
        assert!(!positive_rect(&uiautomation::types::Rect::new(2, 2, 2, 3)));
        assert!(!rect_inside(
            &uiautomation::types::Rect::new(0, 0, 20, 20),
            &tab,
            2
        ));
    }

    #[test]
    fn close_success_keeps_the_existing_external_diagnostic_contract() {
        assert_eq!(
            close_success_diagnostic("exact_url"),
            "windows_uia_exact_url"
        );
        assert_eq!(
            close_success_diagnostic("unique_domain"),
            "windows_uia_unique_domain"
        );
    }

    #[test]
    fn post_close_requires_a_survivor_and_exact_target_runtime_id_absence() {
        let closed = vec![1, 2, 3];
        assert!(post_close_runtime_ids_verify(
            &[vec![4, 5, 6], vec![7, 8, 9]],
            &closed,
        ));
        assert!(!post_close_runtime_ids_verify(&[], &closed));
        assert!(!post_close_runtime_ids_verify(
            &[vec![4, 5, 6], closed.clone()],
            &closed,
        ));
    }

    #[test]
    fn a_slowly_closing_tab_is_verified_once_it_leaves_the_strip() {
        let closed = vec![1, 2, 3];
        let mut reads = vec![
            Ok(vec![vec![4, 5, 6], closed.clone()]),
            Ok(vec![closed.clone(), vec![4, 5, 6]]),
            Ok(vec![vec![4, 5, 6]]),
        ]
        .into_iter();
        let mut sleeps = 0;
        let result = wait_for_verified_close(
            Instant::now() + Duration::from_secs(60),
            || reads.next().expect("no read after verification"),
            &closed,
            |_| sleeps += 1,
        );
        assert_eq!(result, Ok(()));
        assert_eq!(sleeps, 2);
    }

    #[test]
    fn a_tab_still_present_at_the_deadline_is_not_verified() {
        let closed = vec![1, 2, 3];
        let mut reads = 0;
        let result = wait_for_verified_close(
            Instant::now(),
            || {
                reads += 1;
                Ok(vec![vec![4, 5, 6], closed.clone()])
            },
            &closed,
            |_| panic!("no wait after the deadline"),
        );
        assert_eq!(result, Err("windows_uia_no_verified_close".to_string()));
        assert_eq!(reads, 1);
        assert_eq!(
            wait_for_verified_close(
                Instant::now(),
                || Err("windows_uia_stale_window".to_string()),
                &closed,
                |_| {},
            ),
            Err("windows_uia_stale_window".to_string()),
        );
    }

    struct TestWindow(HWND);

    impl TestWindow {
        fn new() -> Self {
            use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, WS_POPUP};
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let hwnd = unsafe {
                CreateWindowExW(
                    0,
                    class.as_ptr(),
                    class.as_ptr(),
                    WS_POPUP,
                    0,
                    0,
                    1,
                    1,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                )
            };
            assert!(!hwnd.is_null(), "create an invisible test-owned window");
            Self(hwnd)
        }
    }

    impl Drop for TestWindow {
        fn drop(&mut self) {
            unsafe { windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow(self.0) };
        }
    }

    #[test]
    fn last_tab_confirmation_observes_only_the_original_window() {
        let target = TestWindow::new();
        let sentinel = TestWindow::new();
        assert_ne!(
            unsafe { windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow(target.0) },
            0
        );
        assert!(wait_for_original_window_close(target.0, Instant::now()));
        assert_ne!(unsafe { IsWindow(sentinel.0) }, 0);
    }

    #[test]
    fn last_tab_confirmation_refuses_a_live_window_without_closing_it() {
        let target = TestWindow::new();
        assert!(!wait_for_original_window_close(target.0, Instant::now()));
        assert_ne!(unsafe { IsWindow(target.0) }, 0);
    }

    fn rect(left: i32, right: i32) -> uiautomation::types::Rect {
        uiautomation::types::Rect::new(left, 13, right, 43)
    }

    #[test]
    fn firefox_close_is_the_close_button_class_not_the_rightmost_button() {
        // Measured Firefox 154 selected tab with the UI mirrored right to left:
        // the audio toggle (no class) is rightmost, the close button leftmost.
        let rtl = vec![
            (rect(1315, 1345), "audio", String::new()),
            (
                rect(1084, 1114),
                "close",
                "tab-close-button close-icon".to_string(),
            ),
        ];
        assert_eq!(
            select_close_button("firefox", rtl).map(|(_, id)| id),
            Some("close")
        );
    }

    #[test]
    fn chromium_rtl_audio_does_not_override_the_actual_close_button() {
        // Measured Arabic Chrome/Edge: the invokable audio indicator is to
        // the right of the tab close button. Its label is localized.
        for (browser, close_class) in [
            ("chrome", "TabCloseButton"),
            ("msedge", "EdgeTabCloseButton"),
            ("brave", "TabCloseButton"),
        ] {
            let rtl = vec![
                (rect(1395, 1415), "mute", "AlertIndicatorButton".into()),
                (rect(1165, 1185), "close", close_class.into()),
            ];
            assert_eq!(
                select_close_button(browser, rtl).map(|(_, id)| id),
                Some("close"),
                "{browser}",
            );
        }
    }

    #[test]
    fn every_chromium_browser_may_close_its_last_tab_but_gecko_does_not() {
        for process_name in ["chrome", "msedge", "brave"] {
            assert!(closes_window_with_last_tab(process_name), "{process_name}");
        }
        for process_name in ["firefox", "floorp", "waterfox", ""] {
            assert!(!closes_window_with_last_tab(process_name), "{process_name}");
        }
    }

    #[test]
    fn chromium_requires_one_recognized_close_control() {
        for (browser, close_class) in [
            ("chrome", "TabCloseButton"),
            ("msedge", "EdgeTabCloseButton"),
            ("brave", "TabCloseButton"),
        ] {
            let audio_only = vec![(rect(1395, 1415), "mute", "AlertIndicatorButton".into())];
            assert!(select_close_button(browser, audio_only).is_none());
            let unknown = vec![(rect(1165, 1185), "unknown", format!("{close_class}Extra"))];
            assert!(select_close_button(browser, unknown).is_none());
            let ambiguous = vec![
                (rect(1165, 1185), "close-a", close_class.into()),
                (rect(1195, 1215), "close-b", close_class.into()),
            ];
            assert!(select_close_button(browser, ambiguous).is_none());
        }
    }

    #[test]
    fn firefox_without_its_close_button_refuses_instead_of_pressing_the_audio_toggle() {
        // userChrome.css hiding .tab-close-button removes it from the tree and
        // leaves the audio toggle as the only button.
        let hidden = vec![(rect(575, 605), "audio", String::new())];
        assert_eq!(
            select_close_button("firefox", hidden).map(|(_, id)| id),
            None
        );
        let ambiguous = vec![
            (rect(575, 605), "close-a", "tab-close-button".to_string()),
            (rect(806, 836), "close-b", "tab-close-button".to_string()),
        ];
        assert_eq!(
            select_close_button("firefox", ambiguous).map(|(_, id)| id),
            None
        );
        let floorp = vec![
            (rect(1116, 1137), "audio", String::new()),
            (
                rect(1364, 1388),
                "close",
                "tab-close-button close-icon".to_string(),
            ),
        ];
        assert_eq!(
            select_close_button("floorp", floorp).map(|(_, id)| id),
            Some("close")
        );
        assert!(is_gecko_process("waterfox"));
        assert!(!is_gecko_process("librewolf"));
        assert!(!is_gecko_process("zen"));
        assert!(!class_tokens_contain(
            "tab-close-button-extra",
            "tab-close-button"
        ));
        assert!(class_tokens_contain(
            "tab-close-button close-icon",
            "tab-close-button"
        ));
    }
}
