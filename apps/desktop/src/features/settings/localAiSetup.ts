import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL, normalizeDirectProviderModel } from "./directProviderModels";

export type LocalAiProvider = "managed_local" | "openrouter_byok" | "openai" | "anthropic" | "self_hosted" | "codex_cli" | "claude_cli";
export type DriftyAiRoute = "cloud" | "local";

export type LocalAiSetupState = {
  provider: LocalAiProvider;
  driftyRoute: DriftyAiRoute;
  managedLocalModelId: string;
  managedLocalBaseUrl: string;
  managedLocalModel: string;
  openRouterApiKey: string;
  openRouterModel: string;
  openRouterFallbackModels: string[];
  openaiApiKey: string;
  openaiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  selfHostedBaseUrl: string;
  selfHostedApiKey: string;
  selfHostedModel: string;
};

export type PersistedLocalAiSetupState = Omit<LocalAiSetupState, "openRouterApiKey" | "selfHostedApiKey" | "openaiApiKey" | "anthropicApiKey">;

export const LOCAL_AI_SETUP_STORAGE_KEY = "drifty.aiSetup.v1";
export const DEFAULT_MANAGED_LOCAL_MODEL_ID = "drifty-qwen3-5-4b-default";
export const DEFAULT_DRIFTY_ROUTE: DriftyAiRoute = "cloud";
export const OPENROUTER_MAX_MODEL_IDS = 3;
export const OPENROUTER_PRIVACY_PROVIDER = {
  data_collection: "deny",
  zdr: true,
} as const;

export type OpenRouterModelBadge = "Default" | "ZDR" | "No ZDR";
export type OpenRouterModelMetadata = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly supportsZdr: boolean;
  readonly badges?: readonly OpenRouterModelBadge[];
};

export const DEFAULT_LOCAL_AI_SETUP: LocalAiSetupState = {
  provider: "managed_local",
  driftyRoute: DEFAULT_DRIFTY_ROUTE,
  managedLocalModelId: DEFAULT_MANAGED_LOCAL_MODEL_ID,
  managedLocalBaseUrl: "",
  managedLocalModel: "",
  openRouterApiKey: "",
  openRouterModel: "deepseek/deepseek-v4-flash",
  openRouterFallbackModels: [],
  openaiApiKey: "",
  openaiModel: DEFAULT_OPENAI_MODEL,
  anthropicApiKey: "",
  anthropicModel: DEFAULT_ANTHROPIC_MODEL,
  selfHostedBaseUrl: "http://localhost:11434/v1",
  selfHostedApiKey: "",
  selfHostedModel: "",
};

export const FORBIDDEN_OPENROUTER_MODEL_IDS = new Set(["openrouter/auto"]);

export const OPENROUTER_RECOMMENDED_MODELS = [
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", detail: "Default, fast paid route", supportsZdr: true, badges: ["Default", "ZDR"] },
  { id: "xiaomi/mimo-v2.5", label: "MiMo V2.5", detail: "Strict-ZDR MiMo route", supportsZdr: true, badges: ["ZDR"] },
  { id: "xiaomi/mimo-v2.5-pro", label: "MiMo V2.5 Pro", detail: "Strict-ZDR MiMo Pro route", supportsZdr: true, badges: ["ZDR"] },
  { id: "qwen/qwen3.6-35b-a3b", label: "Qwen 3.6 35B A3B", detail: "Efficient Qwen 3.6 MoE route", supportsZdr: true, badges: ["ZDR"] },
  { id: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B", detail: "Compact Qwen 3.6 route", supportsZdr: true, badges: ["ZDR"] },
  { id: "z-ai/glm-4.7-flash", label: "GLM 4.7 Flash", detail: "Strict-ZDR GLM route", supportsZdr: true, badges: ["ZDR"] },
  { id: "mistralai/mistral-small-2603", label: "Mistral Small 2603", detail: "Strict-ZDR Mistral route", supportsZdr: true, badges: ["ZDR"] },
] as const satisfies readonly OpenRouterModelMetadata[];

const OPENROUTER_KNOWN_NON_ZDR_MODELS = [
  { id: "qwen/qwen3.6-flash", label: "Qwen 3.6 Flash", detail: "Unavailable with strict privacy", supportsZdr: false, badges: ["No ZDR"] },
  { id: "qwen/qwen3.6-plus", label: "Qwen 3.6 Plus", detail: "Unavailable with strict privacy", supportsZdr: false, badges: ["No ZDR"] },
  { id: "qwen/qwen3.6-max-preview", label: "Qwen 3.6 Max Preview", detail: "Unavailable with strict privacy", supportsZdr: false, badges: ["No ZDR"] },
  { id: "deepseek/deepseek-v4-flash:free", label: "DeepSeek V4 Flash Free", detail: "Unavailable with strict privacy", supportsZdr: false, badges: ["No ZDR"] },
] as const satisfies readonly OpenRouterModelMetadata[];

const OPENROUTER_KNOWN_MODEL_METADATA = [
  ...OPENROUTER_RECOMMENDED_MODELS,
  ...OPENROUTER_KNOWN_NON_ZDR_MODELS,
] as const satisfies readonly OpenRouterModelMetadata[];

export function isForbiddenOpenRouterModel(model: string): boolean {
  return FORBIDDEN_OPENROUTER_MODEL_IDS.has(model.trim());
}

export function uniqueOpenRouterModels(models: readonly string[]): string[] {
  const seen = new Set<string>();
  return models.flatMap((model) => {
    const trimmedModel = model.trim();
    if (!trimmedModel || isForbiddenOpenRouterModel(trimmedModel) || seen.has(trimmedModel)) return [];
    seen.add(trimmedModel);
    return [trimmedModel];
  });
}

export function normalizeOpenRouterPrimaryModel(model: string): string {
  const trimmedModel = model.trim();
  if (!trimmedModel || isForbiddenOpenRouterModel(trimmedModel)) return DEFAULT_LOCAL_AI_SETUP.openRouterModel;
  return trimmedModel;
}

export function normalizeOpenRouterFallbackModels(primaryModel: string, fallbackModels: readonly string[]): string[] {
  const trimmedPrimaryModel = normalizeOpenRouterPrimaryModel(primaryModel);
  return uniqueOpenRouterModels(fallbackModels)
    .filter((model) => model !== trimmedPrimaryModel)
    .slice(0, OPENROUTER_MAX_MODEL_IDS - 1);
}

export function isRecommendedOpenRouterModel(model: string): boolean {
  return OPENROUTER_RECOMMENDED_MODELS.some((option) => option.id === model);
}

export function openRouterModelMetadata(model: string): OpenRouterModelMetadata | null {
  const trimmedModel = model.trim();
  return OPENROUTER_KNOWN_MODEL_METADATA.find((option) => option.id === trimmedModel) ?? null;
}

export function toPersistedLocalAiSetup(setup: LocalAiSetupState): PersistedLocalAiSetupState {
  const openRouterModel = normalizeOpenRouterPrimaryModel(setup.openRouterModel);
  return {
    provider: setup.provider,
    driftyRoute: parseDriftyAiRoute(setup.driftyRoute),
    managedLocalModelId: normalizeManagedLocalModelId(setup.managedLocalModelId),
    managedLocalBaseUrl: setup.managedLocalBaseUrl.trim(),
    managedLocalModel: setup.managedLocalModel.trim(),
    openRouterModel,
    openRouterFallbackModels: normalizeOpenRouterFallbackModels(openRouterModel, setup.openRouterFallbackModels),
    openaiModel: normalizeDirectProviderModel(setup.openaiModel, DEFAULT_OPENAI_MODEL),
    anthropicModel: normalizeDirectProviderModel(setup.anthropicModel, DEFAULT_ANTHROPIC_MODEL),
    selfHostedBaseUrl: setup.selfHostedBaseUrl.trim(),
    selfHostedModel: setup.selfHostedModel.trim(),
  };
}

export function resolveInitialLocalAiSetup(): LocalAiSetupState {
  if (typeof window === "undefined") return DEFAULT_LOCAL_AI_SETUP;
  try {
    const savedValue = window.localStorage.getItem(LOCAL_AI_SETUP_STORAGE_KEY);
    if (!savedValue) return DEFAULT_LOCAL_AI_SETUP;
    const parsedValue: unknown = JSON.parse(savedValue);
    if (!parsedValue || typeof parsedValue !== "object") return DEFAULT_LOCAL_AI_SETUP;
    const record = parsedValue as Record<string, unknown>;
    const provider = parseLocalAiProvider(record.provider);
    const legacyDriftyRoute = legacyDriftyRouteForPersistedSetup(provider, record);
    return {
      provider,
      driftyRoute: parseDriftyAiRoute(record.driftyRoute, legacyDriftyRoute),
      managedLocalModelId: normalizeManagedLocalModelId(typeof record.managedLocalModelId === "string" ? record.managedLocalModelId : ""),
      managedLocalBaseUrl: typeof record.managedLocalBaseUrl === "string" ? record.managedLocalBaseUrl.trim() : "",
      managedLocalModel: typeof record.managedLocalModel === "string" ? record.managedLocalModel.trim() : "",
      openRouterApiKey: "",
      openRouterModel: normalizeOpenRouterPrimaryModel(typeof record.openRouterModel === "string" ? record.openRouterModel : ""),
      openRouterFallbackModels: Array.isArray(record.openRouterFallbackModels) ? normalizeOpenRouterFallbackModels(
        typeof record.openRouterModel === "string" ? record.openRouterModel : "",
        record.openRouterFallbackModels.filter((model): model is string => typeof model === "string"),
      ) : [],
      openaiApiKey: "",
      openaiModel: normalizeDirectProviderModel(typeof record.openaiModel === "string" ? record.openaiModel : "", DEFAULT_OPENAI_MODEL),
      anthropicApiKey: "",
      anthropicModel: normalizeDirectProviderModel(typeof record.anthropicModel === "string" ? record.anthropicModel : "", DEFAULT_ANTHROPIC_MODEL),
      selfHostedBaseUrl: typeof record.selfHostedBaseUrl === "string" && record.selfHostedBaseUrl.trim() ? record.selfHostedBaseUrl : DEFAULT_LOCAL_AI_SETUP.selfHostedBaseUrl,
      selfHostedApiKey: "",
      selfHostedModel: typeof record.selfHostedModel === "string" ? record.selfHostedModel.trim() : "",
    };
  } catch {
    return DEFAULT_LOCAL_AI_SETUP;
  }
}

export function normalizeManagedLocalModelId(modelId: string): string {
  const trimmedModelId = modelId.trim();
  return trimmedModelId || DEFAULT_MANAGED_LOCAL_MODEL_ID;
}

export function isManagedLocalAiRoute(setup: LocalAiSetupState): boolean {
  return setup.provider === "managed_local" && setup.driftyRoute === "local";
}

export function normalizeOpenAiCompatibleBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return trimmed.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * A legacy Intelligence endpoint may seed the new shared connection only when
 * the Classification custom slot is still untouched. A user-entered URL is
 * meaningful even before they choose a model and must never be overwritten.
 */
export function shouldPreferLegacyAnalysisCustomConnection(
  setup: Pick<LocalAiSetupState, "selfHostedBaseUrl" | "selfHostedModel">,
): boolean {
  return (
    setup.selfHostedModel.trim().length === 0
    && normalizeOpenAiCompatibleBaseUrl(setup.selfHostedBaseUrl)
      === normalizeOpenAiCompatibleBaseUrl(DEFAULT_LOCAL_AI_SETUP.selfHostedBaseUrl)
  );
}

function parseLocalAiProvider(value: unknown): LocalAiProvider {
  switch (value) {
    case "managed_local":
    case "openrouter_byok":
    case "openai":
    case "anthropic":
    case "self_hosted":
    case "codex_cli":
    case "claude_cli":
      return value;
    default:
      return DEFAULT_LOCAL_AI_SETUP.provider;
  }
}

function parseDriftyAiRoute(value: unknown, fallbackRoute: DriftyAiRoute = DEFAULT_DRIFTY_ROUTE): DriftyAiRoute {
  switch (value) {
    case "cloud":
    case "local":
      return value;
    default:
      return fallbackRoute;
  }
}

function legacyDriftyRouteForPersistedSetup(provider: LocalAiProvider, record: Record<string, unknown>): DriftyAiRoute {
  if (provider !== "managed_local") return DEFAULT_DRIFTY_ROUTE;
  const managedLocalBaseUrl = typeof record.managedLocalBaseUrl === "string" ? record.managedLocalBaseUrl.trim() : "";
  const managedLocalModel = typeof record.managedLocalModel === "string" ? record.managedLocalModel.trim() : "";
  return managedLocalBaseUrl && managedLocalModel ? "local" : DEFAULT_DRIFTY_ROUTE;
}
