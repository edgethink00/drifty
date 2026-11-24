import { cliClassificationModel } from "./cliClassificationModels";
import { CliAiChatError, type CliAiFailureReason } from "../classification/cliAiChat";
import { openAiCompatibleParameterFlags } from "../classification/modelParameterSupport";
import { anthropicWireRequest } from "../classification/anthropicChat";
import { OPENAI_API_BASE_URL } from "./directProviderModels";
import { directProviderFailureMessage, directProviderIssueKindFromStatus } from "../ai-connection/directProviderError";
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
  DEFAULT_LOCAL_AI_SETUP,
  isManagedLocalAiRoute,
  normalizeOpenAiCompatibleBaseUrl,
  OPENROUTER_PRIVACY_PROVIDER,
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
  type LocalAiSetupState,
} from "./localAiSetup";
import {
  aiConnectionIssueKindFromMessage,
  type AiConnectionIssueKind,
} from "../ai-connection/aiConnectionHealth";
import {
  openRouterConnectionFailureMessage,
  openRouterEmbeddedIssueKind,
  openRouterIssueKindFromResponse,
} from "../ai-connection/openRouterError";
import {
  customEndpointFailureMessage,
  endpointBodyFailureDetail,
  endpointHttpFailureDetail,
  endpointTransportFailureDetail,
  NO_ASSISTANT_MESSAGE,
  readEndpointErrorBody,
  type EndpointFailureDetail,
} from "../ai-connection/endpointFailure";

export type AiConnectionTestResult =
  | { readonly kind: "success"; readonly message: string }
  | {
    readonly kind: "error";
    readonly cliFailureReason?: CliAiFailureReason;
    readonly cliStage?: "account" | "classifier";
    readonly issueKind: AiConnectionIssueKind;
    readonly message: string;
    readonly retryAfterMs?: number;
    /** What the endpoint did, without its address or response text. */
    readonly detail?: EndpointFailureDetail;
  };

export type OpenAiCompatibleConnectionTestInput = {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
};

/**
 * Tests one OpenAI-compatible endpoint without coupling the caller to the
 * Classification setup shape. Both task tabs use the same native/proxy path,
 * response validation, and error mapping.
 */
export function testOpenAiCompatibleConnection(
  input: OpenAiCompatibleConnectionTestInput,
): Promise<AiConnectionTestResult> {
  return testLocalAiConnection({
    ...DEFAULT_LOCAL_AI_SETUP,
    provider: "self_hosted",
    selfHostedBaseUrl: input.baseUrl.trim(),
    selfHostedApiKey: input.apiKey?.trim() ?? "",
    selfHostedModel: input.model.trim(),
  });
}

export async function testLocalAiConnection(setup: LocalAiSetupState, canSend: () => boolean = () => true): Promise<AiConnectionTestResult> {
  const request = localAiConnectionRequest(setup);
  if (!request) return {
    kind: "error",
    issueKind: "provider",
    message: "Complete the selected provider settings before testing.",
  };

  try {
    const response = await invokeOpenAiChatWithManagedLocalRetry(request, managedLocalProviderFromSetup(setup), canSend, { priority: "analysis" });
    const status = typeof response.status === "number" ? response.status : 0;
    if (status < 200 || status >= 300) {
      const directLabel = setup.provider === "openai" ? "OpenAI" : setup.provider === "anthropic" ? "Anthropic" : null;
      const issueKind = setup.provider === "openrouter_byok"
        ? openRouterIssueKindFromResponse(status, response.body)
        : directLabel ? directProviderIssueKindFromStatus(status) : "provider";
      const detail = endpointHttpFailureDetail(status, response.body);
      // The server's own error text is shown here only: this message stays on
      // the settings screen and never enters diagnostics.
      const customMessage = setup.provider === "self_hosted"
        ? customEndpointFailureMessage(detail, {
            model: setup.selfHostedModel,
            serverMessage: readEndpointErrorBody(response.body)?.message ?? null,
          })
        : null;
      return {
        kind: "error",
        issueKind,
        message: customMessage
          ?? (directLabel ? directProviderFailureMessage(directLabel, issueKind, status) : openRouterConnectionFailureMessage(issueKind, status)),
        detail,
        ...retryAfterResult(response.retryAfterMs),
      };
    }
    if (setup.provider === "openrouter_byok") {
      const embeddedIssue = openRouterEmbeddedIssueKind(response.body);
      if (embeddedIssue) return { kind: "error", issueKind: embeddedIssue, message: openRouterConnectionFailureMessage(embeddedIssue, status) };
    }
    if (!hasAssistantContent(typeof response.body === "string" ? response.body : "")) {
      const detail = endpointBodyFailureDetail(status, response.body);
      const message = (setup.provider === "self_hosted" ? customEndpointFailureMessage(detail) : null) ?? NO_ASSISTANT_MESSAGE;
      return { kind: "error", issueKind: "provider", message, detail };
    }
    if (setup.provider === "codex_cli" || setup.provider === "claude_cli") {
      const body = JSON.parse(String(response.body));
      const content = body.choices?.[0]?.message?.content;
      const parsed: unknown = JSON.parse(typeof content === "string" ? content : "null");
      const results = isRecord(parsed) ? parsed.results : null;
      const first = Array.isArray(results) && results.length === 1 ? results[0] : null;
      if (!isRecord(first) || first.id !== "probe" || first.category !== "workspace" || first.intent !== "work_execution" || typeof first.confidence !== "number" || first.confidence < 0 || first.confidence > 1 || typeof first.reason !== "string") {
        return { kind: "error", issueKind: "provider", cliStage: "classifier", cliFailureReason: "invalid_response", message: "The CLI did not return a usable classification. Try again." };
      }
    }
    if (response.previewMock === true) return { kind: "success", message: "Preview connection simulated." };
    const latencyMs = typeof response.latencyMs === "number" && Number.isFinite(response.latencyMs) ? response.latencyMs : 0;
    return { kind: "success", message: `Connected in ${latencyMs} ms.` };
  } catch (error) {
    const message = messageFromConnectionError(error);
    const issueKind = aiConnectionIssueKindFromMessage(message);
    return {
      kind: "error",
      issueKind,
      message,
      ...((setup.provider === "codex_cli" || setup.provider === "claude_cli") ? { cliFailureReason: error instanceof CliAiChatError ? error.reason : "unavailable" as const, cliStage: error instanceof SyntaxError || (error instanceof CliAiChatError && error.reason === "invalid_response") ? "classifier" as const : "account" as const } : {}),
      // Only a transport failure says something about the endpoint; other
      // thrown errors (runtime start, cancelled request) keep no detail.
      ...(issueKind === "network" ? { detail: endpointTransportFailureDetail(message) } : {}),
    };
  }
}

function retryAfterResult(value: unknown): { readonly retryAfterMs: number } | Record<string, never> {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return {};
  return { retryAfterMs: Math.round(value) };
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
    case "codex_cli":
    case "claude_cli":
      return { cliProvider: setup.provider === "codex_cli" ? "codex" : "claude", cliModel: cliClassificationModel(setup.provider, setup), messages: [{ role: "user", content: 'Classify this synthetic activity: id=probe, app=Visual Studio Code, title=Editing a source file for work. Return JSON only with results containing exactly one item: id, category (workspace), intent (work_execution), confidence (0 to 1), reason (short string).' }] };
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
        ...openAiCompatibleParameterFlags(models, { viaOpenRouter: true }),
        provider: OPENROUTER_PRIVACY_PROVIDER,
        messages: testMessages(),
        headers: {
          "HTTP-Referer": "https://drifty.so",
          "X-OpenRouter-Title": "Drifty",
        },
      };
    }
    case "openai": {
      const apiKey = setup.openaiApiKey.trim();
      return apiKey ? openAiCompatibleConnectionRequest(OPENAI_API_BASE_URL, setup.openaiModel, { apiKey }) : null;
    }
    case "anthropic": {
      const apiKey = setup.anthropicApiKey.trim();
      const model = setup.anthropicModel.trim();
      if (!apiKey || !model) return null;
      return anthropicWireRequest({ apiKey, model, messages: testMessages(), maxTokens: 64 });
    }
    case "self_hosted":
      return openAiCompatibleConnectionRequest(
        setup.selfHostedBaseUrl,
        setup.selfHostedModel,
        setup.selfHostedApiKey.trim() ? { apiKey: setup.selfHostedApiKey.trim() } : {},
      );
    default:
      return assertNever(setup.provider);
  }
}

function openAiCompatibleConnectionRequest(
  baseUrlValue: string,
  modelValue: string,
  options: Record<string, unknown> = {},
): Record<string, unknown> | null {
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(baseUrlValue);
  const model = modelValue.trim();
  if (!baseUrl || !model) return null;
  return {
    baseUrl,
    model,
    ...options,
    ...openAiCompatibleParameterFlags([model], { viaOpenRouter: false }),
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

function testMessages(): readonly { readonly role: string; readonly content: string }[] {
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
