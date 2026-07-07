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

// Direct-provider keys, like the self-hosted/OpenRouter keys, are session-only:
// they live in memory but are never written to localStorage (privacy boundary).
export type PersistedAnalysisAiSetupState = Omit<
  AnalysisAiSetupState,
  "openRouterApiKey" | "selfHostedApiKey" | "openaiApiKey" | "anthropicApiKey"
>;

export const ANALYSIS_AI_SETUP_STORAGE_KEY = "drifty.analysisAiSetup.v1";

/** Eval-backed default: GPT-5 mini had 0 false corrections at ~$0.01/day. */
export const DEFAULT_ANALYSIS_MODEL = "openai/gpt-5-mini";

/** Direct-key defaults use the bare (non OpenRouter-prefixed) model ids. */
export const DEFAULT_ANALYSIS_OPENAI_MODEL = "gpt-5-mini";
export const DEFAULT_ANALYSIS_ANTHROPIC_MODEL = "claude-sonnet-5";

export const ANALYSIS_RECOMMENDED_MODELS = [
  { id: "openai/gpt-5-mini", label: "GPT-5 mini", detail: "Recommended — 0 false corrections, ~$0.01/day", supportsZdr: true, badges: ["Default", "ZDR"] },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", detail: "Premium — same safety, higher cost", supportsZdr: true, badges: ["ZDR"] },
  { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", detail: "Cheapest frontier — verify correction quality", supportsZdr: true, badges: ["ZDR"] },
] as const satisfies readonly OpenRouterModelMetadata[];

export const DEFAULT_ANALYSIS_AI_SETUP: AnalysisAiSetupState = {
  provider: "cloud",
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
    openRouterModel,
    openRouterFallbackModels: normalizeOpenRouterFallbackModels(openRouterModel, setup.openRouterFallbackModels),
    selfHostedBaseUrl: setup.selfHostedBaseUrl.trim(),
    selfHostedModel: setup.selfHostedModel.trim(),
    openaiModel: setup.openaiModel.trim(),
    anthropicModel: setup.anthropicModel.trim(),
  };
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
