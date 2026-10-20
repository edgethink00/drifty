import { claudeThinkingShouldBeDisabled, modelRejectsTemperature } from "./modelParameterSupport";
import { invokePreviewAwareAiCommand } from "../settings/previewAiBridge";
import type { NativeOpenAiChatResponse } from "./managedLocalAiChat";

/**
 * Anthropic's Messages API is not OpenAI shaped. Classification, Memory and Soul
 * requests are built once and dispatched by this marker; the native response is
 * mapped back to the OpenAI shape so every caller keeps its existing parser.
 */
export const ANTHROPIC_WIRE_FORMAT = "anthropic";

type PromptMessage = { readonly role: string; readonly content: string };

export function isAnthropicWireRequest(request: Record<string, unknown>): boolean {
  return request.wireFormat === ANTHROPIC_WIRE_FORMAT;
}

/** System text moves to the top-level field; the remaining turns stay as messages. */
export function anthropicWireRequest(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly messages: readonly PromptMessage[];
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
}): Record<string, unknown> {
  const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  return {
    wireFormat: ANTHROPIC_WIRE_FORMAT,
    apiKey: input.apiKey,
    model: input.model,
    ...(system ? { system } : {}),
    messages: input.messages.filter((message) => message.role !== "system"),
    ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    // Claude 5 generation models reject temperature on the Messages API.
    ...(modelRejectsTemperature(input.model) ? {} : { temperature: 0 }),
    ...(claudeThinkingShouldBeDisabled(input.model) ? { disableThinking: true } : {}),
  };
}

export async function invokeAnthropicNativeChat(request: Record<string, unknown>): Promise<NativeOpenAiChatResponse> {
  const native = { ...request };
  delete native.wireFormat;
  return anthropicResponseAsOpenAiChat(await invokePreviewAwareAiCommand<NativeOpenAiChatResponse>("ai_classification_anthropic_chat", { request: native }));
}

/** Successful answers become `choices[0].message.content`; errors pass through untouched. */
export function anthropicResponseAsOpenAiChat(response: NativeOpenAiChatResponse): NativeOpenAiChatResponse {
  const status = typeof response.status === "number" ? response.status : 0;
  if (status < 200 || status >= 300 || typeof response.body !== "string") return response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return response;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.content)) return response;
  const text = parsed.content
    .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
  const usage = isRecord(parsed.usage) ? parsed.usage : {};
  const promptTokens = numberOrNull(usage.input_tokens);
  const completionTokens = numberOrNull(usage.output_tokens);
  const normalized = {
    ...(typeof parsed.id === "string" ? { id: parsed.id } : {}),
    ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: parsed.stop_reason === "max_tokens" ? "length" : "stop",
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null,
    },
  };
  return { ...response, body: JSON.stringify(normalized) };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
