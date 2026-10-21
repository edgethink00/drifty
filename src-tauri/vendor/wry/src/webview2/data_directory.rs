// Copyright 2026 EdgeThink
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

/// Reject only a confirmed non-directory at the effective user-data root.
/// Leave missing/unreadable paths and creation permissions to WebView2. Never
/// create, remove, rename or replace the path, or choose a different profile.
pub(super) fn check_existing_path(path: &std::path::Path) -> std::io::Result<()> {
    if std::fs::metadata(path).is_ok_and(|metadata| !metadata.is_dir()) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "WebView2 user data directory is an existing non-directory",
        ));
    }
    Ok(())
}
