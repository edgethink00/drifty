import type { ChatProvider } from "./chatTypes";

/** Reasoning effort both agent CLIs accept: Codex's model_reasoning_effort and Claude Code's --effort. */
export const CHAT_CLI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ChatCliEffort = (typeof CHAT_CLI_EFFORTS)[number];

export type ChatCliModelHint = "everyday" | "smartest" | "fast" | "balanced" | "deeper";

export type ChatCliModel = {
  /** Passed to the CLI as is: Codex -m, Claude Code --model. */
  readonly id: string;
  readonly label: string;
  readonly hint: ChatCliModelHint;
};

/**
 * Models offered per agent CLI besides the CLI's own default. Codex's are the
 * first listed models of its bundled catalog (codex debug models --bundled,
 * codex-cli 0.162); Claude Code takes aliases that follow the latest version
 * (claude --help, 2.1.215). A model the person's plan does not include fails
 * with the CLI's own message.
 */
export const CHAT_CLI_MODELS: Readonly<Record<ChatProvider, readonly ChatCliModel[]>> = {
  codex: [
    { id: "gpt-6.1-sol", label: "GPT-6.1-Sol", hint: "everyday" },
    { id: "gpt-6-astra", label: "GPT-6-Astra", hint: "smartest" },
    { id: "gpt-6-luna", label: "GPT-6-Luna", hint: "fast" },
  ],
  claude: [
    { id: "sonnet", label: "Sonnet", hint: "balanced" },
    { id: "opus", label: "Opus", hint: "deeper" },
    { id: "fable", label: "Fable", hint: "smartest" },
    { id: "haiku", label: "Haiku", hint: "fast" },
  ],
};

/** The model and effort for one CLI turn; an absent value keeps the CLI's default. */
export type ChatCliChoice = {
  readonly model?: string;
  readonly effort?: ChatCliEffort;
};

/** A model id is one plain argument: never empty, never read as a flag, no spaces or quotes. */
export function isChatCliModelId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(value);
}

export function isChatCliEffort(value: unknown): value is ChatCliEffort {
  return typeof value === "string" && (CHAT_CLI_EFFORTS as readonly string[]).includes(value);
}
