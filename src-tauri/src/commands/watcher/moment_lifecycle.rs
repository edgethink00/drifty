use chrono::DateTime;
use serde_json::Value;

pub(super) const STALE_AFTER_MS: i64 = 10 * 60 * 1000;

#[derive(Default)]
pub(super) struct MomentLifecycle {
    pub active_key: Option<String>,
    action_active: bool,
    generation: u64,
    prepared: Option<(u64, Option<i64>)>,
    cancelled: Vec<String>,
    received: Vec<String>,
}

impl MomentLifecycle {
    pub const fn new() -> Self {
        Self {
            active_key: None,
            action_active: false,
            generation: 0,
            prepared: None,
            cancelled: Vec::new(),
            received: Vec::new(),
        }
    }

    pub fn matches(&self, key: Option<&str>) -> bool {
        key.is_none() || self.active_key.as_deref() == key
    }

    pub fn allows_action(&self, key: Option<&str>) -> bool {
        key.is_some()
            && self.action_active
            && self.matches(key)
            && !key.is_some_and(|key| self.cancelled.iter().any(|item| item == key))
    }

    pub fn receive(&mut self, key: &str) {
        self.cancelled.retain(|item| item != key);
        if !self.received.iter().any(|item| item == key) {
            self.received.push(key.to_owned());
        }
        // Bounded in-flight bookkeeping; this is not an activity history.
        if self.received.len() > 256 {
            self.received.drain(..self.received.len() - 256);
        }
    }

    pub fn cancel(&mut self, key: Option<&str>) -> bool {
        // Remember cancellation even if the renderer's prepare IPC has not
        // reached native yet. A later explicit delivery of the same ID re-arms it.
        let keys = key.map(|key| vec![key.to_owned()]).unwrap_or_else(|| {
            let mut keys = self.received.clone();
            if let Some(active) = &self.active_key {
                if !keys.contains(active) {
                    keys.push(active.clone());
                }
            }
            keys
        });
        for key in keys {
            if !self.cancelled.contains(&key) {
                self.cancelled.push(key.clone());
            }
            self.received.retain(|item| item != &key);
        }
        if self.cancelled.len() > 256 {
            self.cancelled.drain(..self.cancelled.len() - 256);
        }
        if !self.matches(key) {
            return false;
        }
        self.generation = self.generation.wrapping_add(1);
        self.prepared = None;
        self.action_active = false;
        true
    }

    pub fn set_state(
        &mut self,
        resting: bool,
        key: Option<&str>,
        expires: Option<i64>,
        now: i64,
    ) -> Option<u64> {
        // An unscoped bootstrap collapse must not cancel an already accepted card.
        if resting && self.active_key.as_deref() != key {
            return None;
        }
        if !resting
            && (key.is_none()
                || key.is_some_and(|key| self.cancelled.iter().any(|item| item == key))
                || expires.is_some_and(|deadline| now >= deadline))
        {
            return None;
        }
        self.generation = self.generation.wrapping_add(1);
        self.prepared = None;
        if resting {
            self.cancel(key);
        }
        if !resting {
            self.action_active = true;
            self.active_key = key.map(str::to_owned);
            self.prepared = Some((self.generation, expires));
        }
        Some(self.generation)
    }

    pub fn present(&mut self, token: Option<u64>, now: i64) -> bool {
        let Some((generation, expires)) = self.prepared else {
            return false;
        };
        if token != Some(generation) {
            return false;
        }
        self.prepared = None;
        !expires.is_some_and(|deadline| now >= deadline)
    }

    pub fn receive_legacy(&mut self, key: Option<String>) {
        self.cancel(None);
        self.active_key = key;
        self.action_active = self.active_key.is_some();
        if let Some(key) = self.active_key.clone() {
            self.receive(&key);
        }
    }
}

pub(super) fn payload_key(payload: &Value) -> Option<String> {
    let kind = payload.get("kind").and_then(Value::as_str);
    let (prefix, value) = match kind {
        Some("companionDriftAlarm") => ("driftAlarm", payload.get("alarm")?.get("id")?),
        Some("endOfDayReview") => ("endOfDayReview", payload.get("generatedAt")?),
        Some(kind) => (kind, payload.get("id")?),
        None => ("watcherPeek", payload.get("id")?),
    };
    let value = value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_u64().map(|id| id.to_string()))?;
    Some(format!("{prefix}:{value}"))
}

pub(super) fn payload_expired(payload: &Value, now: i64) -> bool {
    if payload.get("kind").is_none() {
        return false;
    }
    let event = if payload.get("kind").and_then(Value::as_str) == Some("companionDriftAlarm") {
        payload.get("alarm").unwrap_or(payload)
    } else {
        payload
    };
    if event
        .get("expiresAt")
        .and_then(Value::as_str)
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .is_some_and(|time| now >= time.timestamp_millis())
    {
        return true;
    }
    event
        .get("generatedAt")
        .and_then(Value::as_str)
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .is_some_and(|time| now.saturating_sub(time.timestamp_millis()) > STALE_AFTER_MS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn an_old_clear_cannot_cancel_new_preparation() {
        let mut life = MomentLifecycle::new();
        life.set_state(false, Some("driftAlarm:a"), None, 0);
        let b = life.set_state(false, Some("driftAlarm:b"), None, 0);
        assert!(!life.cancel(Some("driftAlarm:a")));
        assert!(!life.cancel(Some("watcherPeek:1")));
        assert!(life.present(b, 1));
        assert!(!life.present(b, 1));
    }
    #[test]
    fn replaced_and_cancelled_preparation_never_presents() {
        let mut life = MomentLifecycle::new();
        let a = life.set_state(false, Some("a"), None, 0);
        let b = life.set_state(false, Some("b"), None, 0);
        assert!(!life.present(a, 0));
        assert!(life.cancel(Some("b")));
        assert!(!life.present(b, 0));
        let c = life.set_state(false, Some("c"), None, 0);
        assert!(life.set_state(true, Some("c"), None, 0).is_some());
        assert!(!life.present(c, 0));
    }
    #[test]
    fn stale_collapses_and_bootstrap_cannot_touch_a_new_card() {
        let mut life = MomentLifecycle::new();
        let b = life.set_state(false, Some("b"), None, 0);
        assert!(life.set_state(true, Some("a"), None, 0).is_none());
        assert!(life.set_state(true, None, None, 0).is_none());
        assert!(life.present(b, 0));
    }
    #[test]
    fn expiry_is_checked_before_geometry_and_again_before_show() {
        let mut life = MomentLifecycle::new();
        assert!(life
            .set_state(false, Some("expired"), Some(9), 10)
            .is_none());
        let token = life.set_state(false, Some("fresh"), Some(10), 9);
        assert!(!life.present(token, 11));
        assert!(!life.present(token, 9));
        assert!(life
            .set_state(false, Some("edge"), Some(10), 10)
            .is_none());
    }
    #[test]
    fn cancellation_before_prepare_does_not_resurrect_a_card() {
        let mut life = MomentLifecycle::new();
        life.receive("queued");
        assert!(!life.cancel(Some("queued")));
        assert!(life.set_state(false, Some("queued"), None, 0).is_none());
        life.receive("queued");
        assert!(life.set_state(false, Some("queued"), None, 0).is_some());
        life.receive("another");
        life.cancel(None);
        assert!(life.set_state(false, Some("another"), None, 0).is_none());
    }
    #[test]
    fn event_actions_require_an_active_uncancelled_identity() {
        let mut life = MomentLifecycle::new();
        life.set_state(false, Some("a"), None, 0);
        assert!(!life.allows_action(None));
        assert!(!life.allows_action(Some("old")));
        assert!(life.allows_action(Some("a")));
        life.cancel(Some("a"));
        assert!(!life.allows_action(Some("a")));
        life.receive("b");
        life.set_state(false, Some("b"), None, 0);
        life.set_state(true, Some("b"), None, 0);
        assert!(!life.allows_action(Some("b")));
        for id in 0..300 {
            life.cancel(Some(&format!("other-{id}")));
        }
        assert!(!life.allows_action(Some("b")));
    }
    #[test]
    fn received_and_cancelled_bookkeeping_is_bounded() {
        let mut life = MomentLifecycle::new();
        for id in 0..1000 {
            life.receive(&id.to_string());
        }
        assert_eq!(life.received.len(), 256);
        life.cancel(None);
        assert!(life.received.is_empty());
        assert_eq!(life.cancelled.len(), 256);
    }
    #[test]
    fn stale_payloads_and_native_identities_match_the_renderer_contract() {
        let now = DateTime::parse_from_rfc3339("2026-09-08T12:00:00Z")
            .unwrap()
            .timestamp_millis();
        let alarm = json!({"kind":"companionDriftAlarm", "alarm":{"id":"a", "generatedAt":"2026-09-08T11:49:59Z"}});
        assert!(payload_expired(&alarm, now));
        assert_eq!(payload_key(&alarm).as_deref(), Some("driftAlarm:a"));
        assert_eq!(
            payload_key(&json!({"id":1})).as_deref(),
            Some("watcherPeek:1")
        );
        assert!(!payload_expired(
            &json!({"kind":"milestone", "id":"m"}),
            now
        ));
        assert!(!payload_expired(
            &json!({"kind":"milestone", "generatedAt":"2026-09-08T11:50:00Z"}),
            now
        ));
        assert!(payload_expired(
            &json!({
                "kind":"endOfDayReview",
                "generatedAt":"2026-09-08T11:59:00Z",
                "expiresAt":"2026-09-08T12:00:00Z"
            }),
            now
        ));
    }
}
