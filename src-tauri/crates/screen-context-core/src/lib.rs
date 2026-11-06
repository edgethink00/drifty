//! Local evidence only. This crate has no network transport and never creates
//! activity durations. OS adapters own the truth of admission facts; WebView
//! requests must not be allowed to supply those facts.
mod activity_binding;
mod activity_prepare;
mod activity_read;
pub mod ai_consent;
pub mod ai_input;
pub use activity_prepare::{ActivityPreparation, NativeActivityPreparer};
pub use activity_read::{
    ActivityReadReply, ActivityVisibilityGuard, BoundActivityEvidence, ReviewEvidence,
};
pub mod activity_reader;
mod crypto;
pub use activity_binding::{ActivityBinding, LocalActivityRecordRef, MAX_ACTIVITY_REFS};
pub mod key_store;
pub mod lease;
mod model;
mod scene;
pub mod scene_ai;
pub use scene::{
    valid_site_domain, CaptureScope, DisplaySceneIdentity, EvidenceSurface, SceneCaptureFacts,
    SceneExclusionInventory, SceneForeground, SceneRegion, SceneTextScope, SceneWindowPrivacy,
};
mod preferences;
pub use preferences::CapturePreferences;
pub mod native;
pub mod process;
mod scheduler;
pub mod store;

pub use model::*;
pub use scheduler::*;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid screen evidence: {0}")]
    Invalid(&'static str),
    #[error("screen evidence authentication failed")]
    Authentication,
    #[error("screen evidence cryptography unavailable")]
    Cryptography,
    #[error("screen evidence storage unavailable")]
    Storage,
    #[error("screen evidence storage full")]
    StorageFull,
    #[error("screen evidence result invalidated")]
    Invalidated,
    #[error("screen evidence clock moved backwards")]
    ClockRollback,
    #[error("screen evidence worker unavailable")]
    WorkerUnavailable,
}

impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        if matches!(&error, rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::DiskFull)
        {
            Self::StorageFull
        } else {
            Self::Storage
        }
    }
}
impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::StorageFull {
            Self::StorageFull
        } else {
            Self::Storage
        }
    }
}

#[cfg(test)]
mod tests;
