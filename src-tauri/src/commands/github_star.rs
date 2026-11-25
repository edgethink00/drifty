//! "Star Drifty on GitHub": whether the public repository is live, and starring
//! it through the person's own `gh` CLI when it is installed and signed in.
//!
//! Nothing here runs until the interface asks. The repository check is an
//! anonymous read of public metadata; the account name is read so the
//! onboarding choice can say which account would star; the star follows a
//! button press or the person's onboarding choice.

use std::ffi::OsStr;
use std::time::Duration;

use serde::Serialize;

pub const PUBLIC_REPOSITORY: &str = "edgethink00/drifty";
const API_TIMEOUT: Duration = Duration::from_secs(8);
#[cfg(unix)]
const GH_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepositoryStatus {
    /// False while the repository is private or missing (GitHub answers 404).
    pub public: bool,
    pub stars: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum GithubStarState {
    Starred,
    NotStarred,
    /// No usable `gh`: missing, signed out, failed, or skipped. Use the browser.
    Unavailable,
}

fn parse_repository_status(status: u16, body: &str) -> Result<GithubRepositoryStatus, String> {
    match status {
        200 => {
            let value: serde_json::Value = serde_json::from_str(body).map_err(|error| error.to_string())?;
            let private = value.get("private").and_then(serde_json::Value::as_bool).unwrap_or(true);
            Ok(GithubRepositoryStatus {
                public: !private,
                stars: value.get("stargazers_count").and_then(serde_json::Value::as_u64),
            })
        }
        404 => Ok(GithubRepositoryStatus { public: false, stars: None }),
        other => Err(format!("GitHub answered {other}.")),
    }
}

#[tauri::command]
pub async fn github_repository_status() -> Result<GithubRepositoryStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let client = reqwest::blocking::Client::builder()
            .timeout(API_TIMEOUT)
            .user_agent("Drifty")
            .build()
            .map_err(|error| error.to_string())?;
        let response = client
            .get(format!("https://api.github.com/repos/{PUBLIC_REPOSITORY}"))
            .header("Accept", "application/vnd.github+json")
            .send()
            .map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let body = response.text().map_err(|error| error.to_string())?;
        parse_repository_status(status, &body)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// A login shell can load a password manager's shell integration, which then
/// asks for approval on every `gh` call. Use the browser when 1Password is
/// installed rather than risk that prompt (Dayflow made the same call).
#[cfg(target_os = "macos")]
fn password_manager_wraps_shell() -> bool {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    ["/Applications/1Password.app", "/Applications/1Password 7.app"]
        .iter()
        .map(std::path::PathBuf::from)
        .chain(home.into_iter().map(|home| home.join("Applications/1Password.app")))
        .any(|path| path.exists())
}

#[cfg(unix)]
fn gh_api(args: &[&str]) -> Option<std::process::Output> {
    #[cfg(target_os = "macos")]
    if password_manager_wraps_shell() {
        return None;
    }
    let executable = super::chat_cli::resolve_cli("gh")?;
    let mut command = super::chat_cli::command_for_cli(&executable);
    command.arg("api").args(args.iter().map(OsStr::new)).stdin(std::process::Stdio::null());
    crate::bounded_process::output(&mut command, GH_TIMEOUT).ok()
}

fn classify_star_check(success: bool, stderr: &str) -> GithubStarState {
    if success {
        GithubStarState::Starred
    } else if stderr.contains("HTTP 404") {
        GithubStarState::NotStarred
    } else {
        GithubStarState::Unavailable
    }
}

#[tauri::command]
pub async fn github_star_status() -> Result<GithubStarState, String> {
    #[cfg(unix)]
    {
        return tauri::async_runtime::spawn_blocking(|| {
            let path = format!("user/starred/{PUBLIC_REPOSITORY}");
            Ok(match gh_api(&[path.as_str()]) {
                Some(output) => classify_star_check(output.status.success(), &String::from_utf8_lossy(&output.stderr)),
                None => GithubStarState::Unavailable,
            })
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    Ok(GithubStarState::Unavailable)
}

/// A GitHub login is 1 to 39 letters, digits or hyphens; anything else is not gh answering.
fn parse_login(stdout: &str) -> Option<String> {
    let login = stdout.trim();
    let valid = !login.is_empty()
        && login.len() <= 39
        && login.chars().all(|character| character.is_ascii_alphanumeric() || character == '-');
    valid.then(|| login.to_owned())
}

/// The account the gh CLI is signed in to, or None when there is no usable gh.
#[tauri::command]
pub async fn github_cli_login() -> Result<Option<String>, String> {
    #[cfg(unix)]
    {
        return tauri::async_runtime::spawn_blocking(|| {
            Ok(gh_api(&["user", "--jq", ".login"])
                .filter(|output| output.status.success())
                .and_then(|output| parse_login(&String::from_utf8_lossy(&output.stdout))))
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    Ok(None)
}

/// True when `gh` starred the repository. False means: open the browser instead.
#[tauri::command]
pub async fn github_star_repository() -> Result<bool, String> {
    #[cfg(unix)]
    {
        return tauri::async_runtime::spawn_blocking(|| {
            let path = format!("user/starred/{PUBLIC_REPOSITORY}");
            Ok(gh_api(&["-X", "PUT", path.as_str()]).is_some_and(|output| output.status.success()))
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_private_or_missing_repository_reads_as_not_public() {
        assert_eq!(parse_repository_status(404, "{}").unwrap(), GithubRepositoryStatus { public: false, stars: None });
        assert_eq!(
            parse_repository_status(200, r#"{"private":true,"stargazers_count":3}"#).unwrap(),
            GithubRepositoryStatus { public: false, stars: Some(3) },
        );
    }

    #[test]
    fn a_public_repository_reports_its_star_count() {
        assert_eq!(
            parse_repository_status(200, r#"{"private":false,"stargazers_count":1234}"#).unwrap(),
            GithubRepositoryStatus { public: true, stars: Some(1234) },
        );
        assert!(parse_repository_status(403, "rate limited").is_err());
    }

    #[test]
    fn only_a_github_login_reads_as_the_account() {
        assert_eq!(parse_login("octo-cat
"), Some("octo-cat".to_owned()));
        assert_eq!(parse_login(""), None);
        assert_eq!(parse_login("To get started with GitHub CLI, please run:  gh auth login"), None);
        assert_eq!(parse_login(&"a".repeat(40)), None);
    }

    #[test]
    fn only_a_404_means_not_starred() {
        assert_eq!(classify_star_check(true, ""), GithubStarState::Starred);
        assert_eq!(classify_star_check(false, "gh: Not Found (HTTP 404)"), GithubStarState::NotStarred);
        assert_eq!(classify_star_check(false, "To get started with GitHub CLI, please run:  gh auth login"), GithubStarState::Unavailable);
    }
}
