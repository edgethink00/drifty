//! Chat preview runner: drives an agent CLI the user installed (Codex CLI or
//! Claude Code) against Drifty's read-only MCP query server.
//!
//! Drifty never reads or stores the CLI's credentials; it only starts the CLI.
//! Each turn runs with the CLI's shell and built-in tools switched off, no saved
//! session and no user configuration, so the only data the agent can reach is
//! "drifty-tracker mcp" reading the local tracker database read-only.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

const MAX_PROMPT_CHARS: usize = 200_000;
const MAX_INSTRUCTIONS_CHARS: usize = 20_000;
const MAX_REQUEST_ID_CHARS: usize = 64;
const STDERR_TAIL_BYTES: usize = 4_000;
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(8);
const TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TOOL_ARGUMENTS_BYTES: usize = 4_096;
const DRIFTY_MCP_TOOLS: [&str; 3] = ["summary", "search", "timeline"];
/// Reasoning effort both CLIs accept (Codex model_reasoning_effort, Claude Code
/// --effort). Matches CHAT_CLI_EFFORTS in the desktop chatCliModels.ts.
const CHAT_CLI_EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
const MAX_MODEL_ID_CHARS: usize = 64;
/// Codex features that add tools or context beyond the drifty tools. Each turn
/// turns off the ones the installed Codex knows (an unknown name stops Codex),
/// so the list is filtered by `codex features list`. Code mode stays on: some
/// Codex builds serve MCP tools through it. Matches CODEX_DISABLED_FEATURES in
/// the desktop chatCliArgs.ts.
const CODEX_DISABLED_FEATURES: [&str; 22] = [
    "unified_exec",
    "js_repl",
    "view_image",
    "image_generation",
    "multi_agent",
    "multi_agent_v2",
    "apps",
    "plugins",
    "remote_plugin",
    "skill_search",
    "tool_suggest",
    "browser_use",
    "browser_use_external",
    "in_app_browser",
    "computer_use",
    "goals",
    "memories",
    "hooks",
    "sleep_tool",
    "workspace_dependencies",
    "worktrees",
    "realtime_conversation",
];

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatCliProvider {
    Codex,
    Claude,
}

impl ChatCliProvider {
    const ALL: [ChatCliProvider; 2] = [ChatCliProvider::Codex, ChatCliProvider::Claude];

    fn executable_name(self) -> &'static str {
        match self {
            ChatCliProvider::Codex => "codex",
            ChatCliProvider::Claude => "claude",
        }
    }
}

/// How much of each record the tool server may return. Titles matches what AI
/// classification sends with its Window title switch on: titles, no full URLs.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatToolDetail {
    Safe,
    Titles,
}

impl ChatToolDetail {
    fn as_arg(self) -> &'static str {
        match self {
            ChatToolDetail::Safe => "safe",
            ChatToolDetail::Titles => "titles",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ChatToolServer {
    pub program: PathBuf,
    pub leading_args: Vec<OsString>,
    pub database: PathBuf,
    pub detail: ChatToolDetail,
    pub memory: Option<Arc<super::chat_memory::MemoryBridge>>,
}

impl ChatToolServer {
    fn args(&self) -> Vec<String> {
        let mut args: Vec<String> = self
            .leading_args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        args.extend([
            "--db".to_string(),
            self.database.to_string_lossy().into_owned(),
            "mcp".to_string(),
            "--detail".to_string(),
            self.detail.as_arg().to_string(),
        ]);
        if let Some(memory) = &self.memory {
            args.extend([
                "--memory-socket".into(),
                memory.socket.to_string_lossy().into_owned(),
            ]);
        }
        args
    }
}

fn toml_string(value: &str) -> String {
    // JSON string escapes are valid TOML basic-string escapes.
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Feature names from `codex features list` ("name  stage  enabled" rows), skipping removed ones.
pub(crate) fn parse_codex_features(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 3 {
                return None;
            }
            let name = fields[0];
            let enabled = fields[fields.len() - 1];
            let stage = fields[1..fields.len() - 1].join(" ");
            let valid_name = name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.');
            (valid_name && (enabled == "true" || enabled == "false") && stage != "removed")
                .then(|| name.to_string())
        })
        .collect()
}

fn codex_disable_args(installed_features: &[String]) -> Vec<String> {
    CODEX_DISABLED_FEATURES
        .iter()
        .filter(|name| {
            installed_features
                .iter()
                .any(|installed| installed == *name)
        })
        .flat_map(|name| ["--disable".to_string(), (*name).to_string()])
        .collect()
}

/// Extra environment for one Chat turn. Claude Code's print mode starts
/// answering before MCP servers connect unless told to wait, and then guesses
/// without the drifty tools. Versions that do not know the variable ignore it.
/// Matches chatCliEnv in the desktop chatCliArgs.ts.
pub(crate) fn chat_cli_env(provider: ChatCliProvider) -> Vec<(&'static str, &'static str)> {
    match provider {
        ChatCliProvider::Claude => vec![("MCP_CONNECTION_NONBLOCKING", "0")],
        ChatCliProvider::Codex => Vec::new(),
    }
}

/// The model and effort for one turn; None keeps the CLI's own default.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ChatCliChoice<'a> {
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
}

/// A model id is one plain argument: never empty, never read as a flag, no
/// spaces or quotes. Matches isChatCliModelId in the desktop chatCliModels.ts.
fn valid_model_id(id: &str) -> bool {
    id.chars().count() <= MAX_MODEL_ID_CHARS
        && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '-'))
}

/// One Chat turn for an agent CLI: the arguments after the executable, the
/// files it reads first and what goes to its stdin.
#[derive(Debug, PartialEq)]
pub(crate) struct ChatCliTurn {
    pub(crate) args: Vec<String>,
    pub(crate) files: Vec<(PathBuf, String)>,
    pub(crate) stdin: String,
}

/// Plans one Chat turn. The shared contract fixture pins the same plan for the
/// browser preview bridge. Nothing that can hold a newline rides on the command
/// line: Windows refuses such arguments for the .cmd launchers npm installs
/// ("batch file arguments are invalid", measured on a Windows 11 test machine 2026-10-26), and
/// cmd.exe caps a whole command line at 8,191 characters. The question goes to
/// stdin; Claude Code reads its instructions and MCP servers from files named
/// after the request.
#[allow(clippy::too_many_arguments)]
pub(crate) fn plan_chat_cli_turn(
    provider: ChatCliProvider,
    server: &ChatToolServer,
    working_directory: &Path,
    request_id: &str,
    instructions: &str,
    prompt: &str,
    codex_features: &[String],
    choice: ChatCliChoice,
) -> ChatCliTurn {
    let server_args = server.args();
    let program = server.program.to_string_lossy().into_owned();
    match provider {
        ChatCliProvider::Codex => {
            let toml_args = format!(
                "[{}]",
                server_args
                    .iter()
                    .map(|arg| toml_string(arg))
                    .collect::<Vec<_>>()
                    .join(",")
            );
            let mut args: Vec<String> = vec![
                "exec".into(),
                "--json".into(),
                "--ephemeral".into(),
                "--skip-git-repo-check".into(),
                "--ignore-user-config".into(),
                "--ignore-rules".into(),
                "--disable".into(),
                "shell_tool".into(),
            ];
            args.extend(codex_disable_args(codex_features));
            args.extend([
                "--sandbox".into(),
                "read-only".into(),
                "-C".into(),
                working_directory.to_string_lossy().into_owned(),
                "-c".into(),
                "web_search=\"disabled\"".into(),
                "-c".into(),
                format!("mcp_servers.drifty.command={}", toml_string(&program)),
                "-c".into(),
                format!("mcp_servers.drifty.args={toml_args}"),
                "-c".into(),
                "mcp_servers.drifty.default_tools_approval_mode=\"approve\"".into(),
                // Without this Codex starts answering while the drifty server is
                // still starting and the turn has no drifty tools. The installed
                // tracker takes seconds to start, so codex-cli 0.163.0 answered
                // "I can't access your records" every time (2026-10-30). Required
                // makes Codex wait for it, or fail the turn if it cannot start.
                "-c".into(),
                "mcp_servers.drifty.required=true".into(),
            ]);
            if let Some(model) = choice.model {
                args.extend(["-m".into(), model.to_string()]);
            }
            if let Some(effort) = choice.effort {
                args.extend([
                    "-c".into(),
                    format!("model_reasoning_effort={}", toml_string(effort)),
                ]);
            }
            // "-" reads the instructions and question from stdin.
            args.extend(["--".into(), "-".into()]);
            ChatCliTurn {
                args,
                files: Vec::new(),
                stdin: format!("{instructions}\n\n{prompt}"),
            }
        }
        ChatCliProvider::Claude => {
            let mcp_config = serde_json::json!({
                "mcpServers": {
                    "drifty": { "type": "stdio", "command": program, "args": server_args }
                }
            });
            let system_prompt_file = working_directory.join(format!("{request_id}.system.md"));
            let mcp_config_file = working_directory.join(format!("{request_id}.mcp.json"));
            let allowed_tools = DRIFTY_MCP_TOOLS
                .iter()
                .chain(if server.memory.is_some() {
                    super::chat_memory::TOOLS.iter()
                } else {
                    [].iter()
                })
                .map(|tool| format!("mcp__drifty__{tool}"))
                .collect::<Vec<_>>()
                .join(",");
            let mut args: Vec<String> = vec![
                "--output-format".into(),
                "stream-json".into(),
                "--verbose".into(),
                "--include-partial-messages".into(),
                "--no-session-persistence".into(),
                "--system-prompt-file".into(),
                system_prompt_file.to_string_lossy().into_owned(),
                "--tools".into(),
                String::new(),
                "--strict-mcp-config".into(),
                // Only settings from the empty working folder: no user hooks,
                // plugins or permission rules run inside a Drifty turn.
                "--setting-sources".into(),
                "local".into(),
                "--mcp-config".into(),
                mcp_config_file.to_string_lossy().into_owned(),
                "--allowedTools".into(),
                allowed_tools,
            ];
            if let Some(model) = choice.model {
                args.extend(["--model".into(), model.to_string()]);
            }
            if let Some(effort) = choice.effort {
                args.extend(["--effort".into(), effort.to_string()]);
            }
            // Print mode with no prompt argument reads the question from stdin.
            args.push("-p".into());
            ChatCliTurn {
                args,
                files: vec![
                    (system_prompt_file, instructions.to_string()),
                    (mcp_config_file, mcp_config.to_string()),
                ],
                stdin: prompt.to_string(),
            }
        }
    }
}

#[derive(Clone, Debug)]
struct ResolvedExecutable {
    path: PathBuf,
    path_env: Option<OsString>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCliAvailability {
    pub provider: ChatCliProvider,
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCliStatus {
    pub providers: Vec<ChatCliAvailability>,
    pub tools_available: bool,
    pub tools_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCliSendRequest {
    pub request_id: String,
    pub provider: ChatCliProvider,
    pub detail: ChatToolDetail,
    pub instructions: String,
    pub prompt: String,
    /// The model to ask the CLI for; absent keeps the CLI's default.
    #[serde(default)]
    pub model: Option<String>,
    /// The reasoning effort to ask the CLI for; absent keeps the CLI's default.
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub memory_session: Option<uuid::Uuid>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatCliEvent {
    Line {
        line: String,
    },
    Exit {
        code: Option<i32>,
        cancelled: bool,
        #[serde(rename = "stderrTail")]
        stderr_tail: String,
    },
}

struct ChatCliRun {
    child: Mutex<Child>,
    cancelled: AtomicBool,
}

type ActiveRuns = Arc<Mutex<HashMap<String, Arc<ChatCliRun>>>>;

/// Running Chat turns by request id, so the page can cancel one.
#[derive(Default)]
pub struct ChatCliRuns {
    runs: ActiveRuns,
}

fn validate_request(request: &ChatCliSendRequest) -> Result<(), String> {
    let id = request.request_id.as_str();
    if id.is_empty()
        || id.chars().count() > MAX_REQUEST_ID_CHARS
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Chat request id is invalid.".into());
    }
    if request.prompt.trim().is_empty() {
        return Err("Chat message is empty.".into());
    }
    if request.prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err("Chat conversation is too long.".into());
    }
    if request.instructions.chars().count() > MAX_INSTRUCTIONS_CHARS {
        return Err("Chat instructions are too long.".into());
    }
    if request
        .model
        .as_deref()
        .is_some_and(|model| !valid_model_id(model))
    {
        return Err("Chat model is invalid.".into());
    }
    if request
        .effort
        .as_deref()
        .is_some_and(|effort| !CHAT_CLI_EFFORTS.contains(&effort))
    {
        return Err("Chat effort is invalid.".into());
    }
    Ok(())
}

#[cfg(unix)]
fn resolve_executable(name: &str) -> Option<ResolvedExecutable> {
    // GUI apps inherit a minimal PATH; ask the user's login shell where the CLI
    // lives and which PATH it needs (Node for npm-installed CLIs).
    let shell = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|shell| shell.is_absolute() && shell.is_file())
        .unwrap_or_else(|| PathBuf::from("/bin/zsh"));
    let script = format!(
        "printf '\\n__DRIFTY_CMD__%s\\n' \"$(command -v {name} 2>/dev/null)\"; printf '__DRIFTY_PATH__%s\\n' \"$PATH\""
    );
    for flags in [["-l", "-i"].as_slice(), ["-l"].as_slice()] {
        let mut command = Command::new(&shell);
        command
            .args(flags)
            .arg("-c")
            .arg(&script)
            .stdin(Stdio::null());
        let Ok(output) = crate::bounded_process::output(&mut command, LOOKUP_TIMEOUT) else {
            continue;
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let found = stdout
            .lines()
            .find_map(|line| line.strip_prefix("__DRIFTY_CMD__"))
            .map(str::trim)
            .filter(|path| path.starts_with('/'))
            .map(PathBuf::from)
            .filter(|path| path.is_file());
        let path_env = stdout
            .lines()
            .find_map(|line| line.strip_prefix("__DRIFTY_PATH__"))
            .map(|value| OsString::from(value.trim()))
            .filter(|value| !value.is_empty());
        if let Some(path) = found {
            return Some(ResolvedExecutable { path, path_env });
        }
    }
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    [
        home.join(".local/bin"),
        home.join(".claude/local"),
        home.join(".npm-global/bin"),
        home.join(".bun/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]
    .into_iter()
    .map(|dir| dir.join(name))
    .find(|candidate| candidate.is_file())
    .map(|path| ResolvedExecutable {
        path,
        path_env: None,
    })
}

#[cfg(windows)]
fn resolve_executable(name: &str) -> Option<ResolvedExecutable> {
    // A CLI installed while Drifty runs is missing from the PATH this process
    // started with. Read the saved machine and user PATH at each lookup, as a
    // new terminal would, and hand it to the CLI: npm's .cmd launchers need node.
    let process = std::env::var_os("PATH").map(|path| path.to_string_lossy().into_owned());
    let path_env = merge_windows_path(windows_saved_path().as_deref(), process.as_deref())?;
    std::env::split_paths(&path_env)
        .flat_map(|dir| ["exe", "cmd"].map(|ext| dir.join(format!("{name}.{ext}"))))
        .find(|candidate| candidate.is_file())
        .map(|path| ResolvedExecutable {
            path,
            path_env: Some(OsString::from(&path_env)),
        })
}

/// The machine PATH followed by the user PATH from the registry, expanded.
#[cfg(windows)]
fn windows_saved_path() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let machine = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
        .and_then(|key| key.get_value::<String, _>("Path"))
        .ok();
    let user = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .and_then(|key| key.get_value::<String, _>("Path"))
        .ok();
    let joined = [machine, user]
        .into_iter()
        .flatten()
        .map(|value| expand_windows_env(&value, |name| std::env::var(name).ok()))
        .collect::<Vec<_>>()
        .join(";");
    (!joined.is_empty()).then_some(joined)
}

/// Expands %NAME% as Windows does for a saved PATH; unknown names stay as written.
#[cfg(any(windows, test))]
fn expand_windows_env(value: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut expanded = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        expanded.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match lookup(name) {
                    Some(found) => expanded.push_str(&found),
                    None => {
                        expanded.push('%');
                        expanded.push_str(name);
                        expanded.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                expanded.push('%');
                rest = after;
            }
        }
    }
    expanded.push_str(rest);
    expanded
}

/// The saved PATH, then entries only this process has, without empty or repeated folders.
#[cfg(any(windows, test))]
fn merge_windows_path(saved: Option<&str>, process: Option<&str>) -> Option<String> {
    let mut seen = std::collections::HashSet::new();
    let entries: Vec<&str> = saved
        .into_iter()
        .chain(process)
        .flat_map(|value| value.split(';'))
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .filter(|entry| seen.insert(entry.trim_end_matches('\\').to_ascii_lowercase()))
        .collect();
    (!entries.is_empty()).then(|| entries.join(";"))
}

fn command_for(executable: &ResolvedExecutable) -> Command {
    let mut command = Command::new(&executable.path);
    if let Some(path_env) = &executable.path_env {
        command.env("PATH", path_env);
    }
    command
}

fn version_of(executable: &ResolvedExecutable) -> Option<String> {
    let mut command = command_for(executable);
    command.arg("--version").stdin(Stdio::null());
    let output = crate::bounded_process::output(&mut command, LOOKUP_TIMEOUT).ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

/// The installed Codex's feature names, or none when it cannot list them.
fn codex_features(executable: &ResolvedExecutable) -> Vec<String> {
    let mut command = command_for(executable);
    command.args(["features", "list"]).stdin(Stdio::null());
    match crate::bounded_process::output(&mut command, LOOKUP_TIMEOUT) {
        Ok(output) if output.status.success() => {
            parse_codex_features(&String::from_utf8_lossy(&output.stdout))
        }
        _ => Vec::new(),
    }
}

fn tool_server(
    app: &AppHandle,
    detail: ChatToolDetail,
    memory_session: Option<uuid::Uuid>,
) -> Result<ChatToolServer, String> {
    let (program, leading_args) = crate::tracker::resolve_tracker_cli_invocation(app)?;
    Ok(ChatToolServer {
        program,
        leading_args,
        database: crate::tracker::resolve_db_path(app),
        memory: memory_session
            .map(|id| super::chat_memory::open(app, id))
            .transpose()?,
        detail,
    })
}

/// One record lookup a Drifty Cloud model asked for. The app runs it on this
/// computer with the same read-only tools and detail policy as the CLI turns.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolCallRequest {
    pub name: String,
    pub arguments: serde_json::Value,
    pub detail: ChatToolDetail,
    #[serde(default)]
    pub memory_session: Option<uuid::Uuid>,
}

/// Arguments after the tool program for one `mcp --call`.
pub(crate) fn tool_call_args(
    server: &ChatToolServer,
    name: &str,
    arguments: &serde_json::Value,
) -> Result<Vec<String>, String> {
    if !DRIFTY_MCP_TOOLS.contains(&name) {
        return Err("Unknown Drifty record tool.".into());
    }
    if !arguments.is_object() {
        return Err("Record tool arguments must be an object.".into());
    }
    let encoded = arguments.to_string();
    if encoded.len() > MAX_TOOL_ARGUMENTS_BYTES {
        return Err("Record tool arguments are too long.".into());
    }
    let mut args = server.args();
    args.extend([
        "--call".to_string(),
        name.to_string(),
        "--arguments".to_string(),
        encoded,
    ]);
    Ok(args)
}

#[tauri::command]
pub async fn chat_tool_call(
    app: AppHandle,
    request: ChatToolCallRequest,
) -> Result<String, String> {
    if super::chat_memory::TOOLS.contains(&request.name.as_str()) {
        #[cfg(drifty_screen_context_excluded)]
        return Err("memory_unavailable".into());
        #[cfg(not(drifty_screen_context_excluded))]
        {
            use tauri::Manager;
            let session = request.memory_session.ok_or("memory_unavailable")?;
            return tauri::async_runtime::spawn_blocking(move || {
                let value = app.state::<super::ScreenContextAccount>().runtime.memory_chat_tool(&app, session, &request.name, &request.arguments)?;
                let payload = serde_json::json!({"kind":"observed_memory","data":value});
                Ok(serde_json::json!({"content":[{"type":"text","text":payload.to_string()}],"isError":false}).to_string())
            }).await.map_err(|_| "memory_unavailable".to_owned())?;
        }
    }
    let server = tool_server(&app, request.detail, None)?;
    let args = tool_call_args(&server, &request.name, &request.arguments)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(&server.program);
        command
            .args(args.iter().map(OsStr::new))
            .stdin(Stdio::null());
        let output = crate::bounded_process::output(&mut command, TOOL_CALL_TIMEOUT)
            .map_err(|error| format!("The record tool could not run: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let tail = stderr.lines().last().unwrap_or("").trim().to_string();
            return Err(if tail.is_empty() {
                "The record tool stopped unexpectedly.".to_string()
            } else {
                tail
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn working_directory() -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join("drifty-chat");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Chat working folder could not be created: {error}"))?;
    Ok(directory)
}

#[tauri::command]
pub async fn chat_cli_status(app: AppHandle) -> Result<ChatCliStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let providers = ChatCliProvider::ALL
            .into_iter()
            .map(|provider| {
                let executable = resolve_executable(provider.executable_name());
                ChatCliAvailability {
                    provider,
                    installed: executable.is_some(),
                    version: executable.as_ref().and_then(version_of),
                }
            })
            .collect();
        let tools = crate::tracker::resolve_tracker_cli_invocation(&app);
        ChatCliStatus {
            providers,
            tools_available: tools.is_ok(),
            tools_message: tools.err(),
        }
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn chat_cli_send(
    app: AppHandle,
    runs: State<'_, ChatCliRuns>,
    request: ChatCliSendRequest,
    on_event: Channel<ChatCliEvent>,
) -> Result<(), String> {
    validate_request(&request)?;
    let server = tool_server(&app, request.detail, request.memory_session)?;
    let runs = Arc::clone(&runs.runs);
    tauri::async_runtime::spawn_blocking(move || start_run(runs, request, server, on_event))
        .await
        .map_err(|error| error.to_string())?
}

fn start_run(
    runs: ActiveRuns,
    request: ChatCliSendRequest,
    server: ChatToolServer,
    on_event: Channel<ChatCliEvent>,
) -> Result<(), String> {
    let name = request.provider.executable_name();
    let executable = resolve_executable(name)
        .ok_or_else(|| format!("{name} is not installed or not on this computer's PATH."))?;
    let directory = working_directory()?;
    let codex_features = match request.provider {
        ChatCliProvider::Codex => codex_features(&executable),
        ChatCliProvider::Claude => Vec::new(),
    };
    let turn = plan_chat_cli_turn(
        request.provider,
        &server,
        &directory,
        &request.request_id,
        &request.instructions,
        &request.prompt,
        &codex_features,
        ChatCliChoice {
            model: request.model.as_deref(),
            effort: request.effort.as_deref(),
        },
    );
    let turn_files = TurnFiles(turn.files.iter().map(|(path, _)| path.clone()).collect());
    for (path, contents) in &turn.files {
        std::fs::write(path, contents)
            .map_err(|error| format!("Chat could not prepare this turn: {error}"))?;
    }
    let mut command = command_for(&executable);
    command
        .args(turn.args.iter().map(OsStr::new))
        .envs(chat_cli_env(request.provider))
        .current_dir(&directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("{name} could not start: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let question = turn.stdin;
        // Written on its own thread so a CLI that prints before it reads cannot stall the turn.
        std::thread::spawn(move || {
            let _ = stdin.write_all(question.as_bytes());
        });
    }
    let stdout = child.stdout.take().ok_or("Chat output is unavailable.")?;
    let stderr = child.stderr.take().ok_or("Chat output is unavailable.")?;
    let run = Arc::new(ChatCliRun {
        child: Mutex::new(child),
        cancelled: AtomicBool::new(false),
    });
    {
        let mut active = runs.lock().map_err(|_| "Chat state is unavailable.")?;
        if active.contains_key(&request.request_id) {
            if let Ok(mut child) = run.child.lock() {
                let _ = child.kill();
            }
            return Err("This Chat request is already running.".into());
        }
        active.insert(request.request_id.clone(), Arc::clone(&run));
    }

    let stderr_reader = std::thread::spawn(move || read_tail(stderr, STDERR_TAIL_BYTES));
    std::thread::spawn(move || {
        let _turn_files = turn_files;
        let memory = server.memory;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            if memory.as_ref().is_some_and(|bridge| !bridge.current()) {
                run.cancelled.store(true, Ordering::SeqCst);
                if let Ok(mut child) = run.child.lock() {
                    let _ = child.kill();
                }
                break;
            }
            if on_event.send(ChatCliEvent::Line { line }).is_err() {
                if let Ok(mut child) = run.child.lock() {
                    let _ = child.kill();
                }
                break;
            }
        }
        let code = run
            .child
            .lock()
            .ok()
            .and_then(|mut child| child.wait().ok())
            .and_then(|status| status.code());
        let stderr_tail = stderr_reader.join().unwrap_or_default();
        if let Ok(mut active) = runs.lock() {
            active.remove(&request.request_id);
        }
        let _ = on_event.send(ChatCliEvent::Exit {
            code,
            cancelled: run.cancelled.load(Ordering::SeqCst),
            stderr_tail,
        });
    });
    Ok(())
}

/// How long after a drop on the main window its files may be read for Chat.
const DROPPED_FILE_WINDOW: Duration = Duration::from_secs(60);
/// The same 20 MB cap the page applies to a picked file.
const MAX_DROPPED_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// Files most recently dropped on the main window. Tauri's own drop handler
/// takes file drops before the page sees them (dragDropEnabled is on by
/// default), so Chat reads a dropped file through chat_read_dropped_file, which
/// only accepts paths the operating system just reported for that drop.
#[derive(Default)]
pub struct ChatDroppedFiles(Mutex<Option<(Instant, Vec<PathBuf>)>>);

impl ChatDroppedFiles {
    pub fn remember(&self, paths: &[PathBuf]) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some((Instant::now(), paths.to_vec()));
        }
    }

    fn allows(&self, path: &Path, now: Instant) -> bool {
        self.0
            .lock()
            .ok()
            .and_then(|slot| {
                slot.as_ref().map(|(at, paths)| {
                    now.saturating_duration_since(*at) <= DROPPED_FILE_WINDOW
                        && paths.iter().any(|dropped| dropped == path)
                })
            })
            .unwrap_or(false)
    }
}

/// Reads one dropped file for Chat. Errors are the page's attachment reasons.
fn read_dropped_file(
    dropped: &ChatDroppedFiles,
    path: &Path,
    now: Instant,
    limit: u64,
) -> Result<Vec<u8>, String> {
    if !dropped.allows(path, now) {
        return Err("notDropped".into());
    }
    let metadata = std::fs::metadata(path).map_err(|_| "unreadable".to_string())?;
    if !metadata.is_file() {
        return Err("unreadable".into());
    }
    if metadata.len() > limit {
        return Err("tooLarge".into());
    }
    std::fs::read(path).map_err(|_| "unreadable".to_string())
}

#[tauri::command]
pub async fn chat_read_dropped_file(
    dropped: State<'_, ChatDroppedFiles>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    if !dropped.allows(&path, Instant::now()) {
        return Err("notDropped".into());
    }
    let allowed = ChatDroppedFiles::default();
    allowed.remember(std::slice::from_ref(&path));
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        read_dropped_file(&allowed, &path, Instant::now(), MAX_DROPPED_FILE_BYTES)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// A turn's instruction and MCP files, removed when the turn ends or fails to start.
struct TurnFiles(Vec<PathBuf>);

impl Drop for TurnFiles {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn read_tail(mut reader: impl Read, limit: usize) -> String {
    let mut buffer = Vec::new();
    let _ = reader.read_to_end(&mut buffer);
    let start = buffer.len().saturating_sub(limit);
    String::from_utf8_lossy(&buffer[start..]).into_owned()
}

#[tauri::command]
pub fn chat_cli_cancel(runs: State<'_, ChatCliRuns>, request_id: String) -> Result<bool, String> {
    let run = runs
        .runs
        .lock()
        .map_err(|_| "Chat state is unavailable.")?
        .get(&request_id)
        .cloned();
    let Some(run) = run else {
        return Ok(false);
    };
    run.cancelled.store(true, Ordering::SeqCst);
    let mut child = run.child.lock().map_err(|_| "Chat state is unavailable.")?;
    Ok(child.kill().is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTRACT: &str =
        include_str!("../../../apps/desktop/src/features/chat/chatCliArgsContract.json");

    fn contract() -> serde_json::Value {
        serde_json::from_str(CONTRACT).expect("contract fixture is JSON")
    }

    fn strings(value: &serde_json::Value) -> Vec<String> {
        value
            .as_array()
            .expect("array")
            .iter()
            .map(|item| item.as_str().expect("string").to_string())
            .collect()
    }

    fn contract_args(provider: ChatCliProvider) -> Vec<String> {
        contract_args_with(provider, ChatCliChoice::default())
    }

    fn contract_args_with(provider: ChatCliProvider, choice: ChatCliChoice) -> Vec<String> {
        contract_turn(provider, choice, None).args
    }

    fn contract_server() -> ChatToolServer {
        let contract = contract();
        let input = &contract["input"];
        ChatToolServer {
            memory: None,
            program: PathBuf::from(input["toolProgram"].as_str().unwrap()),
            leading_args: strings(&input["toolLeadingArgs"])
                .into_iter()
                .map(OsString::from)
                .collect(),
            database: PathBuf::from(input["database"].as_str().unwrap()),
            detail: match input["detail"].as_str().unwrap() {
                "titles" => ChatToolDetail::Titles,
                _ => ChatToolDetail::Safe,
            },
        }
    }

    fn contract_turn(
        provider: ChatCliProvider,
        choice: ChatCliChoice,
        text: Option<(&str, &str)>,
    ) -> ChatCliTurn {
        let contract = contract();
        let input = &contract["input"];
        let (instructions, prompt) = text.unwrap_or((
            input["instructions"].as_str().unwrap(),
            input["prompt"].as_str().unwrap(),
        ));
        plan_chat_cli_turn(
            provider,
            &contract_server(),
            Path::new(input["workingDirectory"].as_str().unwrap()),
            input["requestId"].as_str().unwrap(),
            instructions,
            prompt,
            &parse_codex_features(&strings(&input["codexFeaturesList"]).join("\n")),
            choice,
        )
    }

    #[test]
    fn chat_reads_only_files_just_dropped_on_the_window() {
        let directory =
            std::env::temp_dir().join(format!("drifty-chat-drop-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let notes = directory.join("notes.txt");
        std::fs::write(&notes, "10시 리뷰").unwrap();
        let other = directory.join("other.txt");
        std::fs::write(&other, "not dropped").unwrap();
        let dropped = ChatDroppedFiles::default();
        let now = Instant::now();
        assert_eq!(
            read_dropped_file(&dropped, &notes, now, 1024),
            Err("notDropped".into())
        );
        dropped.remember(&[notes.clone(), directory.clone()]);
        assert_eq!(
            read_dropped_file(&dropped, &notes, now, 1024),
            Ok("10시 리뷰".as_bytes().to_vec())
        );
        assert_eq!(
            read_dropped_file(&dropped, &other, now, 1024),
            Err("notDropped".into())
        );
        assert_eq!(
            read_dropped_file(&dropped, &directory, now, 1024),
            Err("unreadable".into())
        );
        assert_eq!(
            read_dropped_file(&dropped, &notes, now, 4),
            Err("tooLarge".into())
        );
        let later = now + DROPPED_FILE_WINDOW + Duration::from_secs(1);
        assert_eq!(
            read_dropped_file(&dropped, &notes, later, 1024),
            Err("notDropped".into())
        );
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn windows_finds_a_cli_on_the_saved_path_like_a_new_terminal() {
        let lookup = |name: &str| (name == "USERPROFILE").then(|| r"C:\Users\Ann Lee".to_string());
        assert_eq!(
            expand_windows_env(r"%USERPROFILE%\.local\bin;%NOT_SET%\bin;C:\100%", lookup),
            r"C:\Users\Ann Lee\.local\bin;%NOT_SET%\bin;C:\100%"
        );
        // Machine and user folders come first; the process adds only what they lack.
        assert_eq!(
            merge_windows_path(
                Some(r"C:\Windows;C:\Program Files\nodejs\;C:\Users\Ann Lee\AppData\Roaming\npm"),
                Some(r"c:\windows\;;C:\Users\Ann Lee\AppData\Local\drifty"),
            )
            .as_deref(),
            Some(
                r"C:\Windows;C:\Program Files\nodejs\;C:\Users\Ann Lee\AppData\Roaming\npm;C:\Users\Ann Lee\AppData\Local\drifty"
            )
        );
        assert_eq!(merge_windows_path(None, Some(" ; ")), None);
    }

    #[test]
    fn claude_code_reads_instructions_and_mcp_servers_from_the_contract_files() {
        let contract = contract();
        let expected: Vec<(PathBuf, String)> = contract["files"]["claude"]
            .as_array()
            .expect("files array")
            .iter()
            .map(|file| {
                (
                    PathBuf::from(file["path"].as_str().unwrap()),
                    file["content"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        let claude = contract_turn(ChatCliProvider::Claude, ChatCliChoice::default(), None);
        assert_eq!(claude.files, expected);
        assert_eq!(claude.stdin, contract["stdin"]["claude"].as_str().unwrap());
        let codex = contract_turn(ChatCliProvider::Codex, ChatCliChoice::default(), None);
        assert!(codex.files.is_empty());
        assert_eq!(codex.stdin, contract["stdin"]["codex"].as_str().unwrap());
    }

    #[test]
    fn no_argument_holds_a_newline_so_windows_cmd_launchers_accept_the_turn() {
        let text = (
            "Answer from records.\nNever guess.",
            "-v What did I do?\nAnd \"why\" 100% & <ok>",
        );
        for provider in [ChatCliProvider::Codex, ChatCliProvider::Claude] {
            let turn = contract_turn(provider, ChatCliChoice::default(), Some(text));
            assert!(
                turn.args.iter().all(|arg| !arg.contains(['\n', '\r'])),
                "{provider:?} put a newline on the command line"
            );
            assert!(turn.stdin.contains(text.1));
        }
    }

    #[test]
    fn a_chosen_model_and_effort_go_where_the_preview_bridge_puts_them() {
        let contract = contract();
        let choice = &contract["choice"];
        let codex = contract_args(ChatCliProvider::Codex);
        let end = codex.iter().position(|arg| arg == "--").unwrap();
        let mut expected = codex[..end].to_vec();
        expected.extend(strings(&choice["codexArgsBeforeEndOfOptions"]));
        expected.extend(codex[end..].to_vec());
        assert_eq!(
            contract_args_with(
                ChatCliProvider::Codex,
                ChatCliChoice {
                    model: choice["codex"]["model"].as_str(),
                    effort: choice["codex"]["effort"].as_str(),
                },
            ),
            expected
        );
        let claude = contract_args(ChatCliProvider::Claude);
        let print = claude.iter().position(|arg| arg == "-p").unwrap();
        let mut expected = claude[..print].to_vec();
        expected.extend(strings(&choice["claudeArgsBeforePrint"]));
        expected.extend(claude[print..].to_vec());
        assert_eq!(
            contract_args_with(
                ChatCliProvider::Claude,
                ChatCliChoice {
                    model: choice["claude"]["model"].as_str(),
                    effort: choice["claude"]["effort"].as_str(),
                },
            ),
            expected
        );
    }

    #[test]
    fn only_extra_codex_features_the_installed_version_knows_are_turned_off() {
        let codex = contract_args(ChatCliProvider::Codex);
        let disabled: Vec<&str> = codex
            .windows(2)
            .filter(|pair| pair[0] == "--disable")
            .map(|pair| pair[1].as_str())
            .collect();
        assert_eq!(
            disabled,
            ["shell_tool", "view_image", "multi_agent", "apps"]
        );
        assert!(!disabled.contains(&"code_mode_host"));
    }

    #[test]
    fn claude_code_waits_for_the_drifty_tools_before_answering() {
        let expected: Vec<(String, String)> = contract()["claudeEnv"]
            .as_object()
            .expect("claudeEnv object")
            .iter()
            .map(|(key, value)| (key.clone(), value.as_str().unwrap().to_string()))
            .collect();
        let actual: Vec<(String, String)> = chat_cli_env(ChatCliProvider::Claude)
            .into_iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        assert_eq!(actual, expected);
        assert!(chat_cli_env(ChatCliProvider::Codex).is_empty());
    }

    #[test]
    fn codex_waits_for_the_drifty_tools_before_answering() {
        let codex = contract_args(ChatCliProvider::Codex);
        assert!(codex
            .windows(2)
            .any(|pair| pair[0] == "-c" && pair[1] == "mcp_servers.drifty.required=true"));
    }

    #[test]
    fn codex_arguments_match_the_shared_contract() {
        assert_eq!(
            contract_args(ChatCliProvider::Codex),
            strings(&contract()["codex"])
        );
    }

    #[test]
    fn claude_arguments_match_the_shared_contract() {
        assert_eq!(
            contract_args(ChatCliProvider::Claude),
            strings(&contract()["claude"])
        );
    }

    #[test]
    fn every_turn_turns_off_shell_tools_sessions_and_user_configuration() {
        let codex = contract_args(ChatCliProvider::Codex);
        for flag in [
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "shell_tool",
            "read-only",
        ] {
            assert!(
                codex.iter().any(|arg| arg == flag),
                "codex is missing {flag}"
            );
        }
        let claude = contract_args(ChatCliProvider::Claude);
        for flag in ["--no-session-persistence", "--strict-mcp-config", "--tools"] {
            assert!(
                claude.iter().any(|arg| arg == flag),
                "claude is missing {flag}"
            );
        }
        let tools_value = claude
            .iter()
            .position(|arg| arg == "--tools")
            .map(|index| claude[index + 1].as_str());
        assert_eq!(tools_value, Some(""));
        // The question arrives on stdin, so no part of it can be read as a flag.
        assert_eq!(&codex[codex.len() - 2..], ["--", "-"]);
        assert_eq!(claude.last().map(String::as_str), Some("-p"));
    }

    #[test]
    fn tool_server_paths_with_quotes_stay_one_toml_string() {
        let server = ChatToolServer {
            memory: None,
            program: PathBuf::from("/Apps/My \"Drifty\".app/drifty-tracker"),
            leading_args: vec![],
            database: PathBuf::from("/db/tracker.sqlite3"),
            detail: ChatToolDetail::Safe,
        };
        let args = plan_chat_cli_turn(
            ChatCliProvider::Codex,
            &server,
            Path::new("/tmp"),
            "turn-1",
            "i",
            "p",
            &[],
            ChatCliChoice::default(),
        )
        .args;
        assert!(args.contains(
            &"mcp_servers.drifty.command=\"/Apps/My \\\"Drifty\\\".app/drifty-tracker\""
                .to_string()
        ));
    }

    fn request(id: &str, prompt: &str) -> ChatCliSendRequest {
        ChatCliSendRequest {
            request_id: id.into(),
            provider: ChatCliProvider::Codex,
            detail: ChatToolDetail::Safe,
            instructions: "i".into(),
            prompt: prompt.into(),
            model: None,
            effort: None,
            memory_session: None,
        }
    }

    #[test]
    fn cloud_tool_calls_reuse_the_server_detail_and_reject_unknown_tools() {
        let server = ChatToolServer {
            memory: None,
            program: PathBuf::from("/Apps/Drifty.app/drifty-tracker"),
            leading_args: vec![],
            database: PathBuf::from("/db/tracker.sqlite3"),
            detail: ChatToolDetail::Titles,
        };
        let args = tool_call_args(
            &server,
            "search",
            &serde_json::json!({ "query": "Polaris", "day": "2026-07-29" }),
        )
        .expect("valid call");
        assert_eq!(
            args,
            [
                "--db",
                "/db/tracker.sqlite3",
                "mcp",
                "--detail",
                "titles",
                "--call",
                "search",
                "--arguments",
                "{\"day\":\"2026-07-29\",\"query\":\"Polaris\"}"
            ]
        );
        assert!(tool_call_args(&server, "shell", &serde_json::json!({})).is_err());
        assert!(tool_call_args(&server, "summary", &serde_json::json!(["2026-07-29"])).is_err());
        let long = "x".repeat(MAX_TOOL_ARGUMENTS_BYTES);
        assert!(tool_call_args(&server, "search", &serde_json::json!({ "query": long })).is_err());
    }

    #[test]
    fn requests_are_validated_before_anything_starts() {
        assert!(validate_request(&request("turn-1", "hello")).is_ok());
        assert!(validate_request(&request("", "hello")).is_err());
        assert!(validate_request(&request("bad id;rm", "hello")).is_err());
        assert!(validate_request(&request("turn-1", "   ")).is_err());
        assert!(validate_request(&request("turn-1", &"x".repeat(MAX_PROMPT_CHARS + 1))).is_err());
        let chosen = |model: Option<&str>, effort: Option<&str>| ChatCliSendRequest {
            model: model.map(String::from),
            effort: effort.map(String::from),
            ..request("turn-1", "hello")
        };
        assert!(validate_request(&chosen(Some("gpt-6.1-sol"), Some("xhigh"))).is_ok());
        assert!(validate_request(&chosen(Some("opus"), None)).is_ok());
        for model in ["-c", "--model", "gpt 6", "a\"b", ""] {
            assert!(
                validate_request(&chosen(Some(model), None)).is_err(),
                "{model}"
            );
        }
        assert!(validate_request(&chosen(None, Some("ultra"))).is_err());
    }

    #[test]
    fn events_serialize_for_the_page() {
        let line = serde_json::to_value(ChatCliEvent::Line { line: "{}".into() }).unwrap();
        assert_eq!(line, serde_json::json!({ "kind": "line", "line": "{}" }));
        let exit = serde_json::to_value(ChatCliEvent::Exit {
            code: Some(0),
            cancelled: false,
            stderr_tail: String::new(),
        })
        .unwrap();
        assert_eq!(
            exit,
            serde_json::json!({ "kind": "exit", "code": 0, "cancelled": false, "stderrTail": "" })
        );
    }
}
