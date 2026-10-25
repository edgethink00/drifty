import type { ChatProvider } from "./chatTypes";

/** Reasoning effort both agent CLIs accept: Codex's model_reasoning_effort and Claude Code's --effort. */
export const CHAT_CLI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ChatCliEffort = (typeof CHAT_CLI_EFFORTS)[number];

/**
 * Effort names stay in English in every language, as in the Codex app: its
 * English edition says Light, Medium, High, Extra High and Max, and its Korean
 * edition keeps Light to Extra High in English (ChatGPT.app strings, 2026-10).
 * The menu lists the names alone, without hints.
 */
export const CHAT_CLI_EFFORT_LABELS: Readonly<Record<ChatCliEffort, string>> = {
  low: "Light",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export type ChatCliModelHint = "everyday" | "smartest" | "fast" | "balanced" | "deeper";

export type ChatCliModel = {
  /** Passed to the CLI as is: Codex -m, Claude Code --model. */
  readonly id: string;
  readonly label: string;
  readonly hint: ChatCliModelHint;
};

/**
 * Models offered per agent CLI; the composer starts at CHAT_CLI_DEFAULTS. Codex's are the
 * first listed models of its bundled catalog (codex debug models --bundled,
 * codex-cli 0.162). Claude Code gets the same full model ids and versions as
 * Drifty Cloud, because its aliases lag behind: claude-code 2.1.215 resolves
 * opus to claude-opus-4-8 and haiku to claude-haiku-4-5, so a versioned label
 * would not name the model that answers. A model the person's plan does not
 * include fails with the CLI's own message.
 */
export const CHAT_CLI_MODELS: Readonly<Record<ChatProvider, readonly ChatCliModel[]>> = {
  codex: [
    { id: "gpt-6.1-sol", label: "GPT-6.1-Sol", hint: "everyday" },
    { id: "gpt-6-astra", label: "GPT-6-Astra", hint: "smartest" },
    { id: "gpt-6-luna", label: "GPT-6-Luna", hint: "fast" },
  ],
  claude: [
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "balanced" },
    { id: "claude-opus-5-5", label: "Opus 5.5", hint: "deeper" },
    { id: "claude-fable-5-1", label: "Fable 5.1", hint: "smartest" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "fast" },
  ],
};

/** Claude Code aliases remembered before the composer named versions, mapped to the model they stood for. */
export const CHAT_CLI_FORMER_MODEL_IDS: Readonly<Partial<Record<ChatProvider, Readonly<Record<string, string>>>>> = {
  claude: { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5", fable: "claude-fable-5-1", haiku: "claude-haiku-5-5" },
};

/** The model and effort sent with one CLI turn. The composer always fills both; an absent value keeps the CLI's default. */
export type ChatCliChoice = {
  readonly model?: string;
  readonly effort?: ChatCliEffort;
};

export type ChatCliSelection = { readonly model: string; readonly effort: ChatCliEffort };

/**
 * What the composer starts with, sent like any other choice. Codex: the first
 * model of its bundled catalog. Claude Code: Sonnet, like Drifty Cloud's
 * default, instead of the account's own default (Opus on Max plans), so
 * record questions stay quick and light on the plan.
 */
export const CHAT_CLI_DEFAULTS: Readonly<Record<ChatProvider, ChatCliSelection>> = {
  codex: { model: "gpt-6.1-sol", effort: "medium" },
  claude: { model: "claude-sonnet-5-5", effort: "medium" },
};

/** A model id is one plain argument: never empty, never read as a flag, no spaces or quotes. */
export function isChatCliModelId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(value);
}

export function isChatCliEffort(value: unknown): value is ChatCliEffort {
  return typeof value === "string" && (CHAT_CLI_EFFORTS as readonly string[]).includes(value);
}
