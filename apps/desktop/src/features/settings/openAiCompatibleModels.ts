import { invokePreviewAwareAiCommand } from "./previewAiBridge";
import { normalizeOpenAiCompatibleBaseUrl } from "./localAiSetup";

type NativeModelListResponse = {
  readonly status: number;
  readonly body: string;
};

export type OpenAiCompatibleModelList = {
  readonly models: string[];
  readonly totalCount: number;
};

export type OpenAiCompatibleModelListErrorCode =
  | "base-url-required"
  | "invalid-base-url"
  | "unsupported-protocol"
  | "request-failed"
  | "http"
  | "invalid-json"
  | "incompatible-response";

export class OpenAiCompatibleModelListError extends Error {
  constructor(
    readonly code: OpenAiCompatibleModelListErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpenAiCompatibleModelListError";
  }
}

export const MAX_DISCOVERED_MODELS = 1_000;
export const MAX_DISCOVERED_MODEL_ID_LENGTH = 512;

export async function listOpenAiCompatibleModels(baseUrlValue: string, apiKeyValue: string): Promise<OpenAiCompatibleModelList> {
  const baseUrl = normalizeBaseUrl(baseUrlValue);
  const apiKey = apiKeyValue.trim();

  let response: NativeModelListResponse;
  try {
    response = await invokePreviewAwareAiCommand<NativeModelListResponse>("ai_list_openai_models", {
      request: { baseUrl, apiKey: apiKey || null },
    });
  } catch {
    throw new OpenAiCompatibleModelListError("request-failed", "The model-list request failed.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new OpenAiCompatibleModelListError("http", `The endpoint returned HTTP ${response.status}.`, response.status);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new OpenAiCompatibleModelListError("invalid-json", "The endpoint returned invalid JSON.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
    throw new OpenAiCompatibleModelListError(
      "incompatible-response",
      "The endpoint did not return an OpenAI-compatible model list.",
    );
  }

  const uniqueModels = [...new Set(parsed.data.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string") return [];
    const id = candidate.id.trim();
    return id && id.length <= MAX_DISCOVERED_MODEL_ID_LENGTH ? [id] : [];
  }))].sort((left, right) => left.localeCompare(right));
  return {
    models: uniqueModels.slice(0, MAX_DISCOVERED_MODELS),
    totalCount: uniqueModels.length,
  };
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new OpenAiCompatibleModelListError("base-url-required", "Enter a base URL before fetching models.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new OpenAiCompatibleModelListError("invalid-base-url", "Enter a valid endpoint URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OpenAiCompatibleModelListError("unsupported-protocol", "The endpoint URL must use HTTP or HTTPS.");
  }
  const normalized = normalizeOpenAiCompatibleBaseUrl(trimmed);
  if (!normalized) {
    throw new OpenAiCompatibleModelListError("invalid-base-url", "Enter a valid endpoint URL.");
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
