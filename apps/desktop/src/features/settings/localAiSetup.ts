export type LocalAiProvider = "managed_local" | "openrouter_byok" | "self_hosted";
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
  selfHostedBaseUrl: string;
  selfHostedModel: string;
};

export type PersistedLocalAiSetupState = Omit<LocalAiSetupState, "openRouterApiKey">;

export const LOCAL_AI_SETUP_STORAGE_KEY = "drifty.aiSetup.v1";
export const DEFAULT_MANAGED_LOCAL_MODEL_ID = "drifty-qwen3-5-4b-default";
export const DEFAULT_DRIFTY_ROUTE: DriftyAiRoute = "cloud";

export const DEFAULT_LOCAL_AI_SETUP: LocalAiSetupState = {
  provider: "managed_local",
  driftyRoute: DEFAULT_DRIFTY_ROUTE,
  managedLocalModelId: DEFAULT_MANAGED_LOCAL_MODEL_ID,
  managedLocalBaseUrl: "",
  managedLocalModel: "",
  openRouterApiKey: "",
  openRouterModel: "deepseek/deepseek-v4-flash",
  openRouterFallbackModels: [],
  selfHostedBaseUrl: "http://localhost:11434/v1",
  selfHostedModel: "",
};

export const FORBIDDEN_OPENROUTER_MODEL_IDS = new Set(["openrouter/auto"]);

export const OPENROUTER_RECOMMENDED_MODELS = [
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", detail: "Default, fast paid route", badge: "Default" },
  { id: "qwen/qwen3.6-flash", label: "Qwen 3.6 Flash", detail: "Fast Qwen 3.6 route" },
  { id: "qwen/qwen3.6-plus", label: "Qwen 3.6 Plus", detail: "Balanced Qwen 3.6 route" },
  { id: "qwen/qwen3.6-max-preview", label: "Qwen 3.6 Max Preview", detail: "Highest-capacity Qwen 3.6 preview" },
  { id: "qwen/qwen3.6-35b-a3b", label: "Qwen 3.6 35B A3B", detail: "Efficient Qwen 3.6 MoE route" },
  { id: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B", detail: "Compact Qwen 3.6 route" },
  { id: "deepseek/deepseek-v4-flash:free", label: "DeepSeek V4 Flash Free", detail: "Free route when available" },
] as const;

export function isForbiddenOpenRouterModel(model: string): boolean {
  return FORBIDDEN_OPENROUTER_MODEL_IDS.has(model.trim());
}

export function uniqueOpenRouterModels(models: string[]): string[] {
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

export function normalizeOpenRouterFallbackModels(primaryModel: string, fallbackModels: string[]): string[] {
  const trimmedPrimaryModel = normalizeOpenRouterPrimaryModel(primaryModel);
  return uniqueOpenRouterModels(fallbackModels).filter((model) => model !== trimmedPrimaryModel);
}

export function isRecommendedOpenRouterModel(model: string): boolean {
  return OPENROUTER_RECOMMENDED_MODELS.some((option) => option.id === model);
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
    selfHostedBaseUrl: setup.selfHostedBaseUrl,
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
      selfHostedBaseUrl: typeof record.selfHostedBaseUrl === "string" && record.selfHostedBaseUrl.trim() ? record.selfHostedBaseUrl : DEFAULT_LOCAL_AI_SETUP.selfHostedBaseUrl,
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

function parseLocalAiProvider(value: unknown): LocalAiProvider {
  switch (value) {
    case "managed_local":
    case "openrouter_byok":
    case "self_hosted":
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
