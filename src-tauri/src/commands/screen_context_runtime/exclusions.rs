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
        keep_apps: bool,
    ) -> Result<RuntimeStatus, String> {
        let _io = self
            .exclusion_io
            .lock()
            .map_err(|_| UNAVAILABLE.to_owned())?;
        if let Some(service) = self.service.get() {
            service.set_global_exclusions(None).map_err(error_code)?;
        }
        let enabled = preferences.enabled;
        let status = self.configure(app, lease, preferences, resume, keep_apps)?;
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
        let general = self
            .state
            .lock()
            .map(|state| {
                state.preferences.scope
                    == drifty_screen_context_core::CaptureScope::ActiveDisplayScene
            })
            .unwrap_or(true);
        let result = crate::tracker::TrackerController
            .get_excluded_apps(app, false)
            .map_err(|_| UNAVAILABLE.to_owned())
            .and_then(|rules| {
                if general {
                    map_scene_rules(&rules)
                } else {
                    map_rules(&rules)
                }
            });
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

/// General scenes carry every included app name/bundle and canonical site host.
/// Consume only trusted tracker rows; the renderer never supplies this inventory.
fn map_scene_rules(rules: &Value) -> Result<BTreeSet<String>, String> {
    let rows = rules
        .as_array()
        .filter(|rows| rows.len() <= 1024)
        .ok_or_else(|| UNAVAILABLE.to_owned())?;
    let mut excluded = BTreeSet::new();
    for row in rows {
        let id = row
            .get("id")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty() && v.len() <= 1024)
            .ok_or_else(|| UNAVAILABLE.to_owned())?;
        if row.get("tombstone").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        if let Some(host) = id.strip_prefix("site:") {
            // Tracker canonicalizes Unicode/URL/www/port rules before persistence.
            // Unknown or corrupt data closes the gate rather than dropping a rule.
            if !drifty_screen_context_core::valid_site_domain(host) {
                return Err(UNAVAILABLE.into());
            }
            excluded.insert(format!("site:{host}"));
            continue;
        }
        if row
            .get("kind")
            .and_then(Value::as_str)
            .is_some_and(|v| v != "app")
        {
            return Err(UNAVAILABLE.into());
        }
        let name = row
            .get("name")
            .and_then(Value::as_str)
            .filter(|v| !v.trim().is_empty() && v.len() <= 256 && !v.chars().any(char::is_control))
            .ok_or_else(|| UNAVAILABLE.to_owned())?;
        excluded.insert(format!("name:{}", name.trim().to_lowercase()));
        match row.get("bundleId") {
            None | Some(Value::Null) => {}
            Some(Value::String(bundle)) if bundle.is_empty() => {}
            Some(Value::String(bundle))
                if bundle.len() <= 256
                    && !bundle.chars().any(char::is_control)
                    && !["name:", "site:", "scene:"]
                        .iter()
                        .any(|prefix| bundle.to_lowercase().starts_with(prefix)) =>
            {
                excluded.insert(bundle.to_lowercase());
            }
            _ => return Err(UNAVAILABLE.into()),
        }
    }
    Ok(excluded)
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
            // Site rules cannot be mapped to app identities. A browser is
            // admitted only through the memory site gate, whose tracker row
            // read already refuses rows the tracker marked excluded.
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
    fn general_rules_keep_unlisted_apps_name_only_rules_and_canonical_sites() {
        let rules = json!([
            {"id":"one", "name":"Bank", "bundleId":"com.owned.Bank"},
            {"id":"two", "name":"Custom Localized App"},
            {"id":"site:xn--bcher-kva.example", "kind":"site"},
            {"id":"site:deleted.example", "tombstone":true}
        ]);
        assert_eq!(
            map_scene_rules(&rules).unwrap(),
            BTreeSet::from([
                "name:bank".into(),
                "com.owned.bank".into(),
                "name:custom localized app".into(),
                "site:xn--bcher-kva.example".into()
            ])
        );
        for bad in [
            json!([{"id":"site:https://bank.example/path"}]),
            json!([{"id":"site:bank.example.evil/"}]),
            json!([{"id":"site:bank.example", "tombstone":false}, {"id":"bad", "name":"x", "bundleId":42}]),
            json!([{"id":"unknown", "kind":"site", "name":"bank.example"}]),
            json!([{"id":"bad", "name":"x", "bundleId":"scene:unknown-sites"}]),
        ] {
            assert!(map_scene_rules(&bad).is_err());
        }
    }
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
