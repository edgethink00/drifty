const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
const FORBIDDEN_OPENROUTER_MODEL_IDS = new Set(["openrouter/auto"]);

export type MinimizedActivityPayload = {
  readonly segmentId: string;
  readonly inputFingerprint: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly appName: string;
  readonly bundleId: string | null;
  readonly browserName: string | null;
  readonly siteDomain: string | null;
  readonly siteTitle: string | null;
  readonly windowTitle: string | null;
  readonly youtubeTitle: string | null;
  readonly youtubeChannelName: string | null;
  readonly youtubeCategory: string | null;
  readonly youtubeIsShorts: boolean | null;
};

export type LocalAiProviderConfig =
  | { readonly provider: "managed_local"; readonly baseUrl: string; readonly model: string; readonly modelId: string }
  | { readonly provider: "openrouter_byok"; readonly apiKey: string; readonly model: string; readonly fallbackModels?: readonly string[] }
  | { readonly provider: "self_hosted"; readonly baseUrl: string; readonly model: string };

export type LocalAiProviderRequest = {
  readonly model: string;
  readonly request: Record<string, unknown>;
};

export function toLocalProviderRequest(
  provider: LocalAiProviderConfig,
  payload: readonly MinimizedActivityPayload[],
  workProfile: string | null,
): LocalAiProviderRequest | null {
  switch (provider.provider) {
    case "managed_local":
    case "self_hosted":
      return openAiCompatibleProviderRequest(provider.baseUrl, provider.model, payload, workProfile);
    case "openrouter_byok": {
      const apiKey = provider.apiKey.trim();
      const models = normalizeOpenRouterModels(provider.model, provider.fallbackModels);
      const model = models[0];
      if (!apiKey || !model) return null;
      const modelRequestShape = models.length === 1 ? { model } : { models };
      return {
        model,
        request: {
          baseUrl: OPENROUTER_BASE_URL,
          apiKey,
          ...modelRequestShape,
          headers: {
            "HTTP-Referer": "https://drifty.so",
            "X-OpenRouter-Title": "Drifty",
          },
          messages: [{ role: "user", content: buildClassificationPrompt(payload, workProfile) }],
        },
      };
    }
    default:
      return assertNever(provider);
  }
}

function openAiCompatibleProviderRequest(
  baseUrlValue: string,
  modelValue: string,
  payload: readonly MinimizedActivityPayload[],
  workProfile: string | null,
): LocalAiProviderRequest | null {
  const baseUrl = baseUrlValue.trim();
  const model = modelValue.trim();
  if (!baseUrl || !model) return null;
  return {
    model,
    request: {
      baseUrl,
      model,
      messages: [{ role: "user", content: buildClassificationPrompt(payload, workProfile) }],
    },
  };
}

function normalizeOpenRouterModels(primaryModel: string, fallbackModels: readonly string[] | undefined): string[] {
  const models = [normalizeOpenRouterPrimaryModel(primaryModel), ...(fallbackModels ?? [])];
  const seen = new Set<string>();
  return models.flatMap((model) => {
    const trimmed = model.trim();
    if (!trimmed || FORBIDDEN_OPENROUTER_MODEL_IDS.has(trimmed) || seen.has(trimmed)) return [];
    seen.add(trimmed);
    return [trimmed];
  });
}

function normalizeOpenRouterPrimaryModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed || FORBIDDEN_OPENROUTER_MODEL_IDS.has(trimmed)) return DEFAULT_OPENROUTER_MODEL;
  return trimmed;
}

function buildClassificationPrompt(payload: readonly MinimizedActivityPayload[], workProfile: string | null): string {
  return [
    "Classify each activity into activity category, productivity label, confidence, and short reason.",
    ...(workProfile
      ? [
          `User work profile: ${workProfile}.`,
          "Use the user's work profile as context when deciding whether an activity is work-related.",
        ]
      : []),
    "Use the observed app, site, window title, page title, and duration as the primary evidence.",
    "Use only these categories: workspace, learning, communication, music, game, social_media, entertainment, shopping, utility, unknown.",
    "Use only these productivity labels: focus, neutral, drift.",
    "Return JSON only in the shape {\"results\":[{\"id\":string,\"category\":string,\"productivity\":string,\"confidence\":number,\"reason\":string}]}. Do not include raw titles, domains, or work profile details in the reason.",
    JSON.stringify(payload.map((item) => ({
      id: item.segmentId,
      appName: item.appName,
      domain: item.siteDomain,
      urlHost: item.siteDomain,
      windowTitle: item.windowTitle,
      title: item.siteTitle ?? item.youtubeTitle,
      durationSeconds: item.durationSeconds,
    }))),
  ].join("\n");
}

class LocalAiProviderRequestError extends Error {
  constructor(readonly provider: string) {
    super(`Unhandled local AI provider: ${provider}`);
    this.name = "LocalAiProviderRequestError";
  }
}

function assertNever(value: never): never {
  throw new LocalAiProviderRequestError(String(value));
}
