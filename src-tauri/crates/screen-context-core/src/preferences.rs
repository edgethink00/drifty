//! Account-local capture choices. No provider consent is inherited from these.
use crate::{CapturePolicy, Error};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturePreferences {
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
    pub fn validate(&self) -> Result<(), Error> {
        if ![10, 30].contains(&self.interval_seconds)
            || self.allowed_apps.len() > 256
            || self
                .allowed_apps
                .iter()
                .any(|v| v.is_empty() || v.len() > 256)
            || self.enabled
                && (self.allowed_apps.is_empty()
                    || !(self.replay_enabled || self.visible_text_enabled || self.ocr_enabled))
        {
            return Err(Error::Invalid("capture preferences"));
        }
        Ok(())
    }
    pub fn policy(&self) -> Result<CapturePolicy, Error> {
        self.validate()?;
        Ok(CapturePolicy {
            enabled: self.enabled,
            replay_enabled: self.replay_enabled,
            visible_text_enabled: self.visible_text_enabled,
            ocr_enabled: self.ocr_enabled,
            allowed_apps: self.allowed_apps.clone(),
            ..CapturePolicy::default()
        })
    }
}
