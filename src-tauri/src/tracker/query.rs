use super::{build_period_payload, TrackerController, TrackerError};
use serde_json::{json, Value};
use tauri::AppHandle;

impl TrackerController {
    pub fn get_timeline(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(app, "get_timeline", build_period_payload(day, start, end))
    }

    pub fn get_timeline_page(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        before_segment_id: Option<String>,
        before_ended_at: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_timeline_page",
            build_timeline_page_payload(day, start, end, before_segment_id, before_ended_at, limit),
        )
    }

    pub fn search_timeline(
        &self,
        app: &AppHandle,
        query: String,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        before_segment_id: Option<String>,
        before_ended_at: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "search_timeline",
            build_timeline_search_payload(
                query,
                day,
                start,
                end,
                before_segment_id,
                before_ended_at,
                limit,
            ),
        )
    }

    pub fn get_dashboard_week_timeline(
        &self,
        app: &AppHandle,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_dashboard_week_timeline",
            build_dashboard_week_timeline_payload(start, end),
        )
    }

    pub fn get_project_trend_timeline(
        &self,
        app: &AppHandle,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_project_trend_timeline",
            build_period_payload(None, start, end),
        )
    }

    pub fn get_live_tail(
        &self,
        app: &AppHandle,
        start: Option<String>,
        end: Option<String>,
        after_segment_id: Option<String>,
        after_ended_at: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_live_tail",
            build_live_tail_payload(start, end, after_segment_id, after_ended_at, limit),
        )
    }

    pub fn get_hourly_summary(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_hourly_summary",
            build_period_payload(day, start, end),
        )
    }

    pub fn get_raw_events(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        app_name: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_raw_events",
            build_raw_events_payload(day, start, end, app_name, limit),
        )
    }

    pub fn get_top_sites(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_top_sites",
            build_top_sites_payload(day, start, end, limit),
        )
    }

    pub fn get_unclassified_segments(
        &self,
        app: &AppHandle,
        day: Option<String>,
        start: Option<String>,
        end: Option<String>,
        limit: Option<u32>,
        segment_ids: Option<Vec<String>>,
    ) -> Result<Value, TrackerError> {
        self.invoke::<Value>(
            app,
            "get_unclassified_segments",
            build_unclassified_segments_payload(day, start, end, limit, segment_ids),
        )
    }

    pub fn get_daily_stats(&self, app: &AppHandle) -> (f64, f64, f64) {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let timeline = match self.get_timeline(app, Some(today), None, None) {
            Ok(v) => v,
            Err(_) => return (0.0, 0.0, 0.0),
        };
        daily_stats_from_timeline(&timeline)
    }
}

fn build_dashboard_week_timeline_payload(start: Option<String>, end: Option<String>) -> Value {
    build_period_payload(None, start, end)
}

fn build_timeline_page_payload(
    day: Option<String>,
    start: Option<String>,
    end: Option<String>,
    before_segment_id: Option<String>,
    before_ended_at: Option<String>,
    limit: Option<u32>,
) -> Value {
    let mut payload = build_period_payload(day, start, end);

    if let Some(payload_object) = payload.as_object_mut() {
        if let Some(before_segment_id) = before_segment_id {
            payload_object.insert("beforeSegmentId".into(), json!(before_segment_id));
        }
        if let Some(before_ended_at) = before_ended_at {
            payload_object.insert("beforeEndedAt".into(), json!(before_ended_at));
        }
        payload_object.insert("limit".into(), json!(limit.unwrap_or(200)));
    }

    payload
}

fn build_timeline_search_payload(
    query: String,
    day: Option<String>,
    start: Option<String>,
    end: Option<String>,
    before_segment_id: Option<String>,
    before_ended_at: Option<String>,
    limit: Option<u32>,
) -> Value {
    let mut payload =
        build_timeline_page_payload(day, start, end, before_segment_id, before_ended_at, limit);

    if let Some(payload_object) = payload.as_object_mut() {
        payload_object.insert("query".into(), json!(query));
    }

    payload
}

fn build_raw_events_payload(
    day: Option<String>,
    start: Option<String>,
    end: Option<String>,
    app_name: Option<String>,
    limit: Option<u32>,
) -> Value {
    let mut payload = build_period_payload(day, start, end);
    if let Some(payload_object) = payload.as_object_mut() {
        payload_object.insert("appName".into(), json!(app_name));
        payload_object.insert("limit".into(), json!(limit.unwrap_or(50)));
    }
    payload
}

fn build_top_sites_payload(
    day: Option<String>,
    start: Option<String>,
    end: Option<String>,
    limit: Option<u32>,
) -> Value {
    let mut payload = build_period_payload(day, start, end);
    if let Some(payload_object) = payload.as_object_mut() {
        payload_object.insert("limit".into(), json!(limit.unwrap_or(10)));
    }
    payload
}

fn build_unclassified_segments_payload(
    day: Option<String>,
    start: Option<String>,
    end: Option<String>,
    limit: Option<u32>,
    segment_ids: Option<Vec<String>>,
) -> Value {
    let mut payload = build_period_payload(day, start, end);
    if let Some(payload_object) = payload.as_object_mut() {
        payload_object.insert("limit".into(), json!(limit.unwrap_or(50)));
        if let Some(segment_ids) = segment_ids {
            payload_object.insert("segmentIds".into(), json!(segment_ids));
        }
    }
    payload
}

fn build_live_tail_payload(
    start: Option<String>,
    end: Option<String>,
    after_segment_id: Option<String>,
    after_ended_at: Option<String>,
    limit: Option<u32>,
) -> Value {
    let mut payload = build_period_payload(None, start, end);

    if let Some(payload_object) = payload.as_object_mut() {
        if let Some(after_segment_id) = after_segment_id {
            payload_object.insert("afterSegmentId".into(), json!(after_segment_id));
        }
        if let Some(after_ended_at) = after_ended_at {
            payload_object.insert("afterEndedAt".into(), json!(after_ended_at));
        }
        payload_object.insert("limit".into(), json!(limit.unwrap_or(8)));
    }

    payload
}

fn daily_stats_from_timeline(timeline: &Value) -> (f64, f64, f64) {
    let segments = match timeline.as_array() {
        Some(v) => v,
        None => return (0.0, 0.0, 0.0),
    };

    let mut focus_secs = 0.0f64;
    let mut drift_secs = 0.0f64;
    let mut neutral_secs = 0.0f64;

    for seg in segments {
        let duration = seg
            .get("durationSeconds")
            .or_else(|| seg.get("duration_seconds"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let productivity = seg
            .get("productivity")
            .or_else(|| {
                seg.get("classification")
                    .and_then(|c| c.get("productivity"))
            })
            .and_then(|v| v.as_str())
            .unwrap_or("neutral");
        match productivity {
            "focus" => focus_secs += duration,
            "drift" => drift_secs += duration,
            _ => neutral_secs += duration,
        }
    }

    let total = focus_secs + drift_secs + neutral_secs;
    if total < 1.0 {
        return (0.0, 0.0, 0.0);
    }
    (focus_secs / total, drift_secs / total, neutral_secs / total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn period_payload_preserves_day_and_explicit_range_selectors() {
        let payload = build_period_payload(
            Some("2026-04-06".into()),
            Some("2026-04-06T00:00:00".into()),
            Some("2026-04-06T23:59:59".into()),
        );

        assert_eq!(
            payload,
            json!({
                "day": "2026-04-06",
                "start": "2026-04-06T00:00:00",
                "end": "2026-04-06T23:59:59",
            })
        );
    }

    #[test]
    fn live_tail_payload_preserves_range_cursor_and_default_limit() {
        let payload = build_live_tail_payload(
            Some("2026-04-06T00:00:00".into()),
            Some("2026-04-06T23:59:59".into()),
            Some("42".into()),
            Some("2026-04-06T09:05:00+00:00".into()),
            None,
        );

        assert_eq!(
            payload,
            json!({
                "start": "2026-04-06T00:00:00",
                "end": "2026-04-06T23:59:59",
                "afterSegmentId": "42",
                "afterEndedAt": "2026-04-06T09:05:00+00:00",
                "limit": 8
            })
        );
    }

    #[test]
    fn timeline_page_payload_preserves_range_cursor_and_default_limit() {
        let payload = build_timeline_page_payload(
            None,
            Some("2026-04-06T00:00:00".into()),
            Some("2026-04-06T23:59:59".into()),
            Some("42".into()),
            Some("2026-04-06T09:05:00+00:00".into()),
            None,
        );

        assert_eq!(
            payload,
            json!({
                "start": "2026-04-06T00:00:00",
                "end": "2026-04-06T23:59:59",
                "beforeSegmentId": "42",
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "limit": 200
            })
        );
    }

    #[test]
    fn timeline_page_payload_preserves_day_selector() {
        let payload =
            build_timeline_page_payload(Some("2026-04-06".into()), None, None, None, None, None);

        assert_eq!(payload, json!({ "day": "2026-04-06", "limit": 200 }));
    }

    #[test]
    fn raw_events_payload_preserves_default_app_filter_and_limit() {
        let payload = build_raw_events_payload(Some("2026-04-06".into()), None, None, None, None);

        assert_eq!(
            payload,
            json!({ "day": "2026-04-06", "appName": null, "limit": 50 })
        );
    }

    #[test]
    fn top_sites_payload_preserves_default_limit() {
        let payload = build_top_sites_payload(Some("2026-04-06".into()), None, None, None);

        assert_eq!(payload, json!({ "day": "2026-04-06", "limit": 10 }));
    }

    #[test]
    fn unclassified_segments_payload_preserves_segment_ids() {
        let payload = build_unclassified_segments_payload(
            Some("2026-04-06".into()),
            None,
            None,
            Some(20),
            Some(vec!["42".into(), "43".into()]),
        );

        assert_eq!(
            payload,
            json!({ "day": "2026-04-06", "limit": 20, "segmentIds": ["42", "43"] })
        );
    }

    #[test]
    fn unclassified_segments_payload_preserves_default_limit() {
        let payload =
            build_unclassified_segments_payload(Some("2026-04-06".into()), None, None, None, None);

        assert_eq!(payload, json!({ "day": "2026-04-06", "limit": 50 }));
    }

    #[test]
    fn timeline_search_payload_preserves_query_range_cursor_and_default_limit() {
        let payload = build_timeline_search_payload(
            "github issue".into(),
            None,
            Some("2026-04-06T00:00:00".into()),
            Some("2026-04-06T23:59:59".into()),
            Some("42".into()),
            Some("2026-04-06T09:05:00+00:00".into()),
            None,
        );

        assert_eq!(
            payload,
            json!({
                "query": "github issue",
                "start": "2026-04-06T00:00:00",
                "end": "2026-04-06T23:59:59",
                "beforeSegmentId": "42",
                "beforeEndedAt": "2026-04-06T09:05:00+00:00",
                "limit": 200
            })
        );
    }

    #[test]
    fn timeline_search_payload_preserves_day_selector() {
        let payload = build_timeline_search_payload(
            "github issue".into(),
            Some("2026-04-06".into()),
            None,
            None,
            None,
            None,
            None,
        );

        assert_eq!(
            payload,
            json!({ "query": "github issue", "day": "2026-04-06", "limit": 200 })
        );
    }

    #[test]
    fn dashboard_week_timeline_payload_preserves_range() {
        let payload = build_dashboard_week_timeline_payload(
            Some("2026-04-01T00:00:00".into()),
            Some("2026-04-07T23:59:59".into()),
        );

        assert_eq!(
            payload,
            json!({
                "start": "2026-04-01T00:00:00",
                "end": "2026-04-07T23:59:59",
            })
        );
    }

    #[test]
    fn daily_stats_aggregate_duration_aliases_and_nested_classifications() {
        let stats = daily_stats_from_timeline(&json!([
            { "durationSeconds": 15.0, "productivity": "focus" },
            { "duration_seconds": 20.0, "classification": { "productivity": "drift" } },
            { "durationSeconds": 30.0 },
        ]));

        assert_eq!(stats, (15.0 / 65.0, 20.0 / 65.0, 30.0 / 65.0));
    }
}
