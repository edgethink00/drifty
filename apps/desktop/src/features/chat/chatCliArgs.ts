import type { ChatCliChoice } from "./chatCliModels";
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

/** One Chat turn for an agent CLI: its arguments, the files it reads first and what goes to its stdin. */
export type ChatCliTurn = {
  readonly args: string[];
  readonly files: { readonly path: string; readonly content: string }[];
  readonly stdin: string;
};

/**
 * One Chat turn in the browser preview bridge. The native app plans the same
 * turn in src-tauri chat_cli.rs; both are pinned by chatCliArgsContract.json.
 * Nothing that can hold a newline rides on the command line: Windows refuses
 * such arguments for the .cmd launchers npm installs (measured on a Windows 11
 * test machine,
 * 2026-10-26), and cmd.exe caps a whole command line at 8,191 characters. The
 * question goes to stdin; Claude Code reads its instructions and MCP servers
 * from files named after the request.
 */
export function planChatCliTurn(
  provider: ChatProvider,
  server: ChatToolServerSpec,
  workingDirectory: string,
  requestId: string,
  instructions: string,
  prompt: string,
  codexFeatures: readonly string[] = [],
  choice: ChatCliChoice = {},
  withoutTools = false,
): ChatCliTurn {
  const serverArgs = toolServerArgs(server);
  if (provider === "codex") {
    const args = [
      "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules",
      "--disable", "shell_tool", ...codexDisableArgs(codexFeatures), "--sandbox", "read-only", "-C", workingDirectory,
      "-c", "web_search=\"disabled\"",
      "-c", "mcp_servers.drifty.command=" + JSON.stringify(server.program),
      "-c", "mcp_servers.drifty.args=[" + serverArgs.map((arg) => JSON.stringify(arg)).join(",") + "]",
      "-c", "mcp_servers.drifty.default_tools_approval_mode=\"approve\"",
      // Codex otherwise starts answering before the slow-starting tracker connects
      // and has no drifty tools for the turn (codex-cli 0.163.0, 2026-10-30).
      // The native app sets the same in chat_cli.rs.
      "-c", "mcp_servers.drifty.required=true",
      ...(choice.model ? ["-m", choice.model] : []),
      ...(choice.effort ? ["-c", "model_reasoning_effort=" + JSON.stringify(choice.effort)] : []),
      // "-" reads the instructions and question from stdin.
      "--", "-",
    ];
    if (withoutTools) {
      for (let index = args.length - 2; index >= 0; index--) {
        if (args[index] === "-c" && args[index + 1]?.startsWith("mcp_servers.")) args.splice(index, 2);
      }
      args.splice(args.length - 2, 0, "-c", "mcp_servers={}");
    }
    return { args, files: [], stdin: instructions + "\n\n" + prompt };
  }
  // Keys in sorted order, matching serde_json's map output in the native app.
  const mcpConfig = { mcpServers: { drifty: { args: serverArgs, command: server.program, type: "stdio" } } };
  const systemPromptFile = workingDirectory + "/" + requestId + ".system.md";
  const mcpConfigFile = workingDirectory + "/" + requestId + ".mcp.json";
  const args = [
    "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--no-session-persistence",
    "--system-prompt-file", systemPromptFile,
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "local",
    "--mcp-config", mcpConfigFile,
    "--allowedTools", withoutTools ? "" : DRIFTY_TOOLS.map((tool) => "mcp__drifty__" + tool).join(","),
    ...(choice.model ? ["--model", choice.model] : []),
    ...(choice.effort ? ["--effort", choice.effort] : []),
    // Print mode with no prompt argument reads the question from stdin.
    "-p",
  ];
  return {
    args,
    files: [{ path: systemPromptFile, content: instructions }, { path: mcpConfigFile, content: JSON.stringify(withoutTools ? { mcpServers: {} } : mcpConfig) }],
    stdin: prompt,
  };
}

