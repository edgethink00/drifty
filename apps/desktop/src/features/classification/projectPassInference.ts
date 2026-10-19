import { invoke } from "@tauri-apps/api/core";
import { modelRejectsTemperature, openAiCompatibleParameterFlags } from "./modelParameterSupport";
import type { ProjectPassAnalysisWindow, ProjectPassPromptInput } from "@drifty/domain";
import {
  OPENROUTER_PRIVACY_PROVIDER,
  normalizeOpenAiCompatibleBaseUrl,
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
} from "../settings/localAiSetup";
import type { AnalysisAiSetupState } from "../settings/analysisModelSetup";
import { supabase } from "../../lib/supabase/client";
import type { NativeOpenAiChatResponse } from "./managedLocalAiChat";
import { parseProjectPassOutput, type ProjectPassInference, type ProjectPassOutput } from "./aiProjectReviewService";
import { dispatchAnalysisChat, type AnalysisChatProtocol, type AnalysisChatResult } from "./projectPassChatResponse";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
// OpenAI's public API is OpenAI-compatible, so it rides the shared chat path.
const OPENAI_BASE_URL = "https://api.openai.com/v1";
// Output must hold one assignment + optional correction per run in the chunk;
// a chunk of ~80 runs needs several thousand tokens, so keep this generous.
const PROJECT_PASS_MAX_TOKENS = 8192;
// Heavy-pass chunks can run for minutes on reasoning models — well past the
// native command's 60s default — so every provider request pins its own budget.
// Kept slightly above the Supabase edge wall-clock limit so cloud failures
// surface the server's error instead of a client-side abort.
const PROJECT_PASS_TIMEOUT_MS = 180_000;
const REVIEW_EDGE_FUNCTION = "review-activity";

export interface ProjectPassCloudResponse {
  readonly content: string;
  readonly model?: string | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
  readonly latencyMs?: number | null;
}

export interface ProjectPassInferenceDeps {
  readonly isRequestCurrent?: () => boolean;
  readonly expectedCloudUserId?: string | null;
  /** The setup was already resolved to Cloud because the preference is unavailable. */
  readonly cloudRecovery?: boolean;
  readonly canFallbackToCloud?: () => boolean;
  readonly onProviderUnavailable?: (reason: import("../settings/intelligenceRouting").AnalysisUnavailableReason) => void;
  readonly invokeChat?: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>;
  /** Anthropic's Messages API is not OpenAI-shaped, so it has its own native command. */
  readonly invokeAnthropicChat?: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>;
  readonly invokeCloud?: (prompt: string) => Promise<ProjectPassCloudResponse>;
}

function openRouterModels(setup: AnalysisAiSetupState): string[] {
  const primary = normalizeOpenRouterPrimaryModel(setup.openRouterModel);
  return [primary, ...normalizeOpenRouterFallbackModels(primary, setup.openRouterFallbackModels)];
}

/**
 * Per-feature request budget and answer format for an analysis-model call.
 * I is the structured input Drifty Cloud builds the prompt from.
 */
export interface AnalysisInferenceProtocol<T, I = ProjectPassPromptInput> extends AnalysisChatProtocol<T> {
  readonly maxTokens: number;
  readonly timeoutMs: number;
  /** Body for the Drifty Cloud review endpoint; a bare prompt is its legacy passthrough. */
  readonly cloudContent: (prompt: string, promptInput?: I) => string;
  /** False when a generic repair would lose the Cloud request type and its evidence. */
  readonly cloudJsonRepair?: boolean;
}

export type AnalysisTextInference<T, I = ProjectPassPromptInput> = (prompt: string, promptInput?: I) => Promise<AnalysisChatResult<T>>;

interface RequestBudget {
  readonly maxTokens: number;
  readonly timeoutMs: number;
}

const PROJECT_PASS_BUDGET: RequestBudget = { maxTokens: PROJECT_PASS_MAX_TOKENS, timeoutMs: PROJECT_PASS_TIMEOUT_MS };

function buildOpenAiCompatibleRequest(baseUrl: string, apiKey: string | null, models: string[], prompt: string, privacy: boolean, budget: RequestBudget = PROJECT_PASS_BUDGET): Record<string, unknown> {
  const modelShape = models.length === 1 ? { model: models[0] } : { models };
  // `privacy` marks the OpenRouter route; direct OpenAI and custom endpoints
  // also need the reasoning-model token-limit field.
  const parameterFlags = openAiCompatibleParameterFlags(models, { viaOpenRouter: privacy });
  return {
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...modelShape,
    ...(privacy ? { provider: OPENROUTER_PRIVACY_PROVIDER, headers: { "HTTP-Referer": "https://drifty.so", "X-OpenRouter-Title": "Drifty" } } : {}),
    messages: [{ role: "user", content: prompt }],
    maxTokens: budget.maxTokens,
    ...(parameterFlags.omitTemperature ? parameterFlags : { ...parameterFlags, temperature: 0 }),
    timeoutMs: budget.timeoutMs,
  };
}

function buildAnthropicRequest(apiKey: string, model: string, prompt: string, budget: RequestBudget = PROJECT_PASS_BUDGET): Record<string, unknown> {
  return {
    apiKey,
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: budget.maxTokens,
    // Claude 5-generation models reject temperature on the Messages API.
    ...(modelRejectsTemperature(model) ? {} : { temperature: 0 }),
    timeoutMs: budget.timeoutMs,
  };
}

function buildCloudReviewRequest(supabaseUrl: string, accessToken: string, anonKey: string, content: string, budget: RequestBudget = PROJECT_PASS_BUDGET): Record<string, unknown> {
  return {
    baseUrl: `${supabaseUrl}/functions/v1/${REVIEW_EDGE_FUNCTION}`,
    apiKey: accessToken,
    model: "drifty-cloud",
    messages: [{ role: "user", content }],
    maxTokens: budget.maxTokens,
    temperature: 0,
    timeoutMs: budget.timeoutMs,
    headers: { apikey: anonKey },
  };
}

// Protocol sentinel — must match REVIEW_CHUNK_SENTINEL in the edge
// (supabase/functions/review-activity/reviewChunk.ts). The Drifty Cloud path
// sends the STRUCTURED chunk and the edge builds the prompt server-side + captures
// a minimized sample (Option D). Only fields the prompt/capture use are sent — no
// segment ids, overlaps, or classification maps — so egress stays minimal.
const REVIEW_CHUNK_SENTINEL = "driftyReviewChunk";

function minimalReviewWindow(window: ProjectPassAnalysisWindow): Record<string, unknown> {
  const legacyContext = (contexts: ProjectPassAnalysisWindow["contributors"][number]["contexts"]): string | null => {
    const formatted = contexts.map((context) => [
      context.siteUrl ? `url=${JSON.stringify(context.siteUrl)}` : null,
      context.windowTitle ? `window=${JSON.stringify(context.windowTitle)}` : null,
      context.title ? `title=${JSON.stringify(context.title)}` : null,
      context.redditCommunity ? `reddit=${JSON.stringify(context.redditCommunity)}` : null,
      context.youtubeChannelName ? `channel=${JSON.stringify(context.youtubeChannelName)}` : null,
      context.youtubeCategory ? `videoCategory=${JSON.stringify(context.youtubeCategory)}` : null,
    ].filter(Boolean).join(" ")).filter(Boolean);
    return formatted.length > 0 ? formatted.join("; ") : null;
  };
  return {
    id: window.id,
    startedAt: window.startedAt,
    endedAt: window.endedAt,
    durationSeconds: window.durationSeconds,
    intervalMinutes: window.intervalMinutes,
    bucketCount: window.bucketCount,
    isShorts: window.isShorts,
    category: window.category,
    productivity: window.productivity,
    source: window.source,
    // Only the top-3 contributors — exactly what the server-built prompt renders
    // (dominant + two secondary via formatProjectPassAnalysisWindowLine). Sending
    // all contributors would egress minor apps/domains the prompt never carried.
    contributors: window.contributors.slice(0, 3).map((contributor) => ({
      appName: contributor.appName,
      domain: contributor.domain,
      durationSeconds: contributor.durationSeconds,
      // Keep the legacy string during the app/edge rollout so the previous edge
      // can still use title context; the structured form is canonical for v4.
      context: legacyContext(contributor.contexts),
      contexts: contributor.contexts,
      isShorts: contributor.isShorts,
    })),
  };
}

export function buildReviewChunkContent(input: ProjectPassPromptInput): string {
  return JSON.stringify({
    [REVIEW_CHUNK_SENTINEL]: {
      beforeContextWindows: input.beforeContextWindows.map(minimalReviewWindow),
      coreWindows: input.coreWindows.map(minimalReviewWindow),
      afterContextWindows: input.afterContextWindows.map(minimalReviewWindow),
      workProfile: input.workProfile,
      projects: input.projects,
    },
  });
}

function cloudResultFromInjected<T>(result: ProjectPassCloudResponse, protocol: AnalysisChatProtocol<T>): AnalysisChatResult<T> {
  return {
    output: protocol.parse(result.content),
    usage: {
      model: result.model ?? null,
      provider: "cloud",
      tokensIn: result.tokensIn ?? null,
      tokensOut: result.tokensOut ?? null,
      latencyMs: result.latencyMs ?? null,
    },
  };
}

function cloudHttpError(status: number, detail: string): Error {
  return new Error(`Drifty Cloud analysis failed (HTTP ${status})${detail ? `: ${detail}` : ""}`);
}

/**
 * Build a provider-bound ProjectPassInference from the analysis slot config.
 * Secrets (keys) must already be resolved onto `setup` by the caller (Keychain).
 */
function createProviderAnalysisInference<T, I>(
  setup: AnalysisAiSetupState,
  deps: ProjectPassInferenceDeps,
  cloudRecovery: boolean,
  protocol: AnalysisInferenceProtocol<T, I>,
): AnalysisTextInference<T, I> {
  const assertCurrent = () => {
    if ((deps.isRequestCurrent && !deps.isRequestCurrent()) || (cloudRecovery && !deps.canFallbackToCloud?.())) {
      throw new Error("Intelligence settings changed during analysis.");
    }
  };
  const chat = deps.invokeChat ?? ((request) => invoke<NativeOpenAiChatResponse>("ai_classification_openai_chat", { request }));
  const anthropicChat =
    deps.invokeAnthropicChat ?? ((request) => invoke<NativeOpenAiChatResponse>("ai_classification_anthropic_chat", { request }));
  const invokeChat = (request: Record<string, unknown>) => { assertCurrent(); return chat(request); };
  const invokeAnthropicChat = (request: Record<string, unknown>) => { assertCurrent(); return anthropicChat(request); };

  const budget: RequestBudget = { maxTokens: protocol.maxTokens, timeoutMs: protocol.timeoutMs };
  return async (prompt: string, promptInput?: I): Promise<AnalysisChatResult<T>> => {
    assertCurrent();
    if (setup.provider === "cloud") {
      if (deps.invokeCloud) {
        const result = await deps.invokeCloud(prompt);
        return cloudResultFromInjected(result, protocol);
      }
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data } = await supabase.auth.getSession();
      assertCurrent();
      // Auth state can change before React publishes the new account. Never
      // attach the old owner's captured inputs to a newly returned session.
      if (deps.expectedCloudUserId !== undefined && data.session?.user.id !== deps.expectedCloudUserId) {
        throw new Error("Intelligence settings changed during analysis.");
      }
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Sign in to use Drifty Cloud analysis.");
      // WKWebView fetch aborts long response-less waits (the LLM streams nothing
      // until it finishes), so the cloud call rides the same native Rust HTTP
      // command as every other provider. The edge builds the prompt server-side
      // from the structured chunk (Option D) and returns the OpenAI chat shape.
      const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
      const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "");
      // Structured chunk when available (Option D); a bare prompt still works as
      // a legacy passthrough for any caller that does not thread the structure.
      const cloudContent = protocol.cloudContent(prompt, promptInput);
      return dispatchAnalysisChat(invokeChat, {
        request: buildCloudReviewRequest(supabaseUrl, accessToken, anonKey, cloudContent, budget),
        fallbackModel: "drifty-cloud",
        provider: "cloud",
        shape: "openai",
        throwHttpError: cloudHttpError,
        jsonRepair: protocol.cloudJsonRepair,
      }, protocol);
    }
    if (setup.provider === "openrouter") {
      const models = openRouterModels(setup);
      const primaryModel = models[0];
      if (!setup.openRouterApiKey.trim() || !primaryModel) return { output: null, usage: { provider: "openrouter" } };
      return dispatchAnalysisChat(invokeChat, {
        request: buildOpenAiCompatibleRequest(OPENROUTER_BASE_URL, setup.openRouterApiKey.trim(), models, prompt, true, budget),
        fallbackModel: primaryModel,
        provider: "openrouter",
        shape: "openai",
      }, protocol);
    }
    if (setup.provider === "openai") {
      const apiKey = setup.openaiApiKey.trim();
      const model = setup.openaiModel.trim();
      if (!apiKey || !model) return { output: null, usage: { provider: "openai" } };
      return dispatchAnalysisChat(invokeChat, {
        request: buildOpenAiCompatibleRequest(OPENAI_BASE_URL, apiKey, [model], prompt, false, budget),
        fallbackModel: model,
        provider: "openai",
        shape: "openai",
      }, protocol);
    }
    if (setup.provider === "anthropic") {
      const apiKey = setup.anthropicApiKey.trim();
      const model = setup.anthropicModel.trim();
      if (!apiKey || !model) return { output: null, usage: { provider: "anthropic" } };
      return dispatchAnalysisChat(invokeAnthropicChat, {
        request: buildAnthropicRequest(apiKey, model, prompt, budget),
        fallbackModel: model,
        provider: "anthropic",
        shape: "anthropic",
      }, protocol);
    }
    const baseUrl = normalizeOpenAiCompatibleBaseUrl(setup.selfHostedBaseUrl);
    const model = setup.selfHostedModel.trim();
    if (!baseUrl || !model) return { output: null, usage: { provider: "self_hosted" } };
    return dispatchAnalysisChat(invokeChat, {
      request: buildOpenAiCompatibleRequest(baseUrl, setup.selfHostedApiKey.trim() || null, [model], prompt, false, budget),
      fallbackModel: model,
      provider: "self_hosted",
      shape: "openai",
    }, protocol);
  };
}

const PROJECT_PASS_INFERENCE_PROTOCOL: AnalysisInferenceProtocol<ProjectPassOutput> = {
  parse: (content) => parseProjectPassOutput(content),
  repairInstruction: 'The previous response was not valid JSON. Return only a valid JSON object with top-level arrays "assignments" and "corrections". Do not include markdown, code fences, comments, or explanations.',
  maxTokens: PROJECT_PASS_MAX_TOKENS,
  timeoutMs: PROJECT_PASS_TIMEOUT_MS,
  cloudContent: (prompt, promptInput) => (promptInput ? buildReviewChunkContent(promptInput) : prompt),
};


export function createProjectPassInference(setup: AnalysisAiSetupState, deps: ProjectPassInferenceDeps = {}): ProjectPassInference {
  return createAnalysisTextInference(setup, deps, PROJECT_PASS_INFERENCE_PROTOCOL);
}

/**
 * Analysis-model call with the user's configured provider and the same Cloud
 * fallback rule as the project pass. Each feature supplies its answer format.
 */
export function createAnalysisTextInference<T, I = ProjectPassPromptInput>(
  setup: AnalysisAiSetupState,
  deps: ProjectPassInferenceDeps,
  protocol: AnalysisInferenceProtocol<T, I>,
): AnalysisTextInference<T, I> {
  const preferred = createProviderAnalysisInference(setup, deps, deps.cloudRecovery ?? false, protocol);
  let rejected = false;
  return async (prompt, input) => {
    if (!rejected) {
      const result = await preferred(prompt, input);
      if (!result.unavailableReason || setup.provider === "cloud") return result;
      rejected = true;
      deps.onProviderUnavailable?.(result.unavailableReason);
      if (!deps.canFallbackToCloud?.()) return result;
    }
    if (!deps.canFallbackToCloud?.()) return { output: null, usage: { provider: setup.provider } };
    return createProviderAnalysisInference({ ...setup, provider: "cloud" }, deps, true, protocol)(prompt, input);
  };
}
