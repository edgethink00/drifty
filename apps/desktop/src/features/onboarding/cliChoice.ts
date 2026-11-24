/** The person's own agent CLIs that can classify activity: Codex CLI and Claude Code. */
export type CliSetupChoice = "codex_cli" | "claude_cli";

export function isCliSetupChoice(value: unknown): value is CliSetupChoice {
  return value === "codex_cli" || value === "claude_cli";
}

export function cliProviderName(value: unknown): string {
  return value === "codex_cli" ? "Codex CLI" : "Claude Code";
}

