//! A compile-time-only transport for private signed Windows updater cycles.
//! Normal builds retain the immutable official HTTPS asset restriction.

pub(super) const PUBLIC_RELEASES: &str = "https://github.com/edgethink00/drifty/releases/download";
pub(super) const LEGACY_RELEASES: &str =
    "https://github.com/edgethink00/drifty_releases/releases/download";

#[cfg(any(test, all(target_os = "windows", feature = "windows-updater-qa")))]
const QA_BASE: &str = "http://127.0.0.1:19457/windows-updater-qa";

#[cfg(any(test, all(target_os = "windows", feature = "windows-updater-qa")))]
fn private_qa_base(identifier: &str, version: &str) -> Result<&'static str, String> {
    if identifier != "so.drifty.windows.updaterqa" || !matches!(version, "1.11.2401" | "1.11.2402")
    {
        return Err("Private updater QA requires its isolated identifier and QA version".into());
    }
    Ok(QA_BASE)
}

pub(super) fn release_bases(app: &tauri::AppHandle) -> Result<&'static [&'static str], String> {
    #[cfg(all(target_os = "windows", feature = "windows-updater-qa"))]
    {
        private_qa_base(
            &app.config().identifier,
            &app.package_info().version.to_string(),
        )?;
        Ok(&[QA_BASE])
    }
    #[cfg(not(all(target_os = "windows", feature = "windows-updater-qa")))]
    {
        let _ = app;
        Ok(&[PUBLIC_RELEASES, LEGACY_RELEASES])
    }
}

#[cfg(any(test, target_os = "windows"))]
fn is_installer_url(bases: &[&str], url: &str, version: &str) -> bool {
    super::update_policy::valid_policy_tag(version)
        && !version.ends_with("-win")
        && bases
            .iter()
            .any(|base| url == format!("{base}/{version}-win/drifty_{version}_x64-setup.exe"))
}

#[cfg(target_os = "windows")]
pub(super) fn is_stable_installer_url(
    app: &tauri::AppHandle,
    url: &str,
    version: &str,
) -> Result<bool, String> {
    Ok(is_installer_url(release_bases(app)?, url, version))
}

#[cfg(target_os = "windows")]
pub(crate) fn installer_launch_path(
    app: &tauri::AppHandle,
    verified_installer: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    #[cfg(feature = "windows-updater-qa")]
    {
        private_qa_base(
            &app.config().identifier,
            &app.package_info().version.to_string(),
        )?;
        if std::env::var("DRIFTY_WINDOWS_UPDATER_QA_FAIL_SPAWN").as_deref() == Ok("1") {
            // A real OS FileNotFound after the ordinary tracker shutdown. This
            // hook does not exist in a normal build and cannot select a path.
            let missing = verified_installer.with_extension("qa-missing");
            if missing.exists() {
                return Err("QA missing-file fixture already exists".into());
            }
            return Ok(missing);
        }
    }
    let _ = app;
    Ok(verified_installer.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_feed_refuses_production_identity_or_version() {
        for (id, version) in [
            ("so.drifty.windows", "1.11.2401"),
            ("so.drifty.mac", "1.11.2402"),
            ("so.drifty.windows.updaterqa", "1.11.24"),
            ("so.drifty.windows.updaterqa", "1.11.2403"),
        ] {
            assert!(private_qa_base(id, version).is_err());
        }
        for version in ["1.11.2401", "1.11.2402"] {
            assert_eq!(
                private_qa_base("so.drifty.windows.updaterqa", version).unwrap(),
                QA_BASE
            );
        }
    }

    #[test]
    fn installers_must_match_the_exact_asset_in_an_allowed_repository() {
        let bases = [PUBLIC_RELEASES, LEGACY_RELEASES];
        for base in bases {
            let asset = format!("{base}/1.23.0-win/drifty_1.23.0_x64-setup.exe");
            assert!(is_installer_url(&bases, &asset, "1.23.0"));
            assert!(!is_installer_url(&bases, &asset, "1.23.1"));
            assert!(!is_installer_url(
                &bases,
                &format!("{asset}?other=1"),
                "1.23.0"
            ));
            assert!(!is_installer_url(&[QA_BASE], &asset, "1.23.0"));
        }
        assert!(!is_installer_url(
            &bases,
            "https://github.com/other/drifty/releases/download/1.23.0-win/drifty_1.23.0_x64-setup.exe",
            "1.23.0",
        ));
    }

    #[test]
    fn production_and_qa_origins_are_distinct_and_fixed() {
        assert!(PUBLIC_RELEASES.starts_with("https://github.com/"));
        assert!(LEGACY_RELEASES.starts_with("https://github.com/"));
        let qa = url::Url::parse(QA_BASE).unwrap();
        assert_eq!(qa.host_str(), Some("127.0.0.1"));
        assert_eq!(qa.port(), Some(19457));
        assert_eq!(qa.path(), "/windows-updater-qa");
        assert_eq!(qa.username(), "");
        assert!(qa.password().is_none());
    }
}
