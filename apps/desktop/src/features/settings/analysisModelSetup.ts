import {
  OPENROUTER_MAX_MODEL_IDS,
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
  type OpenRouterModelMetadata,
} from "./localAiSetup";

/**
 * The analysis (heavy project pass) model slot is independent from the live
 * per-segment classification slot. Classification is a small local model;
 * analysis needs a strong model (see scripts/eval-project-pass findings), so
 * this state and its persistence are deliberately separate from localAiSetup.
 */
export type AnalysisProvider = "cloud" | "openrouter" | "self_hosted" | "openai" | "anthropic";

export interface AnalysisAiSetupState {
  readonly provider: AnalysisProvider;
  readonly selectionSource?: "automatic" | "manual" | "legacy";
  readonly openRouterApiKey: string;
  readonly openRouterModel: string;
  readonly openRouterFallbackModels: string[];
  readonly selfHostedBaseUrl: string;
  readonly selfHostedApiKey: string;
  readonly selfHostedModel: string;
  readonly openaiApiKey: string;
  readonly openaiModel: string;
  readonly anthropicApiKey: string;
  readonly anthropicModel: string;
}

// Keys are never written to localStorage (privacy boundary). The shared
// custom endpoint and OpenRouter keys persist in the OS credential store;
// direct OpenAI/Anthropic keys also persist in their own OS credential slots.
export type PersistedAnalysisAiSetupState = Omit<
  AnalysisAiSetupState,
  "openRouterApiKey" | "selfHostedBaseUrl" | "selfHostedApiKey" | "openaiApiKey" | "anthropicApiKey"
>;

export const ANALYSIS_AI_SETUP_STORAGE_KEY = "drifty.analysisAiSetup.v1";

/**
 * Eval-backed default (scripts/eval-project-pass, 2026-10-09): GPT-6 Luna passed
 * every gate in both runs — 0 false corrections, 100% JSON, 100%/97% assignment —
 * at about one fifth of GPT-5 mini's cost and one third of its latency.
 */
export const DEFAULT_ANALYSIS_MODEL = "openai/gpt-6-luna";
/** The default persisted by builds before 2026-10; only used to recognise the legacy fingerprint. */
const LEGACY_DEFAULT_ANALYSIS_MODEL = "openai/gpt-5-mini";

/** Direct-key defaults use the bare (non OpenRouter-prefixed) model ids. */
export const DEFAULT_ANALYSIS_OPENAI_MODEL = "gpt-5-mini";
export const DEFAULT_ANALYSIS_ANTHROPIC_MODEL = "claude-sonnet-5";

export const ANALYSIS_RECOMMENDED_MODELS = [
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", detail: "Recommended — 0 false corrections, ~$0.001/day", supportsZdr: true, badges: ["Default", "ZDR"] },
  { id: "openai/gpt-5-mini", label: "GPT-5 mini", detail: "Previous default — same assignment quality, ~5× the cost", supportsZdr: true, badges: ["ZDR"] },
  { id: "openai/gpt-5", label: "GPT-5", detail: "Stronger corrections — higher cost", supportsZdr: true, badges: ["ZDR"] },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", detail: "Premium — same safety, higher cost", supportsZdr: true, badges: ["ZDR"] },
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", detail: "Conservative — 0 false corrections, assigns less time to projects", supportsZdr: true, badges: ["ZDR"] },
  { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", detail: "Cheapest frontier — verify correction quality", supportsZdr: true, badges: ["ZDR"] },
] as const satisfies readonly OpenRouterModelMetadata[];

/** Direct-key model suggestions (bare ids) for the OpenAI / Anthropic cards. */
export const ANALYSIS_OPENAI_MODEL_SUGGESTIONS = ["gpt-5-mini", "gpt-5"] as const;
// Anthropic API aliases use dashes ("claude-haiku-4-5"); the dotted form is
// OpenRouter's slug convention and is NOT a valid Anthropic API id.
export const ANALYSIS_ANTHROPIC_MODEL_SUGGESTIONS = ["claude-sonnet-5", "claude-haiku-5-5"] as const;

/**
 * Human display names for known model ids (both bare and OpenRouter-prefixed),
 * so the UI shows one consistent casing ("GPT-5 mini") instead of raw ids.
 */
const ANALYSIS_MODEL_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  "gpt-6-luna": "GPT-6 Luna",
  "gpt-5-mini": "GPT-5 mini",
  "gpt-5": "GPT-5",
  "gpt-5-nano": "GPT-5 nano",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-haiku-5.5": "Claude Haiku 5.5",
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-haiku-4.5": "Claude Haiku 4.5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
};

export function analysisModelDisplayLabel(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  const bare = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
  return ANALYSIS_MODEL_DISPLAY_LABELS[bare.toLowerCase()] ?? trimmed;
}

export const DEFAULT_ANALYSIS_AI_SETUP: AnalysisAiSetupState = {
  provider: "cloud",
  selectionSource: "automatic",
  openRouterApiKey: "",
  openRouterModel: DEFAULT_ANALYSIS_MODEL,
  openRouterFallbackModels: [],
  selfHostedBaseUrl: "https://api.openai.com/v1",
  selfHostedApiKey: "",
  selfHostedModel: "gpt-5-mini",
  openaiApiKey: "",
  openaiModel: DEFAULT_ANALYSIS_OPENAI_MODEL,
  anthropicApiKey: "",
  anthropicModel: DEFAULT_ANALYSIS_ANTHROPIC_MODEL,
};

function parseAnalysisProvider(value: unknown): AnalysisProvider {
  return value === "openrouter" || value === "self_hosted" || value === "cloud" || value === "openai" || value === "anthropic"
    ? value
    : DEFAULT_ANALYSIS_AI_SETUP.provider;
}

export function toPersistedAnalysisAiSetup(setup: AnalysisAiSetupState): PersistedAnalysisAiSetupState {
  const openRouterModel = normalizeOpenRouterPrimaryModel(setup.openRouterModel);
  return {
    provider: setup.provider,
    selectionSource: setup.selectionSource ?? "manual",
    openRouterModel,
    openRouterFallbackModels: normalizeOpenRouterFallbackModels(openRouterModel, setup.openRouterFallbackModels),
    selfHostedModel: setup.selfHostedModel.trim(),
    openaiModel: setup.openaiModel.trim(),
    anthropicModel: setup.anthropicModel.trim(),
  };
}

export type LegacyAnalysisCustomEndpointConnection = {
  readonly baseUrl: string;
};

/**
 * Reads the pre-shared-connection copy once so it can be migrated into the
 * Classification-owned connection. New writes deliberately omit this field,
 * leaving one durable source of truth for the shared Base URL.
 */
export function resolveLegacyAnalysisCustomEndpointConnection(): LegacyAnalysisCustomEndpointConnection | null {
  if (typeof window === "undefined") return null;
  try {
    const savedValue = window.localStorage.getItem(ANALYSIS_AI_SETUP_STORAGE_KEY);
    if (!savedValue) return null;
    const parsedValue: unknown = JSON.parse(savedValue);
    if (!parsedValue || typeof parsedValue !== "object") return null;
    const record = parsedValue as Record<string, unknown>;
    if (!("selfHostedBaseUrl" in record)) return null;
    const baseUrl = typeof record.selfHostedBaseUrl === "string" ? record.selfHostedBaseUrl.trim() : "";
    const isSelectedCustomEndpoint = record.provider === "self_hosted";
    const isCustomizedEndpoint = baseUrl.length > 0 && baseUrl !== DEFAULT_ANALYSIS_AI_SETUP.selfHostedBaseUrl;
    return isSelectedCustomEndpoint || isCustomizedEndpoint ? { baseUrl } : { baseUrl: "" };
  } catch {
    return null;
  }
}

/**
 * A stored setup that is exactly the legacy "openai + all defaults" fingerprint
 * was persisted by an older build's default, not chosen by the user — treat it
 * as non-explicit so the slot can follow the live provider instead.
 */
export function isLegacyDefaultAnalysisSetup(setup: AnalysisAiSetupState): boolean {
  return (
    setup.provider === "openai" &&
    setup.openaiModel === DEFAULT_ANALYSIS_OPENAI_MODEL &&
    setup.openRouterModel === LEGACY_DEFAULT_ANALYSIS_MODEL &&
    setup.openRouterFallbackModels.length === 0 &&
    setup.anthropicModel === DEFAULT_ANALYSIS_ANTHROPIC_MODEL &&
    setup.selfHostedModel === DEFAULT_ANALYSIS_AI_SETUP.selfHostedModel &&
    setup.selfHostedBaseUrl === DEFAULT_ANALYSIS_AI_SETUP.selfHostedBaseUrl
  );
}

/** True once the user has explicitly saved an analysis setup (vs. the follow-live default). */
export function hasStoredAnalysisAiSetup(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem(ANALYSIS_AI_SETUP_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function resolveInitialAnalysisAiSetup(): AnalysisAiSetupState {
  if (typeof window === "undefined") return DEFAULT_ANALYSIS_AI_SETUP;
  try {
    const savedValue = window.localStorage.getItem(ANALYSIS_AI_SETUP_STORAGE_KEY);
    if (!savedValue) return DEFAULT_ANALYSIS_AI_SETUP;
    const record = JSON.parse(savedValue) as Record<string, unknown>;
    if (!record || typeof record !== "object") return DEFAULT_ANALYSIS_AI_SETUP;
    const openRouterModel = normalizeOpenRouterPrimaryModel(typeof record.openRouterModel === "string" ? record.openRouterModel : "");
    return {
      provider: parseAnalysisProvider(record.provider),
      selectionSource: record.selectionSource === "automatic" || record.selectionSource === "manual" ? record.selectionSource : "legacy",
      openRouterApiKey: "",
      openRouterModel,
      openRouterFallbackModels: Array.isArray(record.openRouterFallbackModels)
        ? normalizeOpenRouterFallbackModels(openRouterModel, record.openRouterFallbackModels.filter((model): model is string => typeof model === "string"))
        : [],
      selfHostedBaseUrl:
        typeof record.selfHostedBaseUrl === "string" && record.selfHostedBaseUrl.trim() ? record.selfHostedBaseUrl : DEFAULT_ANALYSIS_AI_SETUP.selfHostedBaseUrl,
      selfHostedApiKey: "",
      selfHostedModel: typeof record.selfHostedModel === "string" ? record.selfHostedModel.trim() : DEFAULT_ANALYSIS_AI_SETUP.selfHostedModel,
      openaiApiKey: "",
      openaiModel:
        typeof record.openaiModel === "string" && record.openaiModel.trim() ? record.openaiModel.trim() : DEFAULT_ANALYSIS_AI_SETUP.openaiModel,
      anthropicApiKey: "",
      anthropicModel:
        typeof record.anthropicModel === "string" && record.anthropicModel.trim() ? record.anthropicModel.trim() : DEFAULT_ANALYSIS_AI_SETUP.anthropicModel,
    };
  } catch {
    return DEFAULT_ANALYSIS_AI_SETUP;
  }
}

export const ANALYSIS_MAX_MODEL_IDS = OPENROUTER_MAX_MODEL_IDS;
