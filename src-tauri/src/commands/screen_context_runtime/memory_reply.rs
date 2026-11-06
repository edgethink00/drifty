//! Join engine results to live evidence and expose dates without model arithmetic.
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;
use uuid::Uuid;

pub(super) fn preferred_sources(op: &str, arguments: &Value) -> Option<Vec<Uuid>> {
    if op == "memory_source" {
        Some(vec![Uuid::parse_str(arguments["id"].as_str()?).ok()?])
    } else {
        Some(Vec::new())
    }
}

pub(super) fn result_sources(op: &str, result: &Value) -> Option<Vec<Uuid>> {
    let sources = if op == "memory_source" {
        if result.is_null() { return Some(Vec::new()); }
        vec![result]
    } else {
        let items = result.as_array()?;
        if items.len() > 4 { return None; }
        items.iter().map(|item| &item["source"]).collect()
    };
    sources.iter().map(|s| Uuid::parse_str(s["source_id"].as_str()?).ok()).collect()
}

fn source_reply(source: &Value, live: &[Value]) -> Option<Value> {
    let canonical = live.iter().find(|item| {
        item["source_id"].is_string()
            && item["source_id"] == source["source_id"]
            && item["text"] == source["text"]
    })?;
    let mut reply = canonical.clone();
    for (numeric, readable) in [
        ("observed_at_ms", "observed_at_utc"),
        ("expires_at_ms", "expires_at_utc"),
    ] {
        let millis = canonical[numeric].as_i64()?;
        if millis < 0 {
            return None;
        }
        let date = DateTime::<Utc>::from_timestamp_millis(millis)?;
        reply[readable] = Value::String(date.to_rfc3339_opts(SecondsFormat::Millis, true));
    }
    Some(reply)
}

pub(super) fn verified_reply(op: &str, result: &Value, live: &[Value]) -> Option<Value> {
    if op == "memory_source" {
        return Some(source_reply(result, live).unwrap_or(Value::Null));
    }
    Some(Value::Array(
        result
            .as_array()?
            .iter()
            .filter_map(|item| {
                let source = source_reply(&item["source"], live)?;
                let mut reply = item.clone();
                reply["source"] = source;
                Some(reply)
            })
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn source() -> Value {
        json!({"source_id":"cursor-source", "app":"com.todesktop.230313mzl4w4u92",
            "text":"Review Tuesday at 16:30. Eli owns the review.",
            "observed_at_ms":1793262107123_i64, "expires_at_ms":1793348507123_i64})
    }

    #[test]
    fn exact_source_preferences_are_bounded_native_ids_not_cached_payloads() {
        let id = Uuid::new_v4();
        assert_eq!(preferred_sources("memory_source", &json!({"id":id})), Some(vec![id]));
        assert!(preferred_sources("memory_source", &json!({"id":"/some/path"})).is_none());
        assert_eq!(preferred_sources("memory_search", &json!({"query":"work"})), Some(vec![]));
        assert_eq!(result_sources("memory_source", &Value::Null), Some(vec![]));
        let item = json!({"source":{"source_id":id, "text":"untrusted cache"}});
        assert_eq!(result_sources("memory_search", &json!([item.clone()])), Some(vec![id]));
        assert!(result_sources("memory_search", &json!(vec![item; 5])).is_none());
        assert!(result_sources("memory_source", &json!({"source_id":"bad"})).is_none());
    }

    #[test]
    fn recent_unextracted_observations_are_bounded_and_revalidated() {
        let id = Uuid::new_v4();
        let mut live = source();
        live["source_id"] = json!(id);
        let item = json!({"source":live, "memories":[], "extracted":false});
        assert_eq!(result_sources("memory_recent", &json!([item.clone()])), Some(vec![id]));
        assert!(result_sources("memory_recent", &json!(vec![item.clone(); 5])).is_none());
        let reply = verified_reply("memory_recent", &json!([item.clone()]), &[live]).unwrap();
        assert_eq!(reply[0]["source"]["observed_at_utc"], "2026-10-29T08:21:47.123Z");
        assert_eq!(reply[0]["extracted"], false);
        assert_eq!(verified_reply("memory_recent", &json!([item]), &[]), Some(json!([])));
    }

    #[test]
    fn both_tools_supply_exact_utc_dates_and_preserve_the_observed_deadline() {
        let live = vec![source()];
        let single = verified_reply("memory_source", &source(), &live).unwrap();
        assert_eq!(single["observed_at_utc"], "2026-10-29T08:21:47.123Z");
        assert_eq!(single["expires_at_utc"], "2026-10-30T08:21:47.123Z");
        assert_eq!(single["observed_at_ms"], source()["observed_at_ms"]);
        assert_eq!(single["text"], source()["text"]);
        let search = verified_reply(
            "memory_search",
            &json!([
                {"memory":"Eli owns the review", "score":0.8, "source":source()}
            ]),
            &live,
        )
        .unwrap();
        assert_eq!(search[0]["source"], single);
        assert_eq!(search[0]["memory"], "Eli owns the review");
    }

    #[test]
    fn dates_and_app_come_from_current_evidence_not_cached_engine_metadata() {
        let mut cached = source();
        cached["observed_at_ms"] = json!(0);
        cached["expires_at_ms"] = json!(i64::MAX);
        cached["observed_at_utc"] = json!("2026-10-28T00:00:00Z");
        cached["app"] = json!("wrong-app");
        let reply = verified_reply("memory_source", &cached, &[source()]).unwrap();
        assert_eq!(reply["observed_at_utc"], "2026-10-29T08:21:47.123Z");
        assert_eq!(reply["expires_at_ms"], source()["expires_at_ms"]);
        assert_eq!(reply["app"], source()["app"]);
    }

    #[test]
    fn deleted_changed_and_invalid_evidence_cannot_gain_a_readable_date() {
        assert_eq!(
            verified_reply("memory_source", &source(), &[]),
            Some(Value::Null)
        );
        let mut changed = source();
        changed["text"] = json!("changed text");
        let search = json!([{"source":source()}]);
        assert_eq!(
            verified_reply("memory_search", &search, &[changed]),
            Some(json!([]))
        );
        for invalid in [json!(-1), json!(i64::MAX), Value::Null] {
            let mut live = source();
            live["observed_at_ms"] = invalid;
            assert_eq!(
                verified_reply("memory_source", &source(), &[live]),
                Some(Value::Null)
            );
        }
    }
}
