import { invoke } from "@tauri-apps/api/core";
import { OPENROUTER_PRIVACY_PROVIDER, normalizeOpenRouterFallbackModels, normalizeOpenRouterPrimaryModel } from "../settings/localAiSetup";
import type { AnalysisAiSetupState } from "../settings/analysisModelSetup";
import { supabase } from "../../lib/supabase/client";
import type { NativeOpenAiChatResponse } from "./managedLocalAiChat";
import { parseProjectPassOutput, type ProjectPassInference, type ProjectPassInferenceResult } from "./aiProjectReviewService";
import { dispatchProjectPassChat } from "./projectPassChatResponse";

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
  readonly invokeChat?: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>;
  /** Anthropic's Messages API is not OpenAI-shaped, so it has its own native command. */
  readonly invokeAnthropicChat?: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>;
  readonly invokeCloud?: (prompt: string) => Promise<ProjectPassCloudResponse>;
}

function openRouterModels(setup: AnalysisAiSetupState): string[] {
  const primary = normalizeOpenRouterPrimaryModel(setup.openRouterModel);
  return [primary, ...normalizeOpenRouterFallbackModels(primary, setup.openRouterFallbackModels)];
}

function buildOpenAiCompatibleRequest(baseUrl: string, apiKey: string | null, models: string[], prompt: string, privacy: boolean): Record<string, unknown> {
  const modelShape = models.length === 1 ? { model: models[0] } : { models };
  return {
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...modelShape,
    ...(privacy ? { provider: OPENROUTER_PRIVACY_PROVIDER, headers: { "HTTP-Referer": "https://drifty.so", "X-OpenRouter-Title": "Drifty" } } : {}),
    messages: [{ role: "user", content: prompt }],
    maxTokens: PROJECT_PASS_MAX_TOKENS,
    temperature: 0,
    timeoutMs: PROJECT_PASS_TIMEOUT_MS,
  };
}

function buildAnthropicRequest(apiKey: string, model: string, prompt: string): Record<string, unknown> {
  return {
    apiKey,
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: PROJECT_PASS_MAX_TOKENS,
    temperature: 0,
    timeoutMs: PROJECT_PASS_TIMEOUT_MS,
  };
}

function buildCloudReviewRequest(supabaseUrl: string, accessToken: string, anonKey: string, prompt: string): Record<string, unknown> {
  return {
    baseUrl: `${supabaseUrl}/functions/v1/${REVIEW_EDGE_FUNCTION}`,
    apiKey: accessToken,
    model: "drifty-cloud",
    messages: [{ role: "user", content: prompt }],
    maxTokens: PROJECT_PASS_MAX_TOKENS,
    temperature: 0,
    timeoutMs: PROJECT_PASS_TIMEOUT_MS,
    headers: { apikey: anonKey },
  };
}

function cloudResultFromInjected(result: ProjectPassCloudResponse): ProjectPassInferenceResult {
  return {
    output: parseProjectPassOutput(result.content),
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
export function createProjectPassInference(setup: AnalysisAiSetupState, deps: ProjectPassInferenceDeps = {}): ProjectPassInference {
  const invokeChat = deps.invokeChat ?? ((request) => invoke<NativeOpenAiChatResponse>("ai_classification_openai_chat", { request }));
  const invokeAnthropicChat =
    deps.invokeAnthropicChat ?? ((request) => invoke<NativeOpenAiChatResponse>("ai_classification_anthropic_chat", { request }));

  return async (prompt: string): Promise<ProjectPassInferenceResult> => {
    if (setup.provider === "cloud") {
      if (deps.invokeCloud) {
        const result = await deps.invokeCloud(prompt);
        return cloudResultFromInjected(result);
      }
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Sign in to use Drifty Cloud analysis.");
      // WKWebView fetch aborts long response-less waits (the LLM streams nothing
      // until it finishes), so the cloud call rides the same native Rust HTTP
      // command as every other provider. The edge function accepts the OpenAI
      // chat shape on this path and picks the model server-side.
      const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
      const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "");
      return dispatchProjectPassChat(invokeChat, {
        request: buildCloudReviewRequest(supabaseUrl, accessToken, anonKey, prompt),
        fallbackModel: "drifty-cloud",
        provider: "cloud",
        shape: "openai",
        throwHttpError: cloudHttpError,
      });
    }
    if (setup.provider === "openrouter") {
      const models = openRouterModels(setup);
      const primaryModel = models[0];
      if (!setup.openRouterApiKey.trim() || !primaryModel) return { output: null, usage: { provider: "openrouter" } };
      return dispatchProjectPassChat(invokeChat, {
        request: buildOpenAiCompatibleRequest(OPENROUTER_BASE_URL, setup.openRouterApiKey.trim(), models, prompt, true),
        fallbackModel: primaryModel,
        provider: "openrouter",
        shape: "openai",
      });
    }
    if (setup.provider === "openai") {
      const apiKey = setup.openaiApiKey.trim();
      const model = setup.openaiModel.trim();
      if (!apiKey || !model) return { output: null, usage: { provider: "openai" } };
      return dispatchProjectPassChat(invokeChat, {
        request: buildOpenAiCompatibleRequest(OPENAI_BASE_URL, apiKey, [model], prompt, false),
        fallbackModel: model,
        provider: "openai",
        shape: "openai",
      });
    }
    if (setup.provider === "anthropic") {
      const apiKey = setup.anthropicApiKey.trim();
      const model = setup.anthropicModel.trim();
      if (!apiKey || !model) return { output: null, usage: { provider: "anthropic" } };
      return dispatchProjectPassChat(invokeAnthropicChat, {
        request: buildAnthropicRequest(apiKey, model, prompt),
        fallbackModel: model,
        provider: "anthropic",
        shape: "anthropic",
      });
    }
    const baseUrl = setup.selfHostedBaseUrl.trim();
    const model = setup.selfHostedModel.trim();
    if (!baseUrl || !model) return { output: null, usage: { provider: "self_hosted" } };
    return dispatchProjectPassChat(invokeChat, {
      request: buildOpenAiCompatibleRequest(baseUrl, setup.selfHostedApiKey.trim() || null, [model], prompt, false),
      fallbackModel: model,
      provider: "self_hosted",
      shape: "openai",
    });
  };
}
