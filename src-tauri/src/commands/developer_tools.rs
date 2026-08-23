use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[cfg(unix)]
use std::os::unix::fs::symlink;

const CLI_INSTALL_RELATIVE_PATH: &str = ".local/bin/drifty";
const CODEX_SKILL_INSTALL_RELATIVE_PATH: &str = ".codex/skills/drifty";
const CLAUDE_CODE_SKILL_INSTALL_RELATIVE_PATH: &str = ".claude/skills/drifty";
const CURSOR_SKILL_INSTALL_RELATIVE_PATH: &str = ".cursor/skills/drifty";
const OPEN_CODE_SKILL_INSTALL_RELATIVE_PATH: &str = ".config/opencode/skills/drifty";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeveloperSkillTarget {
    Codex,
    ClaudeCode,
    Cursor,
    OpenCode,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeveloperArtifactState {
    NotInstalled,
    Installed,
    NeedsRepair,
    UnavailableInBuild,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperArtifactStatus {
    pub state: DeveloperArtifactState,
    pub installed_path: String,
    pub can_install: bool,
    pub can_repair: bool,
    pub can_uninstall: bool,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperToolsStatus {
    pub cli: DeveloperArtifactStatus,
    pub codex_skill: DeveloperArtifactStatus,
    pub claude_code_skill: DeveloperArtifactStatus,
    pub cursor_skill: DeveloperArtifactStatus,
    pub open_code_skill: DeveloperArtifactStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ArtifactKind {
    Cli,
    Skill(DeveloperSkillTarget),
}

#[tauri::command]
pub fn developer_tools_get_status(app: AppHandle) -> Result<DeveloperToolsStatus, String> {
    status_for_app(&app)
}

#[tauri::command]
pub fn developer_tools_install_cli(app: AppHandle) -> Result<DeveloperArtifactStatus, String> {
    let paths = artifact_paths(&app, ArtifactKind::Cli)?;
    install_owned_link(ArtifactKind::Cli, &paths.source, &paths.destination)?;
    Ok(artifact_status(
        ArtifactKind::Cli,
        &paths.source,
        &paths.destination,
    ))
}

#[tauri::command]
pub fn developer_tools_uninstall_cli(app: AppHandle) -> Result<DeveloperArtifactStatus, String> {
    let paths = artifact_paths(&app, ArtifactKind::Cli)?;
    uninstall_owned_link(ArtifactKind::Cli, &paths.source, &paths.destination)?;
    Ok(artifact_status(
        ArtifactKind::Cli,
        &paths.source,
        &paths.destination,
    ))
}

#[tauri::command]
pub fn developer_tools_install_codex_skill(
    app: AppHandle,
) -> Result<DeveloperArtifactStatus, String> {
    developer_tools_install_skill(app, DeveloperSkillTarget::Codex)
}

#[tauri::command]
pub fn developer_tools_install_skill(
    app: AppHandle,
    target: DeveloperSkillTarget,
) -> Result<DeveloperArtifactStatus, String> {
    let kind = ArtifactKind::Skill(target);
    let paths = artifact_paths(&app, kind)?;
    install_owned_link(kind, &paths.source, &paths.destination)?;
    Ok(artifact_status(kind, &paths.source, &paths.destination))
}

#[tauri::command]
pub fn developer_tools_uninstall_codex_skill(
    app: AppHandle,
) -> Result<DeveloperArtifactStatus, String> {
    developer_tools_uninstall_skill(app, DeveloperSkillTarget::Codex)
}

#[tauri::command]
pub fn developer_tools_uninstall_skill(
    app: AppHandle,
    target: DeveloperSkillTarget,
) -> Result<DeveloperArtifactStatus, String> {
    let kind = ArtifactKind::Skill(target);
    let paths = artifact_paths(&app, kind)?;
    uninstall_owned_link(kind, &paths.source, &paths.destination)?;
    Ok(artifact_status(kind, &paths.source, &paths.destination))
}

struct ArtifactPaths {
    source: PathBuf,
    destination: PathBuf,
}

fn status_for_app(app: &AppHandle) -> Result<DeveloperToolsStatus, String> {
    let cli = artifact_paths(app, ArtifactKind::Cli)?;
    let codex_skill = artifact_paths(app, ArtifactKind::Skill(DeveloperSkillTarget::Codex))?;
    let claude_code_skill =
        artifact_paths(app, ArtifactKind::Skill(DeveloperSkillTarget::ClaudeCode))?;
    let cursor_skill = artifact_paths(app, ArtifactKind::Skill(DeveloperSkillTarget::Cursor))?;
    let open_code_skill = artifact_paths(app, ArtifactKind::Skill(DeveloperSkillTarget::OpenCode))?;
    Ok(DeveloperToolsStatus {
        cli: artifact_status(ArtifactKind::Cli, &cli.source, &cli.destination),
        codex_skill: artifact_status(
            ArtifactKind::Skill(DeveloperSkillTarget::Codex),
            &codex_skill.source,
            &codex_skill.destination,
        ),
        claude_code_skill: artifact_status(
            ArtifactKind::Skill(DeveloperSkillTarget::ClaudeCode),
            &claude_code_skill.source,
            &claude_code_skill.destination,
        ),
        cursor_skill: artifact_status(
            ArtifactKind::Skill(DeveloperSkillTarget::Cursor),
            &cursor_skill.source,
            &cursor_skill.destination,
        ),
        open_code_skill: artifact_status(
            ArtifactKind::Skill(DeveloperSkillTarget::OpenCode),
            &open_code_skill.source,
            &open_code_skill.destination,
        ),
    })
}

fn artifact_paths(app: &AppHandle, kind: ArtifactKind) -> Result<ArtifactPaths, String> {
    let home = std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "Unable to resolve the current user's home directory.".to_owned())?;
    let source = match kind {
        ArtifactKind::Cli => resolve_cli_source(app),
        ArtifactKind::Skill(_) => resolve_skill_source(app),
    }
    .unwrap_or_else(|| PathBuf::from("/__drifty_unavailable_artifact__"));
    let destination = home.join(match kind {
        ArtifactKind::Cli => CLI_INSTALL_RELATIVE_PATH,
        ArtifactKind::Skill(DeveloperSkillTarget::Codex) => CODEX_SKILL_INSTALL_RELATIVE_PATH,
        ArtifactKind::Skill(DeveloperSkillTarget::ClaudeCode) => {
            CLAUDE_CODE_SKILL_INSTALL_RELATIVE_PATH
        }
        ArtifactKind::Skill(DeveloperSkillTarget::Cursor) => CURSOR_SKILL_INSTALL_RELATIVE_PATH,
        ArtifactKind::Skill(DeveloperSkillTarget::OpenCode) => {
            OPEN_CODE_SKILL_INSTALL_RELATIVE_PATH
        }
    });
    Ok(ArtifactPaths {
        source,
        destination,
    })
}

fn resolve_cli_source(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        if resource_dir.ends_with(Path::new("Contents").join("Resources")) {
            if let Some(contents) = resource_dir.parent() {
                candidates.push(contents.join("MacOS").join("drifty-tracker"));
            }
        }
        candidates.push(resource_dir.join("drifty-tracker"));
        candidates.push(resource_dir.join("binaries").join("drifty-tracker"));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join("drifty-tracker"));
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn resolve_skill_source(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir
            .join("integrations")
            .join("skills")
            .join("drifty");
        if valid_skill_source(&bundled) {
            return Some(bundled);
        }
    }
    let cwd = std::env::current_dir().ok()?;
    cwd.ancestors()
        .take(6)
        .map(|root| root.join("integrations").join("skills").join("drifty"))
        .find(|candidate| valid_skill_source(candidate))
}

fn valid_skill_source(path: &Path) -> bool {
    path.join("SKILL.md").is_file() && path.join("agents").join("openai.yaml").is_file()
}

fn artifact_status(
    kind: ArtifactKind,
    source: &Path,
    destination: &Path,
) -> DeveloperArtifactStatus {
    let installed_path = display_install_path(kind).to_owned();
    let source_available = source_available(kind, source);
    let metadata = match fs::symlink_metadata(destination) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return DeveloperArtifactStatus {
                state: if source_available {
                    DeveloperArtifactState::NotInstalled
                } else {
                    DeveloperArtifactState::UnavailableInBuild
                },
                installed_path,
                can_install: source_available,
                can_repair: false,
                can_uninstall: false,
                message: (!source_available).then(|| unavailable_message(kind).to_owned()),
            };
        }
        Err(_) => {
            return DeveloperArtifactStatus {
                state: DeveloperArtifactState::NeedsRepair,
                installed_path,
                can_install: false,
                can_repair: false,
                can_uninstall: false,
                message: Some("Drifty could not inspect the installation path.".to_owned()),
            };
        }
    };

    if !metadata.file_type().is_symlink() {
        return DeveloperArtifactStatus {
            state: DeveloperArtifactState::NeedsRepair,
            installed_path,
            can_install: false,
            can_repair: false,
            can_uninstall: false,
            message: Some(
                "A regular file or directory already uses this path. Drifty will not replace it."
                    .to_owned(),
            ),
        };
    }

    let Ok(raw_target) = fs::read_link(destination) else {
        return DeveloperArtifactStatus {
            state: DeveloperArtifactState::NeedsRepair,
            installed_path,
            can_install: false,
            can_repair: false,
            can_uninstall: false,
            message: Some("Drifty could not read the existing symbolic link.".to_owned()),
        };
    };
    let target = absolute_link_target(destination, &raw_target);
    if target == source && source_available {
        return DeveloperArtifactStatus {
            state: DeveloperArtifactState::Installed,
            installed_path,
            can_install: false,
            can_repair: false,
            can_uninstall: true,
            message: None,
        };
    }
    let owned = target == source;
    DeveloperArtifactStatus {
        state: DeveloperArtifactState::NeedsRepair,
        installed_path,
        can_install: false,
        can_repair: owned && source_available,
        can_uninstall: owned,
        message: Some(if owned {
            if source_available {
                "The installed link points to an older or missing Drifty app. Repair it to use this app.".to_owned()
            } else {
                unavailable_message(kind).to_owned()
            }
        } else {
            "This path points somewhere Drifty does not own. Drifty will not replace or remove it."
                .to_owned()
        }),
    }
}

#[cfg(unix)]
fn install_owned_link(kind: ArtifactKind, source: &Path, destination: &Path) -> Result<(), String> {
    if !source_available(kind, source) {
        return Err(unavailable_message(kind).to_owned());
    }
    if let Ok(metadata) = fs::symlink_metadata(destination) {
        if !metadata.file_type().is_symlink() {
            return Err("A regular file or directory already uses the installation path. Drifty left it unchanged.".to_owned());
        }
        let raw_target = fs::read_link(destination)
            .map_err(|_| "Drifty could not read the existing symbolic link.".to_owned())?;
        let target = absolute_link_target(destination, &raw_target);
        if target == source && source_available(kind, &target) {
            return Ok(());
        }
        if target != source {
            return Err(
                "The existing symbolic link belongs to another target. Drifty left it unchanged."
                    .to_owned(),
            );
        }
        fs::remove_file(destination)
            .map_err(|error| format!("Unable to remove the old Drifty link: {error}"))?;
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "The installation path has no parent directory.".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create the installation directory: {error}"))?;
    symlink(source, destination)
        .map_err(|error| format!("Unable to create the Drifty symbolic link: {error}"))
}

#[cfg(not(unix))]
fn install_owned_link(
    _kind: ArtifactKind,
    _source: &Path,
    _destination: &Path,
) -> Result<(), String> {
    Err("Developer tool installation is unavailable on this platform.".to_owned())
}

fn uninstall_owned_link(
    _kind: ArtifactKind,
    source: &Path,
    destination: &Path,
) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(destination) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Unable to inspect the installation path: {error}")),
    };
    if !metadata.file_type().is_symlink() {
        return Err(
            "The installation path is not a symbolic link. Drifty left it unchanged.".to_owned(),
        );
    }
    let raw_target = fs::read_link(destination)
        .map_err(|_| "Drifty could not read the existing symbolic link.".to_owned())?;
    let target = absolute_link_target(destination, &raw_target);
    if target != source {
        return Err(
            "The symbolic link belongs to another target. Drifty left it unchanged.".to_owned(),
        );
    }
    fs::remove_file(destination)
        .map_err(|error| format!("Unable to remove the Drifty symbolic link: {error}"))
}

fn absolute_link_target(destination: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        target.to_path_buf()
    } else {
        destination
            .parent()
            .unwrap_or_else(|| Path::new("/"))
            .join(target)
    }
}

fn source_available(kind: ArtifactKind, source: &Path) -> bool {
    match kind {
        ArtifactKind::Cli => source.is_file(),
        ArtifactKind::Skill(_) => valid_skill_source(source),
    }
}

fn display_install_path(kind: ArtifactKind) -> &'static str {
    match kind {
        ArtifactKind::Cli => "~/.local/bin/drifty",
        ArtifactKind::Skill(DeveloperSkillTarget::Codex) => "~/.codex/skills/drifty",
        ArtifactKind::Skill(DeveloperSkillTarget::ClaudeCode) => "~/.claude/skills/drifty",
        ArtifactKind::Skill(DeveloperSkillTarget::Cursor) => "~/.cursor/skills/drifty",
        ArtifactKind::Skill(DeveloperSkillTarget::OpenCode) => "~/.config/opencode/skills/drifty",
    }
}

fn unavailable_message(kind: ArtifactKind) -> &'static str {
    match kind {
        ArtifactKind::Cli => "The CLI executable is unavailable in this build.",
        ArtifactKind::Skill(DeveloperSkillTarget::Codex) => {
            "The bundled Codex skill is unavailable in this build."
        }
        ArtifactKind::Skill(DeveloperSkillTarget::ClaudeCode) => {
            "The bundled Claude Code skill is unavailable in this build."
        }
        ArtifactKind::Skill(DeveloperSkillTarget::Cursor) => {
            "The bundled Cursor skill is unavailable in this build."
        }
        ArtifactKind::Skill(DeveloperSkillTarget::OpenCode) => {
            "The bundled OpenCode skill is unavailable in this build."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn cli_source(root: &Path) -> PathBuf {
        let source = root
            .join("Drifty.app")
            .join("Contents")
            .join("MacOS")
            .join("drifty-tracker");
        fs::create_dir_all(source.parent().expect("source parent")).expect("create source parent");
        fs::write(&source, "binary").expect("write source");
        source
    }

    fn skill_source(root: &Path) -> PathBuf {
        let source = root
            .join("Drifty.app")
            .join("Contents")
            .join("Resources")
            .join("integrations")
            .join("skills")
            .join("drifty");
        fs::create_dir_all(source.join("agents")).expect("create source");
        fs::write(source.join("SKILL.md"), "---\nname: drifty\n---\n").expect("write skill");
        fs::write(source.join("agents").join("openai.yaml"), "interface: {}\n")
            .expect("write metadata");
        source
    }

    #[cfg(unix)]
    #[test]
    fn install_and_uninstall_owned_cli_link() {
        let root = TempDir::new().expect("temp dir");
        let source = cli_source(root.path());
        let destination = root.path().join("home/.local/bin/drifty");

        install_owned_link(ArtifactKind::Cli, &source, &destination).expect("install");
        assert_eq!(fs::read_link(&destination).expect("link target"), source);
        assert_eq!(
            artifact_status(ArtifactKind::Cli, &source, &destination).state,
            DeveloperArtifactState::Installed
        );

        uninstall_owned_link(ArtifactKind::Cli, &source, &destination).expect("uninstall");
        assert!(!destination.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_different_drifty_bundle_link_is_not_treated_as_owned() {
        let root = TempDir::new().expect("temp dir");
        let source = cli_source(root.path());
        let old = root
            .path()
            .join("old-install/Drifty.app/Contents/MacOS/drifty-tracker");
        fs::create_dir_all(old.parent().expect("old parent")).expect("old parent");
        fs::write(&old, "old").expect("old source");
        let destination = root.path().join("home/.local/bin/drifty");
        fs::create_dir_all(destination.parent().expect("destination parent"))
            .expect("destination parent");
        symlink(&old, &destination).expect("old link");

        let before = artifact_status(ArtifactKind::Cli, &source, &destination);
        assert_eq!(before.state, DeveloperArtifactState::NeedsRepair);
        assert!(!before.can_repair);
        assert!(!before.can_uninstall);
        assert!(install_owned_link(ArtifactKind::Cli, &source, &destination).is_err());
        assert!(uninstall_owned_link(ArtifactKind::Cli, &source, &destination).is_err());
        assert_eq!(fs::read_link(destination).expect("unchanged target"), old);
    }

    #[cfg(unix)]
    #[test]
    fn foreign_file_and_symlink_are_never_changed() {
        let root = TempDir::new().expect("temp dir");
        let source = cli_source(root.path());
        let regular = root.path().join("regular/drifty");
        fs::create_dir_all(regular.parent().expect("regular parent")).expect("regular parent");
        fs::write(&regular, "mine").expect("foreign file");

        assert!(install_owned_link(ArtifactKind::Cli, &source, &regular).is_err());
        assert!(uninstall_owned_link(ArtifactKind::Cli, &source, &regular).is_err());
        assert_eq!(fs::read_to_string(&regular).expect("unchanged"), "mine");

        let foreign_target = root.path().join("foreign/tool");
        fs::create_dir_all(foreign_target.parent().expect("foreign parent"))
            .expect("foreign parent");
        fs::write(&foreign_target, "tool").expect("foreign target");
        let foreign_link = root.path().join("foreign-link/drifty");
        fs::create_dir_all(foreign_link.parent().expect("link parent")).expect("link parent");
        symlink(&foreign_target, &foreign_link).expect("foreign link");

        assert!(install_owned_link(ArtifactKind::Cli, &source, &foreign_link).is_err());
        assert!(uninstall_owned_link(ArtifactKind::Cli, &source, &foreign_link).is_err());
        assert_eq!(
            fs::read_link(&foreign_link).expect("unchanged target"),
            foreign_target
        );
    }

    #[cfg(unix)]
    #[test]
    fn app_shaped_foreign_links_are_never_treated_as_owned() {
        let root = TempDir::new().expect("temp dir");
        let source = cli_source(root.path());
        let foreign_target = root.path().join("Other.app/Contents/MacOS/drifty-tracker");
        fs::create_dir_all(foreign_target.parent().expect("foreign parent"))
            .expect("foreign parent");
        fs::write(&foreign_target, "other app").expect("foreign target");
        let destination = root.path().join("home/.local/bin/drifty");
        fs::create_dir_all(destination.parent().expect("destination parent"))
            .expect("destination parent");
        symlink(&foreign_target, &destination).expect("foreign link");

        assert!(install_owned_link(ArtifactKind::Cli, &source, &destination).is_err());
        assert!(uninstall_owned_link(ArtifactKind::Cli, &source, &destination).is_err());
        assert_eq!(
            fs::read_link(&destination).expect("unchanged target"),
            foreign_target
        );

        let skill = skill_source(root.path());
        let foreign_skill_target = root
            .path()
            .join("Other.app/Contents/Resources/integrations/skills/drifty");
        fs::create_dir_all(foreign_skill_target.join("agents")).expect("foreign skill parent");
        fs::write(foreign_skill_target.join("SKILL.md"), "other skill").expect("foreign skill");
        fs::write(
            foreign_skill_target.join("agents/openai.yaml"),
            "interface: {}\n",
        )
        .expect("foreign skill metadata");
        let skill_destination = root.path().join("home/.codex/skills/drifty");
        fs::create_dir_all(
            skill_destination
                .parent()
                .expect("skill destination parent"),
        )
        .expect("skill destination parent");
        symlink(&foreign_skill_target, &skill_destination).expect("foreign skill link");

        assert!(install_owned_link(
            ArtifactKind::Skill(DeveloperSkillTarget::Codex),
            &skill,
            &skill_destination
        )
        .is_err());
        assert!(uninstall_owned_link(
            ArtifactKind::Skill(DeveloperSkillTarget::Codex),
            &skill,
            &skill_destination
        )
        .is_err());
        assert_eq!(
            fs::read_link(&skill_destination).expect("unchanged skill target"),
            foreign_skill_target
        );
    }

    #[cfg(unix)]
    #[test]
    fn codex_skill_uses_the_same_ownership_rules() {
        let root = TempDir::new().expect("temp dir");
        let source = skill_source(root.path());
        let destination = root.path().join("home/.codex/skills/drifty");

        install_owned_link(
            ArtifactKind::Skill(DeveloperSkillTarget::Codex),
            &source,
            &destination,
        )
        .expect("install");
        assert_eq!(
            artifact_status(
                ArtifactKind::Skill(DeveloperSkillTarget::Codex),
                &source,
                &destination
            )
            .state,
            DeveloperArtifactState::Installed
        );
        uninstall_owned_link(
            ArtifactKind::Skill(DeveloperSkillTarget::Codex),
            &source,
            &destination,
        )
        .expect("uninstall");
        assert!(!destination.exists());
    }

    #[cfg(unix)]
    #[test]
    fn all_skill_targets_install_to_their_documented_paths() {
        let root = TempDir::new().expect("temp dir");
        let source = skill_source(root.path());
        let cases = [
            (DeveloperSkillTarget::Codex, ".codex/skills/drifty"),
            (DeveloperSkillTarget::ClaudeCode, ".claude/skills/drifty"),
            (DeveloperSkillTarget::Cursor, ".cursor/skills/drifty"),
            (
                DeveloperSkillTarget::OpenCode,
                ".config/opencode/skills/drifty",
            ),
        ];

        for (target, relative_destination) in cases {
            let kind = ArtifactKind::Skill(target);
            let destination = root.path().join("home").join(relative_destination);
            install_owned_link(kind, &source, &destination).expect("install target skill");
            assert_eq!(
                artifact_status(kind, &source, &destination).state,
                DeveloperArtifactState::Installed
            );
            assert_eq!(fs::read_link(&destination).expect("link target"), source);
        }
    }

    #[test]
    fn missing_source_reports_unavailable_without_creating_destination() {
        let root = TempDir::new().expect("temp dir");
        let source = root.path().join("missing/drifty-tracker");
        let destination = root.path().join("home/.local/bin/drifty");

        let status = artifact_status(ArtifactKind::Cli, &source, &destination);

        assert_eq!(status.state, DeveloperArtifactState::UnavailableInBuild);
        assert!(!status.can_install);
        assert!(!destination.exists());
    }
}
