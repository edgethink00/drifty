//! The existing tracker owns app exclusions. WebView capture preferences cannot
//! replace this policy, including rules received through account sync.
use super::*;
use serde_json::Value;
use std::collections::BTreeSet;
use tauri::Emitter;

impl ScreenContextRuntime {
    /// Keep capture closed while applying source choices and refreshing trusted
    /// rules. A delayed rules RPC cannot resume an earlier source policy. OFF
    /// remains available without that RPC; active revocations are saved first.
    pub(super) fn configure_with_exclusions(
        &self,
        app: &AppHandle,
        lease: &AccountReadLease,
        preferences: CapturePreferences,
        resume: bool,
    ) -> Result<RuntimeStatus, String> {
        let _io = self
            .exclusion_io
            .lock()
            .map_err(|_| UNAVAILABLE.to_owned())?;
        if let Some(service) = self.service.get() {
            service.set_global_exclusions(None).map_err(error_code)?;
        }
        let enabled = preferences.enabled;
        let status = self.configure(app, lease, preferences, resume)?;
        if enabled {
            self.refresh_exclusions_locked(app)?;
        }
        Ok(status)
    }
    pub(crate) fn refresh_exclusions(&self, app: &AppHandle) -> Result<(), String> {
        if self.service.get().is_none() {
            return Ok(());
        }
        let Ok(_guard) = self.exclusion_io.lock() else {
            if let Some(service) = self.service.get() {
                if service.set_global_exclusions(None).unwrap_or(true) {
                    let _ = app.emit_to("main", "screen-context-invalidated", ());
                }
            }
            return Err(UNAVAILABLE.into());
        };
        self.refresh_exclusions_locked(app)
    }

    fn refresh_exclusions_locked(&self, app: &AppHandle) -> Result<(), String> {
        let Some(service) = self.service.get() else {
            return Ok(());
        };
        let result = crate::tracker::TrackerController
            .get_excluded_apps(app, false)
            .map_err(|_| UNAVAILABLE.to_owned())
            .and_then(|rules| map_rules(&rules));
        match result {
            Ok(excluded) => {
                if service
                    .set_global_exclusions(Some(excluded))
                    .map_err(error_code)?
                {
                    let _ = app.emit_to("main", "screen-context-invalidated", ());
                    let _ = app.emit_to("main", "screen-context-policy-ready", ());
                }
                Ok(())
            }
            Err(error) => {
                if service.set_global_exclusions(None).unwrap_or(true) {
                    let _ = app.emit_to("main", "screen-context-invalidated", ());
                }
                Err(error)
            }
        }
    }

    /// Serializes every native save/delete path, including account-sync replay.
    /// Keep the existing tracker command's result; a refresh failure closes only
    /// screen evidence, without pretending an already committed rule failed.
    pub(crate) fn with_exclusion_mutation<T, E>(
        &self,
        app: &AppHandle,
        change: impl FnOnce() -> Result<T, E>,
    ) -> Result<T, E> {
        if self.service.get().is_none() {
            return change();
        }
        self.forget_visibility_now();
        self.invalidate_now();
        let _ = app.emit_to("main", "screen-context-invalidated", ());
        let guard = self.exclusion_io.lock();
        self.invalidate_now();
        if let Some(service) = self.service.get() {
            let _ = service.set_global_exclusions(None);
        }
        let result = change();
        if guard.is_ok() && self.refresh_exclusions_locked(app).is_ok() {
            let _ = app.emit_to("main", "screen-context-policy-ready", ());
        }
        result
    }
}

fn map_rules(rules: &Value) -> Result<BTreeSet<String>, String> {
    let mut apps = Vec::new();
    for app in supported_apps() {
        let preferences = CapturePreferences {
            allowed_apps: BTreeSet::from([app.id.to_owned()]),
            ..CapturePreferences::default()
        };
        apps.push((
            app.name.to_lowercase(),
            policy_for(&preferences)?.allowed_apps,
        ));
    }
    map_for_apps(rules, &apps)
}

fn map_for_apps(
    rules: &Value,
    apps: &[(String, BTreeSet<String>)],
) -> Result<BTreeSet<String>, String> {
    let rows = rules
        .as_array()
        .filter(|rows| rows.len() <= 1024)
        .ok_or_else(|| UNAVAILABLE.to_owned())?;
    let mut excluded = BTreeSet::new();
    for row in rows {
        let id = row
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 1024)
            .ok_or_else(|| UNAVAILABLE.to_owned())?;
        if id.starts_with("site:") || row.get("kind").and_then(Value::as_str) == Some("site") {
            // Pilot helpers refuse every browser before pixels. Site rules
            // cannot grant admission to these native document-only helpers.
            continue;
        }
        if row.get("tombstone").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let name = row
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty() && name.len() <= 1024)
            .ok_or_else(|| UNAVAILABLE.to_owned())?
            .to_lowercase();
        let bundle = match row.get("bundleId") {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) if value.len() <= 32768 => Some(value.to_lowercase()),
            _ => return Err(UNAVAILABLE.into()),
        };
        let mut matched = false;
        for (app_name, identities) in apps {
            if name == *app_name
                || bundle
                    .as_ref()
                    .is_some_and(|bundle| identities.iter().any(|id| id.to_lowercase() == *bundle))
            {
                excluded.extend(identities.iter().cloned());
                matched = true;
            }
        }
        // A name-only custom rule could use an OS-localized name unknown to
        // this restricted pilot. Refuse rather than silently ignoring it.
        if !matched && bundle.as_ref().is_none_or(|bundle| bundle.is_empty()) {
            return Err(UNAVAILABLE.into());
        }
    }
    Ok(excluded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn trusted_rules_map_bundle_or_name_to_every_native_identity() {
        let identities = BTreeSet::from([
            "Packaged.Notepad!App".into(),
            "c:\\windows\\system32\\notepad.exe".into(),
        ]);
        let apps = vec![("notepad".into(), identities.clone())];
        for rule in [
            json!({"id":"owned", "name":"localized name", "bundleId":"packaged.notepad!app"}),
            json!({"id":"owned", "name":"Notepad"}),
        ] {
            assert_eq!(map_for_apps(&json!([rule]), &apps).unwrap(), identities);
        }
        assert!(
            map_for_apps(&json!([{"id":"site:owned.example", "kind":"site"}]), &apps)
                .unwrap()
                .is_empty()
        );
        assert!(map_for_apps(
            &json!([{"id":"owned", "name":"Notepad", "tombstone":true}]),
            &apps
        )
        .unwrap()
        .is_empty());
    }
    #[test]
    fn unknown_localized_name_only_or_malformed_rules_cannot_open_the_gate() {
        let apps = vec![(
            "textedit".into(),
            BTreeSet::from(["com.apple.TextEdit".into()]),
        )];
        assert!(map_for_apps(
            &json!([{"id":"owned", "name":"unknown localized name"}]),
            &apps
        )
        .is_err());
        assert!(map_for_apps(
            &json!([{"id":"owned", "name":"TextEdit", "bundleId":42}]),
            &apps
        )
        .is_err());
        assert!(map_for_apps(&json!({"rules":[]}), &apps).is_err());
        assert!(map_for_apps(
            &json!([{"id":"other", "name":"unrelated", "bundleId":"org.owned.other"}]),
            &apps
        )
        .unwrap()
        .is_empty());
    }
}
