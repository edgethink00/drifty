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
fn sizes_end_of_day_review_as_redesigned_review_panel() {
    let payload = serde_json::json!({"kind": "endOfDayReview"});
    let (width, height) = watcher_window_dimensions_for_payload(&payload);

    assert_eq!(width, 560.0);
    assert_eq!(height, 720.0);
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
