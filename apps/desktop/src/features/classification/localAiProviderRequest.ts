import {
  OPENROUTER_PRIVACY_PROVIDER,
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
} from "../settings/localAiSetup";
import type { EnhancedContextProviderPayload } from "./contentContextEgressPolicy";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
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

export type LocalAiProviderEnhancedRetryRequestInput = {
  readonly provider: LocalAiProviderConfig;
  readonly payload: readonly MinimizedActivityPayload[];
  readonly workProfile: string | null;
  readonly enhancedRetryContext: EnhancedContextProviderPayload;
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
  return buildLocalProviderRequest({ provider, payload, workProfile, enhancedRetryContext: null });
}

export function toLocalProviderEnhancedRetryRequest(
  input: LocalAiProviderEnhancedRetryRequestInput,
): LocalAiProviderRequest | null {
  return buildLocalProviderRequest(input);
}

function buildLocalProviderRequest(input: {
  readonly provider: LocalAiProviderConfig;
  readonly payload: readonly MinimizedActivityPayload[];
  readonly workProfile: string | null;
  readonly enhancedRetryContext: EnhancedContextProviderPayload | null;
}): LocalAiProviderRequest | null {
  const provider = input.provider;
  switch (provider.provider) {
    case "managed_local":
      return openAiCompatibleProviderRequest(
        {
          baseUrl: provider.baseUrl,
          model: provider.model,
          payload: input.payload,
          workProfile: input.workProfile,
          enhancedRetryContext: input.enhancedRetryContext,
        },
        managedLocalRuntimeRequestOptions(
          MANAGED_LOCAL_AI_CLASSIFICATION_MAX_TOKENS,
          MANAGED_LOCAL_AI_CLASSIFICATION_TIMEOUT_MS,
        ),
      );
    case "self_hosted":
      return openAiCompatibleProviderRequest({
        baseUrl: provider.baseUrl,
        model: provider.model,
        payload: input.payload,
        workProfile: input.workProfile,
        enhancedRetryContext: input.enhancedRetryContext,
      });
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
          messages: [{
            role: "user",
            content: buildClassificationPrompt(input.payload, input.workProfile, input.enhancedRetryContext),
          }],
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
  input: {
    readonly baseUrl: string;
    readonly model: string;
    readonly payload: readonly MinimizedActivityPayload[];
    readonly workProfile: string | null;
    readonly enhancedRetryContext: EnhancedContextProviderPayload | null;
  },
  options: OpenAiCompatibleRequestOptions = {},
): LocalAiProviderRequest | null {
  const baseUrl = input.baseUrl.trim();
  const model = input.model.trim();
  if (!baseUrl || !model) return null;
  return {
    model,
    request: {
      baseUrl,
      model,
      ...options,
      messages: [{
        role: "user",
        content: buildClassificationPrompt(input.payload, input.workProfile, input.enhancedRetryContext),
      }],
    },
  };
}

function normalizeOpenRouterModels(primaryModel: string, fallbackModels: readonly string[] | undefined): string[] {
  const model = normalizeOpenRouterPrimaryModel(primaryModel);
  return [model, ...normalizeOpenRouterFallbackModels(model, fallbackModels ?? [])];
}

function buildClassificationPrompt(
  payload: readonly MinimizedActivityPayload[],
  workProfile: string | null,
  enhancedRetryContext: EnhancedContextProviderPayload | null,
): string {
  return [
    "Classify each activity into activity category, productivity label, confidence, and short reason.",
    ...(workProfile
      ? [
          `User work profile: ${workProfile}.`,
          "Use the user's work profile as context when deciding whether an activity is work-related.",
        ]
      : []),
    primaryEvidenceGuidance(payload),
    ...enhancedRetryGuidance(enhancedRetryContext),
    ...redditPromptGuidance(payload),
    "Use only these categories: workspace, learning, communication, music, game, social_media, entertainment, shopping, utility, unknown.",
    "Use only these productivity labels: focus, neutral, drift.",
    "Use neutral only for genuinely in-between activities, such as background music while working or brief communication with unclear purpose. Do not use neutral as an uncertainty fallback: if your reason says the activity is professional or work-related, the label must be focus, even for supporting tools, consoles, account setup, or work-relevant research. If the evidence is insufficient to decide, use category unknown with confidence 0.5 or lower instead of guessing.",
    "Return JSON only in the shape {\"results\":[{\"id\":string,\"category\":string,\"productivity\":string,\"confidence\":number,\"reason\":string}]}. Do not include raw titles, domains, or work profile details in the reason.",
    JSON.stringify(payload.map((item) => promptItem(item, enhancedRetryContext))),
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

function enhancedRetryGuidance(enhancedRetryContext: EnhancedContextProviderPayload | null): readonly string[] {
  if (!enhancedRetryContext) return [];
  return [
    "Enhanced retry context is provider-safe derived context supplied only because the first pass had insufficient evidence. Use it as secondary evidence and do not quote it in the reason.",
  ];
}

function promptItem(
  item: MinimizedActivityPayload,
  enhancedRetryContext: EnhancedContextProviderPayload | null,
): Record<string, unknown> {
  const title = item.siteTitle ?? item.youtubeTitle;
  const enhancedContext = enhancedRetryContext?.segmentId === item.segmentId
    ? enhancedPromptItems(enhancedRetryContext)
    : null;
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
    ...(enhancedContext ? { enhancedContext } : {}),
    durationSeconds: item.durationSeconds,
  };
}

function enhancedPromptItems(
  enhancedRetryContext: EnhancedContextProviderPayload,
): readonly Record<string, unknown>[] {
  return enhancedRetryContext.items.map((item) => ({
    sourceFamily: item.sourceFamily,
    depth: item.depth,
    kind: item.kind,
    decision: item.decision,
    values: item.values,
  }));
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
