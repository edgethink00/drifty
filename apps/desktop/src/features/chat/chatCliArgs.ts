import type { ChatProvider, ChatToolDetail } from "./chatTypes";

/** The read-only tool server one Chat turn hands to the agent CLI. */
export type ChatToolServerSpec = {
  readonly program: string;
  readonly leadingArgs: readonly string[];
  readonly database: string;
  readonly detail: ChatToolDetail;
};

const DRIFTY_TOOLS = ["summary", "search", "timeline"] as const;

function toolServerArgs(server: ChatToolServerSpec): string[] {
  return [...server.leadingArgs, "--db", server.database, "mcp", "--detail", server.detail];
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
): string[] {
  const serverArgs = toolServerArgs(server);
  if (provider === "codex") {
    return [
      "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules",
      "--disable", "shell_tool", "--sandbox", "read-only", "-C", workingDirectory,
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

