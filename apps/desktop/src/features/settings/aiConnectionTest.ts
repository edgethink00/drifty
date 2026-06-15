import { invoke } from "@tauri-apps/api/core";

import {
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
  type LocalAiSetupState,
} from "./localAiSetup";

type NativeOpenAiChatResponse = {
  readonly status: number;
  readonly body: string;
  readonly latencyMs: number;
};

export type AiConnectionTestResult =
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export async function testLocalAiConnection(setup: LocalAiSetupState): Promise<AiConnectionTestResult> {
  const request = localAiConnectionRequest(setup);
  if (!request) return { kind: "error", message: "Complete the selected provider settings before testing." };

  try {
    const response = await invoke<NativeOpenAiChatResponse>("ai_classification_openai_chat", { request });
    if (response.status < 200 || response.status >= 300) {
      return { kind: "error", message: `Provider returned HTTP ${response.status}.` };
    }
    if (!hasAssistantContent(response.body)) {
      return { kind: "error", message: "Provider responded, but no assistant message was returned." };
    }
    return { kind: "success", message: `Connected in ${response.latencyMs} ms.` };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : "Connection test failed.",
    };
  }
}

function localAiConnectionRequest(setup: LocalAiSetupState): Record<string, unknown> | null {
  if (setup.provider === "openrouter_byok") {
    const apiKey = setup.openRouterApiKey.trim();
    if (!apiKey) return null;
    const model = normalizeOpenRouterPrimaryModel(setup.openRouterModel);
    const fallbackModels = normalizeOpenRouterFallbackModels(model, setup.openRouterFallbackModels);
    const models = [model, ...fallbackModels];
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey,
      ...(models.length === 1 ? { model } : { models }),
      messages: testMessages(),
      headers: {
        "HTTP-Referer": "https://drifty.so",
        "X-OpenRouter-Title": "Drifty",
      },
    };
  }

  const baseUrl = setup.selfHostedBaseUrl.trim();
  const model = setup.selfHostedModel.trim();
  if (!baseUrl || !model) return null;
  return {
    baseUrl,
    model,
    messages: testMessages(),
    headers: {},
  };
}

function testMessages(): readonly Record<string, string>[] {
  return [{ role: "user", content: "Reply with compact JSON only: {\"ok\":true}" }];
}

function hasAssistantContent(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed) || !Array.isArray(parsed["choices"])) return false;
    return parsed["choices"].some((choice) => {
      if (!isRecord(choice) || !isRecord(choice["message"])) return false;
      const content = choice["message"]["content"];
      return typeof content === "string" && content.trim().length > 0;
    });
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
