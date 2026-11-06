//! Account-local capture choices. No provider consent is inherited from these.
use crate::{CapturePolicy, CaptureScope, Error};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturePreferences {
    #[serde(default, skip_serializing_if = "CaptureScope::is_selected_apps")]
    pub scope: CaptureScope,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub general_notice_pending: bool,
    pub enabled: bool,
    pub replay_enabled: bool,
    pub visible_text_enabled: bool,
    pub ocr_enabled: bool,
    pub allowed_apps: BTreeSet<String>,
    pub interval_seconds: u32,
}
impl Default for CapturePreferences {
    fn default() -> Self {
        Self {
            scope: CaptureScope::SelectedApps,
            general_notice_pending: false,
            enabled: false,
            replay_enabled: false,
            visible_text_enabled: false,
            ocr_enabled: false,
            allowed_apps: BTreeSet::new(),
            interval_seconds: 10,
        }
    }
}
impl CapturePreferences {
    /// Owner-approved upgrade (2026-11-06). The native caller must first
    /// qualify general capture support and observe the current OS permission.
    /// Deserialization alone never expands collection, and an explicit OFF
    /// choice stays OFF. Scope is described in Settings, without an upgrade popup.
    pub fn upgrade_general_recording(&mut self, native_ready_and_permitted: bool) -> bool {
        if !native_ready_and_permitted || !self.enabled || self.scope != CaptureScope::SelectedApps
        {
            return false;
        }
        self.scope = CaptureScope::ActiveDisplayScene;
        self.general_notice_pending = false;
        self.allowed_apps.clear();
        // General analysis uses OCR of the same captured image, never the
        // legacy accessibility-document source or an inherited AI grant.
        self.ocr_enabled |= self.visible_text_enabled;
        self.visible_text_enabled = false;
        true
    }

    pub fn validate(&self) -> Result<(), Error> {
        if ![10, 30].contains(&self.interval_seconds)
            || self.allowed_apps.len() > 256
            || self
                .allowed_apps
                .iter()
                .any(|v| v.is_empty() || v.len() > 256)
            || (self.scope == CaptureScope::ActiveDisplayScene
                && (!self.allowed_apps.is_empty() || self.visible_text_enabled))
            || self.enabled
                && ((self.scope == CaptureScope::SelectedApps && self.allowed_apps.is_empty())
                    || !(self.replay_enabled || self.visible_text_enabled || self.ocr_enabled))
        {
            return Err(Error::Invalid("capture preferences"));
        }
        Ok(())
    }
    pub fn policy(&self) -> Result<CapturePolicy, Error> {
        self.validate()?;
        Ok(CapturePolicy {
            scope: self.scope,
            enabled: self.enabled,
            replay_enabled: self.replay_enabled,
            visible_text_enabled: self.visible_text_enabled,
            ocr_enabled: self.ocr_enabled,
            allowed_apps: self.allowed_apps.clone(),
            ..CapturePolicy::default()
        })
    }
}

#[cfg(test)]
mod upgrade_tests {
    use super::*;
    #[test]
    fn general_upgrade_requires_native_readiness_and_on_choice_is_idempotent_and_preserves_controls(
    ) {
        let old = CapturePreferences {
            enabled: true,
            replay_enabled: true,
            visible_text_enabled: true,
            allowed_apps: BTreeSet::from(["textedit".into()]),
            interval_seconds: 30,
            ..Default::default()
        };
        let mut preferences = old.clone();
        assert!(!preferences.upgrade_general_recording(false));
        assert_eq!(preferences, old);
        preferences.enabled = false;
        let off = preferences.clone();
        assert!(!preferences.upgrade_general_recording(true));
        assert_eq!(preferences, off);
        preferences = old;
        assert!(preferences.upgrade_general_recording(true));
        assert_eq!(preferences.scope, CaptureScope::ActiveDisplayScene);
        assert!(preferences.allowed_apps.is_empty());
        assert!(!preferences.general_notice_pending);
        assert!(!preferences.visible_text_enabled);
        assert!(preferences.ocr_enabled && preferences.replay_enabled && preferences.enabled);
        assert_eq!(preferences.interval_seconds, 30);
        assert!(preferences.validate().is_ok());
        assert!(!preferences.upgrade_general_recording(true));
    }
}
