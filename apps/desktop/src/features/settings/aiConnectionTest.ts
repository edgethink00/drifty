import {
  MANAGED_LOCAL_AI_CONNECTION_TEST_MAX_TOKENS,
  managedLocalRuntimeRequestOptions,
  type LocalAiProviderConfig,
} from "../classification/localAiProviderRequest";
import {
  invokeOpenAiChatWithManagedLocalRetry,
  type NativeOpenAiChatResponse,
} from "../classification/managedLocalAiChat";
import {
  isManagedLocalAiRoute,
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
  type LocalAiSetupState,
} from "./localAiSetup";

export type AiConnectionTestResult =
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export async function testLocalAiConnection(setup: LocalAiSetupState): Promise<AiConnectionTestResult> {
  const request = localAiConnectionRequest(setup);
  if (!request) return { kind: "error", message: "Complete the selected provider settings before testing." };

  try {
    const response = await invokeOpenAiChatWithManagedLocalRetry(request, managedLocalProviderFromSetup(setup));
    const status = typeof response.status === "number" ? response.status : 0;
    if (status < 200 || status >= 300) {
      return { kind: "error", message: `Provider returned HTTP ${status || "unknown"}.` };
    }
    if (!hasAssistantContent(typeof response.body === "string" ? response.body : "")) {
      return { kind: "error", message: "Provider responded, but no assistant message was returned." };
    }
    const latencyMs = typeof response.latencyMs === "number" && Number.isFinite(response.latencyMs) ? response.latencyMs : 0;
    return { kind: "success", message: `Connected in ${latencyMs} ms.` };
  } catch (error) {
    return {
      kind: "error",
      message: messageFromConnectionError(error),
    };
  }
}

function managedLocalProviderFromSetup(setup: LocalAiSetupState): Extract<LocalAiProviderConfig, { readonly provider: "managed_local" }> | null {
  if (setup.provider !== "managed_local" || !isManagedLocalAiRoute(setup)) return null;
  const baseUrl = setup.managedLocalBaseUrl.trim();
  const model = setup.managedLocalModel.trim();
  const modelId = setup.managedLocalModelId.trim();
  if (!baseUrl || !model || !modelId) return null;
  return { provider: "managed_local", baseUrl, model, modelId };
}

function messageFromConnectionError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Connection test failed.";
}

function localAiConnectionRequest(setup: LocalAiSetupState): Record<string, unknown> | null {
  switch (setup.provider) {
    case "managed_local":
      if (!isManagedLocalAiRoute(setup)) return null;
      return openAiCompatibleConnectionRequest(
        setup.managedLocalBaseUrl,
        setup.managedLocalModel,
        managedLocalRuntimeRequestOptions(MANAGED_LOCAL_AI_CONNECTION_TEST_MAX_TOKENS),
      );
    case "openrouter_byok": {
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
    case "self_hosted":
      return openAiCompatibleConnectionRequest(setup.selfHostedBaseUrl, setup.selfHostedModel);
    default:
      return assertNever(setup.provider);
  }
}

function openAiCompatibleConnectionRequest(
  baseUrlValue: string,
  modelValue: string,
  options: Record<string, unknown> = {},
): Record<string, unknown> | null {
  const baseUrl = baseUrlValue.trim();
  const model = modelValue.trim();
  if (!baseUrl || !model) return null;
  return {
    baseUrl,
    model,
    ...options,
    messages: testMessages(),
    headers: {},
  };
}

class AiConnectionTestError extends Error {
  constructor(readonly provider: string) {
    super(`Unhandled AI connection provider: ${provider}`);
    this.name = "AiConnectionTestError";
  }
}

function assertNever(value: never): never {
  throw new AiConnectionTestError(String(value));
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
