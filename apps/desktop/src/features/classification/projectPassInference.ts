import { invoke } from "@tauri-apps/api/core";
import { OPENROUTER_PRIVACY_PROVIDER, normalizeOpenRouterFallbackModels, normalizeOpenRouterPrimaryModel } from "../settings/localAiSetup";
import type { AnalysisAiSetupState } from "../settings/analysisModelSetup";
import { supabase } from "../../lib/supabase/client";
import type { NativeOpenAiChatResponse } from "./managedLocalAiChat";
import { parseProjectPassOutput, type ProjectPassInference, type ProjectPassInferenceResult } from "./aiProjectReviewService";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
// OpenAI's public API is OpenAI-compatible, so it rides the shared chat path.
const OPENAI_BASE_URL = "https://api.openai.com/v1";
// Output must hold one assignment + optional correction per run in the chunk;
// a chunk of ~80 runs needs several thousand tokens, so keep this generous.
const PROJECT_PASS_MAX_TOKENS = 8192;
const REVIEW_EDGE_FUNCTION = "review-activity";

export interface ProjectPassInferenceDeps {
  readonly invokeChat?: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>;
  /** Anthropic's Messages API is not OpenAI-shaped, so it has its own native command. */
  readonly invokeAnthropicChat?: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>;
  readonly invokeCloud?: (prompt: string) => Promise<{ content: string; model?: string | null; tokensIn?: number | null; tokensOut?: number | null; latencyMs?: number | null }>;
}

interface ChatUsage {
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

// The Tauri command returns `body` as a raw JSON string (reqwest text()), so it
// must be parsed before reading choices/usage — mirrors aiClassificationService.
function parseNativeBody(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (body ?? {}) as Record<string, unknown>;
}

function usageFromParsedBody(record: Record<string, unknown>, fallbackModel: string): ChatUsage {
  const usage = (record.usage ?? {}) as { prompt_tokens?: unknown; completion_tokens?: unknown };
  return {
    model: typeof record.model === "string" ? record.model : fallbackModel,
    tokensIn: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    tokensOut: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
  };
}

function contentFromParsedBody(record: Record<string, unknown>): string {
  const choices = record.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const content = choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
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
  };
}

async function dispatchChat(
  invokeChat: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>,
  request: Record<string, unknown>,
  fallbackModel: string,
): Promise<ProjectPassInferenceResult> {
  const response = await invokeChat(request);
  const status = typeof response.status === "number" ? response.status : 0;
  const latencyMs = typeof response.latencyMs === "number" ? response.latencyMs : null;
  if (status < 200 || status >= 300) {
    const detail = typeof response.body === "string" ? response.body.slice(0, 300) : "";
    console.warn(`[project-pass] analysis model HTTP ${status}: ${detail}`);
    return { output: null, usage: { provider: "openrouter", latencyMs } };
  }
  const parsed = parseNativeBody(response.body);
  const usage = usageFromParsedBody(parsed, fallbackModel);
  return {
    output: parseProjectPassOutput(contentFromParsedBody(parsed)),
    usage: { model: usage.model, provider: "openrouter", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, latencyMs },
  };
}

// Anthropic's Messages API returns `content: [{ type: "text", text }]` and
// `usage: { input_tokens, output_tokens }` — a different shape from OpenAI's
// chat completions, so it gets dedicated content/usage extractors here rather
// than mapping to OpenAI shape on the Rust side.
function buildAnthropicRequest(apiKey: string, model: string, prompt: string): Record<string, unknown> {
  return {
    apiKey,
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: PROJECT_PASS_MAX_TOKENS,
    temperature: 0,
  };
}

function anthropicContentFromParsedBody(record: Record<string, unknown>): string {
  const content = record.content as Array<{ text?: unknown }> | undefined;
  const text = content?.[0]?.text;
  return typeof text === "string" ? text : "";
}

function anthropicUsageFromParsedBody(record: Record<string, unknown>, fallbackModel: string): ChatUsage {
  const usage = (record.usage ?? {}) as { input_tokens?: unknown; output_tokens?: unknown };
  return {
    model: typeof record.model === "string" ? record.model : fallbackModel,
    tokensIn: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    tokensOut: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
  };
}

async function dispatchAnthropicChat(
  invokeChat: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>,
  request: Record<string, unknown>,
  fallbackModel: string,
): Promise<ProjectPassInferenceResult> {
  const response = await invokeChat(request);
  const status = typeof response.status === "number" ? response.status : 0;
  const latencyMs = typeof response.latencyMs === "number" ? response.latencyMs : null;
  if (status < 200 || status >= 300) {
    const detail = typeof response.body === "string" ? response.body.slice(0, 300) : "";
    console.warn(`[project-pass] anthropic analysis model HTTP ${status}: ${detail}`);
    return { output: null, usage: { provider: "anthropic", latencyMs } };
  }
  const parsed = parseNativeBody(response.body);
  const usage = anthropicUsageFromParsedBody(parsed, fallbackModel);
  return {
    output: parseProjectPassOutput(anthropicContentFromParsedBody(parsed)),
    usage: { model: usage.model, provider: "anthropic", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, latencyMs },
  };
}

/**
 * Build a provider-bound ProjectPassInference from the analysis slot config.
 * Secrets (keys) must already be resolved onto `setup` by the caller (Keychain).
 */
export function createProjectPassInference(setup: AnalysisAiSetupState, deps: ProjectPassInferenceDeps = {}): ProjectPassInference {
  const invokeChat = deps.invokeChat ?? ((request) => invoke<NativeOpenAiChatResponse>("ai_classification_openai_chat", { request }));
  const invokeAnthropicChat =
    deps.invokeAnthropicChat ?? ((request) => invoke<NativeOpenAiChatResponse>("ai_classification_anthropic_chat", { request }));
  const invokeCloud =
    deps.invokeCloud ??
    (async (prompt: string) => {
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data, error } = await supabase.functions.invoke(REVIEW_EDGE_FUNCTION, { body: { prompt } });
      if (error) throw new Error(error.message ?? "review-activity failed");
      const payload = data as { content?: unknown; model?: unknown; tokensIn?: unknown; tokensOut?: unknown };
      return {
        content: typeof payload.content === "string" ? payload.content : "",
        model: typeof payload.model === "string" ? payload.model : null,
        tokensIn: typeof payload.tokensIn === "number" ? payload.tokensIn : null,
        tokensOut: typeof payload.tokensOut === "number" ? payload.tokensOut : null,
        latencyMs: null,
      };
    });

  return async (prompt: string): Promise<ProjectPassInferenceResult> => {
    if (setup.provider === "cloud") {
      const result = await invokeCloud(prompt);
      return {
        output: parseProjectPassOutput(result.content),
        usage: { model: result.model ?? null, provider: "cloud", tokensIn: result.tokensIn ?? null, tokensOut: result.tokensOut ?? null, latencyMs: result.latencyMs ?? null },
      };
    }
    if (setup.provider === "openrouter") {
      const models = openRouterModels(setup);
      if (!setup.openRouterApiKey.trim() || !models[0]) return { output: null, usage: { provider: "openrouter" } };
      return dispatchChat(invokeChat, buildOpenAiCompatibleRequest(OPENROUTER_BASE_URL, setup.openRouterApiKey.trim(), models, prompt, true), models[0]);
    }
    if (setup.provider === "openai") {
      const apiKey = setup.openaiApiKey.trim();
      const model = setup.openaiModel.trim();
      if (!apiKey || !model) return { output: null, usage: { provider: "openai" } };
      const result = await dispatchChat(invokeChat, buildOpenAiCompatibleRequest(OPENAI_BASE_URL, apiKey, [model], prompt, false), model);
      return { ...result, usage: { ...result.usage, provider: "openai" } };
    }
    if (setup.provider === "anthropic") {
      const apiKey = setup.anthropicApiKey.trim();
      const model = setup.anthropicModel.trim();
      if (!apiKey || !model) return { output: null, usage: { provider: "anthropic" } };
      return dispatchAnthropicChat(invokeAnthropicChat, buildAnthropicRequest(apiKey, model, prompt), model);
    }
    const baseUrl = setup.selfHostedBaseUrl.trim();
    const model = setup.selfHostedModel.trim();
    if (!baseUrl || !model) return { output: null, usage: { provider: "self_hosted" } };
    const result = await dispatchChat(invokeChat, buildOpenAiCompatibleRequest(baseUrl, setup.selfHostedApiKey.trim() || null, [model], prompt, false), model);
    return { ...result, usage: { ...result.usage, provider: "self_hosted" } };
  };
}
