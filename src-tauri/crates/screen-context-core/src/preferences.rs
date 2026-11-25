//! Account-local capture choices. No provider consent is inherited from these.
use crate::{CapturePolicy, CaptureScope, Error, Retention};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, time::Duration};

/// How long saved screen images stay (owner decision 2026-11-26). A preference
/// saved before the choice existed reads as a day.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageRetention {
    #[default]
    Day,
    Week,
    Month,
    Unlimited,
}
impl ImageRetention {
    fn is_day(&self) -> bool {
        *self == Self::Day
    }
    pub fn ttl(self) -> Duration {
        match self {
            Self::Day => crate::DEFAULT_RETENTION,
            Self::Week => Duration::from_secs(7 * 24 * 60 * 60),
            Self::Month => Duration::from_secs(30 * 24 * 60 * 60),
            Self::Unlimited => crate::MAX_RETENTION,
        }
    }
}
/// The storage limits offered, in GB (GiB on disk). One is the original limit.
pub const STORAGE_LIMITS_GB: [u32; 5] = [1, 5, 10, 20, 50];
fn default_storage_gb() -> u32 {
    1
}
fn is_default_storage_gb(value: &u32) -> bool {
    *value == 1
}

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
    #[serde(default, skip_serializing_if = "ImageRetention::is_day")]
    pub retention: ImageRetention,
    #[serde(default = "default_storage_gb", skip_serializing_if = "is_default_storage_gb")]
    pub max_storage_gb: u32,
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
            retention: ImageRetention::Day,
            max_storage_gb: 1,
        }
    }
}
impl CapturePreferences {
    /// The saved period and storage limit as the store applies them.
    pub fn retention_policy(&self) -> Retention {
        Retention {
            ttl: self.retention.ttl(),
            max_bytes: u64::from(self.max_storage_gb) * 1024 * 1024 * 1024,
        }
    }
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
            || !STORAGE_LIMITS_GB.contains(&self.max_storage_gb)
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
    fn image_retention_reads_as_a_day_and_one_gigabyte_and_stays_out_of_old_saves() {
        let saved = serde_json::to_string(&CapturePreferences::default()).unwrap();
        assert!(!saved.contains("retention") && !saved.contains("maxStorageGb"));
        let longer: CapturePreferences = serde_json::from_str(
            r#"{"enabled":false,"replayEnabled":false,"visibleTextEnabled":false,"ocrEnabled":false,"allowedApps":[],"intervalSeconds":10,"retention":"unlimited","maxStorageGb":20}"#,
        )
        .unwrap();
        assert_eq!(longer.retention_policy().max_bytes, 20 << 30);
        assert_eq!(longer.retention_policy().ttl, crate::MAX_RETENTION);
        assert!(longer.validate().is_ok() && longer.retention_policy().validate().is_ok());
        assert!(CapturePreferences { max_storage_gb: 3, ..CapturePreferences::default() }.validate().is_err());
        assert_eq!(CapturePreferences::default().retention_policy().ttl, crate::DEFAULT_RETENTION);
    }
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
