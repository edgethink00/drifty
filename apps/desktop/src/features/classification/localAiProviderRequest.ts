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

// v7 prompt (definitions + coupling anchors). MUST stay byte-identical to
// packages/domain/src/liveClassificationPrompt.ts buildLiveClassificationPrompt
// with { includeDefinitions: true, couplingAnchors: "workspace-game" }, minus the
// local-only enhancedRetry guidance. liveClassificationPromptParity.test.ts pins this.
const CATEGORY_DEFINITIONS = [
  "Category definitions:",
  "- workspace: doing work in professional, dev, or business tools/sites (editors, terminals, analytics, ads, dashboards, business apps, code hosting, deploy, cloud consoles).",
  "- learning: seeking or reading information — web search, docs, tutorials, technical articles, AI-assistant chats, reference reading.",
  "- communication: messaging, email, chat, or meetings (Slack, Discord, email, Zoom/Meet), whatever the topic.",
  "- music: listening to or managing music.",
  "- game: playing a game.",
  "- social_media: browsing personal social feeds, posts, or profiles.",
  "- entertainment: watching videos/streams or other leisure media.",
  "- shopping: browsing or buying products (product pages, marketplaces, carts).",
  "- utility: personal admin and system tasks — settings, cloud storage, app stores, sign-in, account/service/booking management (including travel booking management), finance/quote lookups, maps.",
  "- unknown: not enough evidence to tell.",
].join("\n");

const PRODUCTIVITY_DEFINITIONS = [
  "Productivity definitions:",
  "- focus: on-task work, work-adjacent activity that supports it (work tools, work-related search/reading/AI-chat/tutorials, account or business setup), and work communication (work chat channels, team servers, work meetings). Use the work profile to judge relevance.",
  "- neutral: supporting or in-between activity that is neither deep work nor a distraction — personal communication (friends, personal DMs), background music, purposeful personal admin (settings, cloud storage, app store, account/service/booking management, finance quotes), personal informational reading (personal finance or news, general non-work research), and work-relevant discussion read on a social platform.",
  "- drift: off-task personal leisure — personal social feeds and posts, entertainment video/streams, games, product shopping, and idle browsing.",
  "- When evidence is insufficient, use category unknown with productivity neutral and confidence 0.5 or lower. Never label an activity drift just because you cannot tell what it is.",
].join("\n");

const COUPLING_ANCHORS_LINE =
  "Category productivity anchors: workspace is always focus; game is always drift. For every other category (including learning), judge productivity from the evidence.";

// Exported for liveClassificationPromptParity.test.ts, which pins this inline
// copy to packages/domain's canonical builder so the two can't drift.
export function buildClassificationPrompt(
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
    CATEGORY_DEFINITIONS,
    PRODUCTIVITY_DEFINITIONS,
    COUPLING_ANCHORS_LINE,
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
