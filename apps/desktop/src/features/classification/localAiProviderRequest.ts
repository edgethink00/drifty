const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
const FORBIDDEN_OPENROUTER_MODEL_IDS = new Set(["openrouter/auto"]);
const OPENROUTER_PRIVACY_PROVIDER = {
  data_collection: "deny",
  zdr: true,
} as const;
export const MANAGED_LOCAL_AI_CLASSIFICATION_MAX_TOKENS = 4096;
export const MANAGED_LOCAL_AI_CLASSIFICATION_TIMEOUT_MS = 180_000;
export const MANAGED_LOCAL_AI_CONNECTION_TEST_MAX_TOKENS = 64;

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
  readonly siteUrl: string | null;
  readonly siteTitle: string | null;
  readonly windowTitle: string | null;
  readonly youtubeTitle: string | null;
  readonly youtubeChannelName: string | null;
  readonly youtubeCategory: string | null;
  readonly youtubeIsShorts: boolean | null;
  readonly redditCommunity?: string;
};

export type LocalAiProviderConfig =
  | { readonly provider: "managed_local"; readonly baseUrl: string; readonly model: string; readonly modelId: string }
  | { readonly provider: "openrouter_byok"; readonly apiKey: string; readonly model: string; readonly fallbackModels?: readonly string[] }
  | { readonly provider: "self_hosted"; readonly baseUrl: string; readonly model: string };

export type LocalAiProviderRequest = {
  readonly model: string;
  readonly request: Record<string, unknown>;
};

type OpenAiCompatibleRequestOptions = {
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly reasoningFormat?: "none";
  readonly chatTemplateKwargs?: {
    readonly enable_thinking: false;
  };
};

export function toLocalProviderRequest(
  provider: LocalAiProviderConfig,
  payload: readonly MinimizedActivityPayload[],
  workProfile: string | null,
): LocalAiProviderRequest | null {
  switch (provider.provider) {
    case "managed_local":
      return openAiCompatibleProviderRequest(
        provider.baseUrl,
        provider.model,
        payload,
        workProfile,
        managedLocalRuntimeRequestOptions(
          MANAGED_LOCAL_AI_CLASSIFICATION_MAX_TOKENS,
          MANAGED_LOCAL_AI_CLASSIFICATION_TIMEOUT_MS,
        ),
      );
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
          provider: OPENROUTER_PRIVACY_PROVIDER,
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

export function managedLocalRuntimeRequestOptions(maxTokens: number, timeoutMs?: number): OpenAiCompatibleRequestOptions {
  return {
    maxTokens,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    reasoningFormat: "none",
    chatTemplateKwargs: { enable_thinking: false },
  };
}

function openAiCompatibleProviderRequest(
  baseUrlValue: string,
  modelValue: string,
  payload: readonly MinimizedActivityPayload[],
  workProfile: string | null,
  options: OpenAiCompatibleRequestOptions = {},
): LocalAiProviderRequest | null {
  const baseUrl = baseUrlValue.trim();
  const model = modelValue.trim();
  if (!baseUrl || !model) return null;
  return {
    model,
    request: {
      baseUrl,
      model,
      ...options,
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
    primaryEvidenceGuidance(payload),
    ...redditPromptGuidance(payload),
    "Use only these categories: workspace, learning, communication, music, game, social_media, entertainment, shopping, utility, unknown.",
    "Use only these productivity labels: focus, neutral, drift.",
    "Return JSON only in the shape {\"results\":[{\"id\":string,\"category\":string,\"productivity\":string,\"confidence\":number,\"reason\":string}]}. Do not include raw titles, domains, or work profile details in the reason.",
    JSON.stringify(payload.map(promptItem)),
  ].join("\n");
}

function primaryEvidenceGuidance(payload: readonly MinimizedActivityPayload[]): string {
  const hasYouTubeContext = payload.some((item) => item.youtubeChannelName || item.youtubeCategory);
  const contentEvidence = hasYouTubeContext
    ? "page/video title, YouTube channel name, YouTube video category"
    : "page title";
  return `Use the observed app, site, optional URL path, window title, ${contentEvidence}, and duration as the primary evidence.`;
}

function redditPromptGuidance(payload: readonly MinimizedActivityPayload[]): readonly string[] {
  if (!payload.some((item) => item.redditCommunity)) return [];
  return [
    "Reddit-specific guidance: apply only to items with redditCommunity. Do not classify Reddit as social_media from the domain alone; prioritize the community, title, optional URL path, and apparent task intent.",
    "For Reddit items, use social_media only for casual feeds, memes, personal updates, or general scrolling. Work, tool, study, or product-research communities may be workspace, learning, utility, neutral, or unknown.",
  ];
}

function promptItem(item: MinimizedActivityPayload): Record<string, unknown> {
  const title = item.siteTitle ?? item.youtubeTitle;
  return {
    id: item.segmentId,
    appName: item.appName,
    domain: item.siteDomain,
    urlHost: item.siteDomain,
    ...(item.siteUrl ? { siteUrl: item.siteUrl } : {}),
    ...(item.windowTitle ? { windowTitle: item.windowTitle } : {}),
    ...(title ? { title } : {}),
    ...(item.youtubeChannelName ? { youtubeChannelName: item.youtubeChannelName } : {}),
    ...(item.youtubeCategory ? { youtubeCategory: item.youtubeCategory } : {}),
    ...(item.redditCommunity ? { redditCommunity: item.redditCommunity } : {}),
    durationSeconds: item.durationSeconds,
  };
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
