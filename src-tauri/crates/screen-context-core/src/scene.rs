//! Scene provenance is not a capture/privacy proof or an AI consent grant.
//! Native capture must establish admission before constructing this receipt.
//! A scene never fabricates a document identity for the legacy capture protocol.
use crate::{Error, Privacy, SurfaceIdentity, TextEvidence, TextSource, TextState};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use zeroize::Zeroize;

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureScope {
    #[default]
    SelectedApps,
    ActiveDisplayScene,
}
impl CaptureScope {
    pub fn is_selected_apps(&self) -> bool {
        *self == Self::SelectedApps
    }
}

/// Native observations only, never renderer-supplied admission flags.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneWindowPrivacy {
    pub pid: u32,
    pub process_birth: u64,
    pub window_id: u64,
    pub app_id: String,
    #[serde(default)]
    pub app_name: Option<String>,
    #[serde(default)]
    pub site_domain: Option<String>,
    pub privacy: Privacy,
    pub protected: bool,
    pub site_policy_known: bool,
    pub excluded_site: bool,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneCaptureFacts {
    pub identity: DisplaySceneIdentity,
    pub permission: bool,
    pub interactive: bool,
    pub inventory_complete: bool,
    pub windows: Vec<SceneWindowPrivacy>,
}
impl SceneCaptureFacts {
    pub(crate) fn admissible(&self, excluded: &BTreeSet<String>) -> bool {
        if self.windows.is_empty()
            || self.windows.len() > 64
            || self.identity.visible_apps.len() > 32
            || self.identity.foreground.pid == 0
            || self.identity.foreground.process_birth == 0
            || self
                .identity
                .visible_apps
                .iter()
                .any(|app| app.is_empty() || app.len() > 256)
        {
            return false;
        }
        let apps = self
            .windows
            .iter()
            .map(|w| w.app_id.clone())
            .collect::<BTreeSet<_>>();
        self.permission
            && self.interactive
            && self.inventory_complete
            && !self.windows.is_empty()
            && self.windows.len() <= 64
            && self.identity.observation_epoch > 0
            && self.identity.display_id > 0
            && self
                .windows
                .iter()
                .map(|w| w.window_id)
                .collect::<BTreeSet<_>>()
                .len()
                == self.windows.len()
            && apps == self.identity.visible_apps
            && self.identity.exclusion_inventory_matches(&self.windows)
            && !self.identity.is_excluded(excluded)
            && self.windows.iter().any(|w| {
                w.window_id == self.identity.foreground.window_id
                    && w.pid == self.identity.foreground.pid
                    && w.process_birth == self.identity.foreground.process_birth
                    && w.app_id == self.identity.foreground.app_id
            })
            && self.windows.iter().all(|w| {
                w.window_id > 0
                    && w.pid > 0
                    && w.process_birth > 0
                    && !w.protected
                    && !w.excluded_site
                    && match w.privacy {
                        Privacy::NotBrowser => true,
                        // Owner decision 2026-11-06: unknown private status
                        // does not suppress general recording. Site exclusions
                        // still require their independent native policy check.
                        // Browser: a verified browser whose private state the
                        // legacy helper cannot know; the same as Unknown here.
                        Privacy::Normal | Privacy::Unknown | Privacy::Browser => {
                            w.site_policy_known
                                || !excluded
                                    .iter()
                                    .any(|rule| rule.to_lowercase().starts_with("site:"))
                        }
                        Privacy::Private => false,
                    }
            })
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneForeground {
    pub pid: u32,
    pub process_birth: u64,
    pub window_id: u64,
    pub app_id: String,
}

/// Top-left-origin pixel coordinates in the retained image, not screen points
/// or a different crop. A native Vision adapter must flip normalized ROI y
/// (1 - (y + height) / image_height) from this convention.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}
impl SceneRegion {
    fn within(&self, width: u32, height: u32) -> bool {
        self.width > 0
            && self.height > 0
            && self
                .x
                .checked_add(self.width)
                .is_some_and(|edge| edge <= width)
            && self
                .y
                .checked_add(self.height)
                .is_some_and(|edge| edge <= height)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SceneTextScope {
    None,
    ForegroundWindowRegion,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplaySceneIdentity {
    pub display_id: u32,
    /// Native observer epoch; not evidence of continuous observation by itself.
    pub observation_epoch: u64,
    pub foreground: SceneForeground,
    /// All apps with pixels in the scene, including background overlays.
    /// Native capture must refuse if this bounded inventory is incomplete.
    pub visible_apps: BTreeSet<String>,
    /// Encrypted local provenance only. Missing legacy inventory is hidden
    /// whenever a later name/site rule cannot be evaluated safely.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclusion_inventory: Option<SceneExclusionInventory>,
    pub foreground_region: Option<SceneRegion>,
    pub text_scope: SceneTextScope,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneExclusionInventory {
    pub app_names: BTreeSet<String>,
    pub site_domains: BTreeSet<String>,
    pub sites_complete: bool,
}
impl SceneExclusionInventory {
    fn valid(&self) -> bool {
        self.app_names.len() <= 32
            && self.site_domains.len() <= 64
            && self
                .app_names
                .iter()
                .all(|v| !v.trim().is_empty() && v.len() <= 256 && !v.chars().any(char::is_control))
            && self.site_domains.iter().all(|v| valid_site_domain(v))
    }
}
// Native adapters canonicalize IDN hosts to ASCII before this boundary. This
// validator never treats URLs, paths, ports or malformed domains as host facts.
pub fn valid_site_domain(value: &str) -> bool {
    value.len() <= 253
        && value.contains('.')
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        })
}
pub(crate) fn exclusion_keys_match(keys: &BTreeSet<String>, rules: &BTreeSet<String>) -> bool {
    rules.iter().any(|rule| {
        let rule = rule.to_lowercase();
        if let Some(domain) = rule.strip_prefix("site:") {
            keys.contains("scene:unknown-sites")
                || keys
                    .iter()
                    .filter_map(|v| v.strip_prefix("site:"))
                    .any(|host| host == domain || host.ends_with(&format!(".{domain}")))
        } else if rule.starts_with("name:") {
            keys.contains("scene:unknown-names") || keys.contains(&rule)
        } else {
            keys.iter().any(|key| key.to_lowercase() == rule)
        }
    })
}
impl DisplaySceneIdentity {
    fn exclusion_inventory_matches(&self, windows: &[SceneWindowPrivacy]) -> bool {
        let Some(inventory) = &self.exclusion_inventory else {
            return true;
        };
        inventory.valid()
            && windows
                .iter()
                .all(|w| w.app_name.as_ref().is_some_and(|n| !n.trim().is_empty()))
            && inventory.app_names
                == windows
                    .iter()
                    .filter_map(|w| w.app_name.as_ref().map(|n| n.trim().to_lowercase()))
                    .collect()
            && inventory.site_domains
                == windows
                    .iter()
                    .filter_map(|w| w.site_domain.clone())
                    .collect()
            && inventory.sites_complete
                == windows
                    .iter()
                    .all(|w| w.privacy == Privacy::NotBrowser || w.site_policy_known)
    }
    fn exclusion_keys(&self) -> BTreeSet<String> {
        let mut keys = self
            .visible_apps
            .iter()
            .map(|v| v.to_lowercase())
            .collect::<BTreeSet<_>>();
        if let Some(inventory) = &self.exclusion_inventory {
            keys.extend(
                inventory
                    .app_names
                    .iter()
                    .map(|v| format!("name:{}", v.trim().to_lowercase())),
            );
            keys.extend(inventory.site_domains.iter().map(|v| format!("site:{v}")));
            if !inventory.sites_complete {
                keys.insert("scene:unknown-sites".into());
            }
        } else {
            keys.insert("scene:unknown-sites".into());
            keys.insert("scene:unknown-names".into());
        }
        keys
    }
    fn is_excluded(&self, excluded: &BTreeSet<String>) -> bool {
        exclusion_keys_match(&self.exclusion_keys(), excluded)
    }

    pub(crate) fn validate(
        &self,
        width: u32,
        height: u32,
        text: &TextEvidence,
    ) -> Result<(), Error> {
        let f = &self.foreground;
        if self
            .exclusion_inventory
            .as_ref()
            .is_some_and(|i| !i.valid())
            || self.display_id == 0
            || self.observation_epoch == 0
            || f.pid == 0
            || f.process_birth == 0
            || f.window_id == 0
            || self.visible_apps.is_empty()
            || self.visible_apps.len() > 32
            || self
                .visible_apps
                .iter()
                .any(|app| app.is_empty() || app.len() > 256)
            || !self.visible_apps.contains(&f.app_id)
            || self
                .foreground_region
                .is_some_and(|region| !region.within(width, height))
        {
            return Err(Error::Invalid("scene provenance"));
        }
        match (self.text_scope, text.source(), text.state()) {
            (SceneTextScope::None, TextSource::None, TextState::NotRequested) => Ok(()),
            (SceneTextScope::ForegroundWindowRegion, TextSource::Ocr, _)
                if self.foreground_region.is_some() =>
            {
                Ok(())
            }
            _ => Err(Error::Invalid("scene text scope")),
        }
    }
}
impl Drop for DisplaySceneIdentity {
    fn drop(&mut self) {
        self.foreground.app_id.zeroize();
        if let Some(inventory) = &mut self.exclusion_inventory {
            for mut value in std::mem::take(&mut inventory.app_names) {
                value.zeroize();
            }
            for mut value in std::mem::take(&mut inventory.site_domains) {
                value.zeroize();
            }
        }
        for mut app in std::mem::take(&mut self.visible_apps) {
            app.zeroize();
        }
    }
}

#[derive(Clone)]
pub enum EvidenceSurface {
    Document(SurfaceIdentity),
    ActiveDisplayScene(DisplaySceneIdentity),
}
impl EvidenceSurface {
    pub fn is_scene(&self) -> bool {
        matches!(self, Self::ActiveDisplayScene(_))
    }
    pub fn is_excluded(&self, excluded: &BTreeSet<String>) -> bool {
        match self {
            Self::Document(surface) => excluded.contains(&surface.app_id),
            Self::ActiveDisplayScene(scene) => scene.is_excluded(excluded),
        }
    }
    pub(crate) fn exclusion_keys(&self) -> BTreeSet<String> {
        match self {
            Self::Document(surface) => BTreeSet::from([surface.app_id.clone()]),
            Self::ActiveDisplayScene(scene) => scene.exclusion_keys(),
        }
    }
    pub(crate) fn validate(
        &self,
        width: u32,
        height: u32,
        text: &TextEvidence,
    ) -> Result<(), Error> {
        match self {
            Self::ActiveDisplayScene(scene) => scene.validate(width, height, text),
            Self::Document(i)
                if i.pid > 0
                    && i.process_birth > 0
                    && i.window_id > 0
                    && !i.app_id.is_empty()
                    && i.app_id.len() <= 256
                    && !i.document_id.is_empty()
                    && i.document_id.len() <= 512
                    && i.document_generation > 0 =>
            {
                Ok(())
            }
            Self::Document(_) => Err(Error::Invalid("document provenance")),
        }
    }
}
impl Drop for EvidenceSurface {
    fn drop(&mut self) {
        if let Self::Document(surface) = self {
            surface.app_id.zeroize();
            surface.document_id.zeroize();
        }
    }
}
impl std::fmt::Debug for EvidenceSurface {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EvidenceSurface([redacted])")
    }
}

#[cfg(test)]
pub(crate) mod tests;
