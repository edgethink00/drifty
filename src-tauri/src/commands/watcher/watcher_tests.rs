use super::*;

#[test]
fn positions_watcher_above_work_area_bottom() {
    let position = calculate_watcher_window_position(0.0, 25.0, 1440.0, 775.0);

    assert_eq!(position.x, 440.0);
    assert_eq!(position.y, 428.0);
}

#[test]
fn centers_watcher_inside_shifted_work_area() {
    let position = calculate_watcher_window_position(80.0, 0.0, 1360.0, 900.0);

    assert_eq!(position.x, 480.0);
    assert_eq!(position.y, 528.0);
}

#[test]
fn positions_end_of_day_review_top_right_in_work_area() {
    let position = calculate_end_of_day_review_window_position(0.0, 25.0, 1440.0, 775.0);

    assert_eq!(position.x, 848.0);
    assert_eq!(position.y, 57.0);
}

#[test]
fn positions_resident_companion_pill_top_right() {
    let position = calculate_companion_pill_default_position(0.0, 33.0, 1728.0);

    /* The native window overhangs by its transparent gutter so the *visible
    capsule*, rather than the window frame, lands flush with the display edge. */
    assert_eq!(
        position.x + COMPANION_PILL_CANVAS_WIDTH + COMPANION_PILL_GUTTER_X,
        1728.0,
    );
    assert_eq!(position.y + COMPANION_PILL_GUTTER_Y, 57.0);
}

#[test]
fn positions_standalone_milestone_with_the_same_visible_top_right_anchor() {
    let position = calculate_standalone_milestone_window_position(0.0, 33.0, 1728.0);

    assert_eq!(
        position.x + STANDALONE_MILESTONE_WINDOW_WIDTH - COMPANION_PILL_GUTTER_X,
        1728.0,
    );
    assert_eq!(position.y + COMPANION_PILL_GUTTER_Y, 57.0);
}

#[test]
fn positions_companion_pill_before_its_first_visible_frame() {
    let source = include_str!("../watcher.rs");
    let enable_body = source
        .split("fn set_companion_surface_policy")
        .nth(1)
        .expect("companion surface policy implementation")
        .split("fn validate_companion_visibility_action")
        .next()
        .expect("companion surface policy body");

    let position = enable_body
        .find("position_companion_pill_default(app)?")
        .expect("default position is applied");
    let show = enable_body
        .find("show_companion_panel(app, &window)?")
        .expect("companion panel is shown");

    assert!(
        position < show,
        "the hidden companion pill must be positioned before it is shown",
    );
}

#[test]
fn parses_all_companion_surface_policies() {
    assert_eq!(
        CompanionSurfacePolicy::parse("floating").unwrap(),
        CompanionSurfacePolicy::Floating,
    );
    assert_eq!(
        CompanionSurfacePolicy::parse("menuBar").unwrap(),
        CompanionSurfacePolicy::MenuBar,
    );
    assert_eq!(
        CompanionSurfacePolicy::parse("off").unwrap(),
        CompanionSurfacePolicy::Off,
    );
    assert!(CompanionSurfacePolicy::parse("legacy").is_err());
}

#[test]
fn identifies_only_event_cards_as_direct_menu_bar_moments() {
    assert!(is_companion_moment_payload(&serde_json::json!({
        "kind": "milestone",
        "id": "day3h"
    })));
    assert!(is_companion_moment_payload(&serde_json::json!({
        "kind": "companionDriftAlarm"
    })));
    assert!(is_companion_moment_payload(&serde_json::json!({
        "kind": "reentry"
    })));
    assert!(!is_companion_moment_payload(&serde_json::json!({
        "focusSecondsToday": 3_600,
        "productivity": "focus"
    })));
}

#[test]
fn every_menu_bar_card_reenters_from_the_status_item() {
    for state in ["milestone", "reentry", "drift", "nudge", "eod"] {
        assert!(should_prepare_direct_menu_bar_card(true, state));
    }
    for state in ["collapsed", "peek"] {
        assert!(!should_prepare_direct_menu_bar_card(true, state));
    }
    assert!(!should_prepare_direct_menu_bar_card(false, "milestone"));
}

#[test]
fn marks_menu_bar_events_before_the_webview_can_paint_them() {
    let mut menu_bar_payload = serde_json::json!({ "kind": "milestone" });
    annotate_companion_presentation(&mut menu_bar_payload, true);
    assert_eq!(
        menu_bar_payload["__companionPresentation"],
        serde_json::json!("menuBar")
    );

    let mut floating_payload = serde_json::json!({ "kind": "milestone" });
    annotate_companion_presentation(&mut floating_payload, false);
    assert_eq!(
        floating_payload["__companionPresentation"],
        serde_json::json!("floating")
    );
}

#[test]
fn menu_bar_companion_centers_each_card_under_the_status_item() {
    let collapsed_width = COMPANION_PILL_COLLAPSED_WIDTH;
    let collapsed_left_inset =
        companion_pill_left_inset("collapsed", COMPANION_PILL_GUTTER_X).unwrap();
    let collapsed = calculate_menu_bar_companion_position(
        1_000.0,
        0.0,
        18.0,
        24.0,
        0.0,
        24.0,
        1_728.0,
        collapsed_width,
        collapsed_left_inset,
        COMPANION_PILL_GUTTER_Y,
    );
    let moment_width = companion_pill_capsule_size("drift").unwrap().0;
    let moment_left_inset = companion_pill_left_inset("drift", COMPANION_PILL_GUTTER_X).unwrap();
    let moment = calculate_menu_bar_companion_position(
        1_000.0,
        0.0,
        18.0,
        24.0,
        0.0,
        24.0,
        1_728.0,
        moment_width,
        moment_left_inset,
        COMPANION_PILL_GUTTER_Y,
    );

    let tray_center = 1_009.0;
    let collapsed_left = collapsed.window_position.x + collapsed_left_inset;
    let moment_left = moment.window_position.x + moment_left_inset;
    assert_eq!(collapsed_left + collapsed_width / 2.0, tray_center);
    assert_eq!(moment_left + moment_width / 2.0, tray_center);
    assert_eq!(collapsed.anchor_x, collapsed_width / 2.0);
    assert_eq!(moment.anchor_x, moment_width / 2.0);
    assert_eq!(collapsed.window_position.y + COMPANION_PILL_GUTTER_Y, 30.0);
}

#[test]
fn menu_bar_companion_clamps_at_the_screen_edge_but_keeps_pointing_to_the_status_item() {
    let moment_width = companion_pill_capsule_size("milestone").unwrap().0;
    let left_inset = companion_pill_left_inset("milestone", COMPANION_PILL_GUTTER_X).unwrap();
    let placement = calculate_menu_bar_companion_position(
        1_700.0,
        0.0,
        18.0,
        24.0,
        0.0,
        24.0,
        1_728.0,
        moment_width,
        left_inset,
        COMPANION_PILL_GUTTER_Y,
    );

    let capsule_left = placement.window_position.x + left_inset;
    assert_eq!(capsule_left + moment_width, 1_728.0);
    assert_eq!(capsule_left + placement.anchor_x, 1_709.0);
}

#[test]
fn routes_interaction_queries_to_the_selected_native_surface() {
    assert_eq!(
        watcher_surface_window_label(false),
        WATCHER_PEEK_WINDOW_LABEL
    );
    assert_eq!(
        watcher_surface_window_label(true),
        COMPANION_PILL_WINDOW_LABEL
    );
}

#[test]
fn accepts_only_companion_visibility_menu_actions() {
    assert!(validate_companion_visibility_action("hideOneHour").is_ok());
    assert!(validate_companion_visibility_action("turnOff").is_ok());
    assert!(validate_companion_visibility_action("openDashboard").is_err());
}

/// The resident pill is a non-activating panel, so macOS would otherwise spend
/// the first press from another app on activation and never deliver it to the
/// webview. That made the pill undraggable until a second click. The setting
/// belongs to the companion builder specifically: it was once applied to the
/// watcher window by mistake, which looked correct in review but fixed nothing.
#[test]
fn companion_pill_window_accepts_the_first_click_from_an_inactive_app() {
    let source = include_str!("../watcher.rs");
    let companion_builder = source
        .split("pub fn setup_companion_pill_window")
        .nth(1)
        .expect("companion pill window setup");
    let builder_body = companion_builder
        .split(".build()?")
        .next()
        .expect("companion pill builder chain");

    assert!(
        builder_body.contains(".accept_first_mouse(true)"),
        "the companion pill window must accept the first mouse press",
    );
}

/// The milestone window is grown by a transparent gutter so confetti can fly
/// past the capsule. The stylesheet insets the capsule by the same amount, so
/// if the two ever disagree the pill is drawn off-centre inside its window.
#[test]
fn gutters_match_the_insets_used_by_the_stylesheet() {
    let styles = include_str!("../../../../apps/desktop/src/styles/companion-pill.css");

    for (property, expected) in [
        ("--pill-gutter-x", COMPANION_PILL_GUTTER_X),
        ("--pill-gutter-y", COMPANION_PILL_GUTTER_Y),
    ] {
        let declaration = styles
            .split(&format!("{property}:"))
            .nth(1)
            .unwrap_or_else(|| panic!("{property} is declared for the companion surface"))
            .split(';')
            .next()
            .expect("declaration value")
            .trim()
            .trim_end_matches("px");

        assert_eq!(
            declaration.parse::<f64>().expect("numeric gutter"),
            expected,
            "{property} must match the native gutter it mirrors",
        );
    }
}

#[test]
fn sizes_each_companion_pill_state_to_its_interactive_surface() {
    /* The capsule keeps the sizes the design was drawn against. */
    assert_eq!(
        companion_pill_capsule_size("collapsed").unwrap(),
        (220.0, 28.9)
    );
    assert_eq!(companion_pill_capsule_size("peek").unwrap(), (220.0, 28.9));
    assert_eq!(
        companion_pill_capsule_size("milestone").unwrap(),
        (410.0, 54.0)
    );
    assert_eq!(
        companion_pill_capsule_size("reentry").unwrap(),
        (410.0, 54.0)
    );
    assert_eq!(
        companion_pill_capsule_size("drift").unwrap(),
        (352.0, 130.0)
    );
    assert_eq!(
        companion_pill_capsule_size("nudge").unwrap(),
        (352.0, 130.0)
    );
    assert_eq!(companion_pill_capsule_size("eod").unwrap(), (331.0, 480.0));
    assert_eq!(
        companion_pill_capsule_size("eodCompact").unwrap(),
        (310.0, 284.0)
    );
    assert_eq!(
        companion_pill_capsule_size("eodMinimal").unwrap(),
        (310.0, 223.0)
    );

    /* Every state shares the widest horizontal canvas. The capsule changes
    width inside it while the native right edge remains fixed. */
    assert_eq!(
        companion_pill_dimensions("collapsed").unwrap(),
        (
            COMPANION_PILL_CANVAS_WIDTH + COMPANION_PILL_GUTTER_X * 2.0,
            28.9 + COMPANION_PILL_GUTTER_Y * 2.0
        )
    );
    assert_eq!(
        companion_pill_dimensions("milestone").unwrap(),
        (
            COMPANION_PILL_CANVAS_WIDTH + COMPANION_PILL_GUTTER_X * 2.0,
            54.0 + COMPANION_PILL_GUTTER_Y * 2.0
        )
    );
    assert_eq!(
        companion_pill_dimensions("reentry").unwrap(),
        (
            COMPANION_PILL_CANVAS_WIDTH + COMPANION_PILL_GUTTER_X * 2.0,
            54.0 + COMPANION_PILL_GUTTER_Y * 2.0
        )
    );
    assert_eq!(
        companion_pill_dimensions("eod").unwrap(),
        (
            COMPANION_PILL_CANVAS_WIDTH + COMPANION_PILL_GUTTER_X * 2.0,
            480.0 + COMPANION_PILL_GUTTER_Y * 2.0
        )
    );
    assert_eq!(
        companion_pill_dimensions("eodCompact").unwrap(),
        (
            COMPANION_PILL_CANVAS_WIDTH + COMPANION_PILL_GUTTER_X * 2.0,
            284.0 + COMPANION_PILL_GUTTER_Y * 2.0
        )
    );
    assert_eq!(
        companion_pill_dimensions("eodMinimal").unwrap(),
        (
            COMPANION_PILL_CANVAS_WIDTH + COMPANION_PILL_GUTTER_X * 2.0,
            223.0 + COMPANION_PILL_GUTTER_Y * 2.0
        )
    );
}

#[test]
fn sizes_end_of_day_review_as_redesigned_review_panel() {
    let payload = serde_json::json!({"kind": "endOfDayReview"});
    let (width, height) = watcher_window_dimensions_for_payload(&payload);

    assert_eq!(width, 560.0);
    assert_eq!(height, 720.0);
}

#[test]
fn sizes_standalone_milestone_for_the_capsule_and_confetti_gutter() {
    let payload = serde_json::json!({"kind": "milestone"});

    assert_eq!(
        watcher_window_dimensions_for_payload(&payload),
        (
            STANDALONE_MILESTONE_WINDOW_WIDTH,
            STANDALONE_MILESTONE_WINDOW_HEIGHT,
        )
    );
}

#[test]
fn sizes_standalone_reentry_for_its_calm_companion_card() {
    let payload = serde_json::json!({"kind": "reentry"});

    assert_eq!(
        watcher_window_dimensions_for_payload(&payload),
        (
            COMPANION_PILL_REENTRY_WIDTH + COMPANION_PILL_GUTTER_X * 2.0,
            COMPANION_PILL_REENTRY_HEIGHT + COMPANION_PILL_GUTTER_Y * 2.0,
        )
    );
    assert!(is_reentry_payload(&payload));
    assert!(!should_ignore_cursor_events_for_payload(&payload));
}

#[test]
fn keeps_normal_watcher_peek_size_for_standard_payloads() {
    let payload = serde_json::json!({"kind": "watcherPeek"});
    let (width, height) = watcher_window_dimensions_for_payload(&payload);

    assert_eq!(width, WATCHER_PEEK_WIDTH);
    assert_eq!(height, WATCHER_PEEK_HEIGHT);
}

#[test]
fn interactive_extreme_nudge_toast_accepts_cursor_events() {
    let payload = serde_json::json!({"kind": "extremeNudgeToast", "placement": "top-right"});

    assert!(!should_ignore_cursor_events_for_payload(&payload));
}

#[test]
fn standalone_milestone_accepts_cursor_events() {
    let payload = serde_json::json!({"kind": "milestone"});

    assert!(is_milestone_payload(&payload));
    assert!(!should_ignore_cursor_events_for_payload(&payload));
}

#[test]
fn keeps_end_of_day_review_inside_shifted_work_area_when_space_allows() {
    let position = calculate_end_of_day_review_window_position(80.0, 24.0, 1360.0, 900.0);

    assert_eq!(position.x, 848.0);
    assert_eq!(position.y, 56.0);
}

#[test]
fn detects_end_of_day_review_payload_by_kind() {
    let payload = serde_json::json!({"kind": "endOfDayReview"});

    assert!(is_end_of_day_review_payload(&payload));
}

#[test]
fn does_not_detect_end_of_day_review_payload_by_placement_only() {
    let payload = serde_json::json!({"placement": "top-right"});

    assert!(!is_end_of_day_review_payload(&payload));
}

#[test]
fn does_not_detect_normal_watcher_payload() {
    let payload = serde_json::json!({
        "kind": "watcherPeek",
        "placement": "bottom-left"
    });

    assert!(!is_end_of_day_review_payload(&payload));
}

#[test]
fn end_of_day_review_payload_accepts_cursor_events() {
    let payload = serde_json::json!({"kind": "endOfDayReview"});

    assert!(!should_ignore_cursor_events_for_payload(&payload));
}

#[test]
fn normal_watcher_payload_ignores_cursor_events() {
    let payload = serde_json::json!({"kind": "watcherPeek"});

    assert!(should_ignore_cursor_events_for_payload(&payload));
}

#[test]
fn companion_pill_drag_uses_safe_top_and_flexible_side_and_bottom_edges() {
    let (min_x, min_y, max_x, max_y) =
        calculate_companion_capsule_drag_bounds(0.0, 0.0, 1728.0, 1117.0, 33.0, 220.0, 28.9);

    assert_eq!(min_x, -148.0);
    assert_eq!(min_y, 33.0);
    assert_eq!(max_x, 1656.0);
    assert_eq!(max_y, 1093.0);
}

#[test]
fn watcher_peek_cursor_inside_detects_inside_point() {
    let cursor = tauri::PhysicalPosition::new(220.0, 180.0);
    let rect_position = tauri::PhysicalPosition::new(100, 120);
    let rect_size = tauri::PhysicalSize::new(240, 160);

    assert!(is_cursor_inside_watcher_rect(
        cursor,
        (rect_position, rect_size)
    ));
}

#[test]
fn watcher_peek_cursor_inside_rejects_outside_left_point() {
    let cursor = tauri::PhysicalPosition::new(99.0, 180.0);
    let rect_position = tauri::PhysicalPosition::new(100, 120);
    let rect_size = tauri::PhysicalSize::new(240, 160);

    assert!(!is_cursor_inside_watcher_rect(
        cursor,
        (rect_position, rect_size)
    ));
}

#[test]
fn watcher_peek_cursor_inside_rejects_outside_bottom_point() {
    let cursor = tauri::PhysicalPosition::new(220.0, 281.0);
    let rect_position = tauri::PhysicalPosition::new(100, 120);
    let rect_size = tauri::PhysicalSize::new(240, 160);

    assert!(!is_cursor_inside_watcher_rect(
        cursor,
        (rect_position, rect_size)
    ));
}

#[test]
fn watcher_peek_cursor_inside_includes_boundary_point() {
    let cursor = tauri::PhysicalPosition::new(340.0, 280.0);
    let rect_position = tauri::PhysicalPosition::new(100, 120);
    let rect_size = tauri::PhysicalSize::new(240, 160);

    assert!(is_cursor_inside_watcher_rect(
        cursor,
        (rect_position, rect_size)
    ));
}
