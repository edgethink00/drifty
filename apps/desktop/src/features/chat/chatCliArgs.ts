import type { ChatProvider, ChatToolDetail } from "./chatTypes";

/** The read-only tool server one Chat turn hands to the agent CLI. */
export type ChatToolServerSpec = {
  readonly program: string;
  readonly leadingArgs: readonly string[];
  readonly database: string;
  readonly detail: ChatToolDetail;
};

const DRIFTY_TOOLS = ["summary", "search", "timeline"] as const;

/**
 * Codex features that add tools or context beyond the drifty tools (images,
 * sub-agents, apps, plugins, browsers, hooks). Each turn turns off the ones the
 * installed Codex knows; an unknown name would make Codex refuse to start, so
 * the list is filtered by `codex features list`. Code mode stays on: some
 * Codex builds serve MCP tools through it, and turning it off hid the drifty
 * tools (measured 2026-10-24). The native app keeps the same list in
 * src-tauri chat_cli.rs.
 */
export const CODEX_DISABLED_FEATURES = [
  "unified_exec", "js_repl", "view_image", "image_generation",
  "multi_agent", "multi_agent_v2", "apps", "plugins", "remote_plugin", "skill_search", "tool_suggest",
  "browser_use", "browser_use_external", "in_app_browser", "computer_use", "goals", "memories", "hooks",
  "sleep_tool", "workspace_dependencies", "worktrees", "realtime_conversation",
] as const;

/** Feature names from `codex features list` ("name  stage  enabled" rows), skipping removed ones. */
export function parseCodexFeatures(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split("\n")) {
    const match = /^([a-z0-9_.]+)\s+(\S.*?)\s+(true|false)$/.exec(line.trim());
    if (match && match[2] !== "removed") names.push(match[1]);
  }
  return names;
}

function codexDisableArgs(installedFeatures: readonly string[]): string[] {
  const installed = new Set(installedFeatures);
  return CODEX_DISABLED_FEATURES.filter((name) => installed.has(name)).flatMap((name) => ["--disable", name]);
}

function toolServerArgs(server: ChatToolServerSpec): string[] {
  return [...server.leadingArgs, "--db", server.database, "mcp", "--detail", server.detail];
}

/**
 * Extra environment for one Chat turn. Claude Code's print mode starts
 * answering before MCP servers finish connecting unless told to wait; without
 * the drifty tools it then promises to check, or writes a pretend tool call and
 * guesses (measured 2026-10-24, Claude Code 2.1.215). Versions that do not know
 * the variable ignore it. The native app sets the same in chat_cli.rs.
 */
export function chatCliEnv(provider: ChatProvider): Record<string, string> {
  return provider === "claude" ? { MCP_CONNECTION_NONBLOCKING: "0" } : {};
}

/**
 * Agent CLI arguments for one Chat turn in the browser preview bridge. The
 * native app builds the same list in src-tauri chat_cli.rs; both are pinned by
 * chatCliArgsContract.json.
 */
export function buildChatCliArgs(
  provider: ChatProvider,
  server: ChatToolServerSpec,
  workingDirectory: string,
  instructions: string,
  prompt: string,
  codexFeatures: readonly string[] = [],
): string[] {
  const serverArgs = toolServerArgs(server);
  if (provider === "codex") {
    return [
      "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules",
      "--disable", "shell_tool", ...codexDisableArgs(codexFeatures), "--sandbox", "read-only", "-C", workingDirectory,
      "-c", "web_search=\"disabled\"",
      "-c", "mcp_servers.drifty.command=" + JSON.stringify(server.program),
      "-c", "mcp_servers.drifty.args=[" + serverArgs.map((arg) => JSON.stringify(arg)).join(",") + "]",
      "-c", "mcp_servers.drifty.default_tools_approval_mode=\"approve\"",
      "--",
      instructions + "\n\n" + prompt,
    ];
  }
  // Keys in sorted order, matching serde_json's map output in the native app.
  const mcpConfig = { mcpServers: { drifty: { args: serverArgs, command: server.program, type: "stdio" } } };
  return [
    "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--no-session-persistence",
    "--system-prompt", instructions,
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "local",
    "--mcp-config", JSON.stringify(mcpConfig),
    "--allowedTools", DRIFTY_TOOLS.map((tool) => "mcp__drifty__" + tool).join(","),
    "-p", "--",
    prompt,
  ];
}

