import type { AnalyticsErrorKind } from "../../lib/analytics/eventHelpers";

/**
 * What an OpenAI-compatible endpoint actually did when a connection test
 * failed, reduced to a status code and a fixed response kind. It never holds
 * the address, the response body or the provider's error text, so it can go
 * into feedback diagnostics and the local support journal.
 *
 * The connection issue kind stays as before (custom endpoints report
 * "provider" for any answer they cannot use); this detail only sharpens the
 * message and the diagnostics.
 */
export type EndpointResponseKind =
  /** An HTML page, typically a server's web UI when the base URL lacks /v1. */
  | "html"
  /** A 2xx answer that is not JSON at all. */
  | "not_json"
  /** JSON without a usable assistant message. */
  | "no_message"
  /** A non-2xx HTTP status that is not an HTML page. */
  | "http_error"
  | "timeout"
  | "unreachable";

export type EndpointFailureDetail = {
  readonly httpStatus: number | null;
  readonly responseKind: EndpointResponseKind;
  /**
   * What the endpoint's own error body says, reduced to a fixed vocabulary.
   * Never the server's text: that may only be shown on screen.
   */
  readonly errorCode?: EndpointErrorCode;
};

export type EndpointErrorCode = "model_not_found" | "authentication" | "quota" | "context_length" | "other";

/** The error an OpenAI-compatible server put in its response body, if any. */
export type EndpointErrorBody = {
  readonly code: EndpointErrorCode;
  /** Short, single-line server text for the screen only. */
  readonly message: string | null;
};

export const ENDPOINT_HTML_MESSAGE = "The endpoint returned a web page instead of an API response. Check the base URL; it usually ends in /v1.";
export const ENDPOINT_NOT_OPENAI_MESSAGE = "The endpoint did not return an OpenAI-compatible response. Check the base URL; it usually ends in /v1.";
export const ENDPOINT_NOT_FOUND_MESSAGE = "The endpoint returned HTTP 404. Check that the base URL ends in /v1 and that the model ID exists.";
export const ENDPOINT_RATE_LIMITED_MESSAGE = "The endpoint is rate limiting requests (HTTP 429). Try again in a moment.";
export const NO_ASSISTANT_MESSAGE = "Provider responded, but no assistant message was returned.";
const SERVER_MESSAGE_LIMIT = 200;

export function endpointServerErrorMessage(status: number): string {
  return `The endpoint returned a server error (HTTP ${status}). Check the server and the account it uses.`;
}

export function endpointModelMissingMessage(model: string): string {
  return `The endpoint does not have the model "${model}". Use Fetch models to choose one it lists.`;
}

export function endpointHttpDetailMessage(status: number | null, serverMessage: string): string {
  return `The endpoint returned HTTP ${status ?? "unknown"}: ${serverMessage}`;
}

/** A non-2xx answer. */
export function endpointHttpFailureDetail(status: number, body: unknown): EndpointFailureDetail {
  if (looksLikeHtml(body)) return { httpStatus: validStatus(status), responseKind: "html" };
  const error = readEndpointErrorBody(body);
  return { httpStatus: validStatus(status), responseKind: "http_error", ...(error ? { errorCode: error.code } : {}) };
}

/**
 * Reads the error shapes OpenAI-compatible servers use: OpenAI and LM Studio
 * `{"error": {"message", "code", "type"}}`, Ollama `{"error": "..."}`, vLLM
 * `{"object": "error", "message": ...}` and FastAPI `{"detail": "..."}`.
 */
export function readEndpointErrorBody(body: unknown): EndpointErrorBody | null {
  if (typeof body !== "string" || looksLikeHtml(body)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const nested = isRecord(parsed.error) ? parsed.error : null;
  const rawMessage = firstString(nested?.message, parsed.error, parsed.message, parsed.detail);
  const rawCode = firstString(nested?.code, nested?.type, parsed.code, parsed.type);
  if (rawMessage === null && rawCode === null) return null;
  const message = rawMessage === null ? null : clipServerText(rawMessage);
  return { code: classifyEndpointError(rawCode, message), message };
}

function classifyEndpointError(code: string | null, message: string | null): EndpointErrorCode {
  const normalizedCode = code?.toLowerCase() ?? "";
  const text = message?.toLowerCase() ?? "";
  if (["model_not_found", "invalid_model", "model_not_available"].includes(normalizedCode)
    || /\bmodel\b[^.]{0,120}\b(not found|does not exist|doesn't exist|not available|is unavailable|not supported)\b/.test(text)
    || /\b(unknown|invalid|unsupported) model\b/.test(text)) return "model_not_found";
  if (["invalid_api_key", "authentication_error", "unauthorized", "permission_denied"].includes(normalizedCode)) return "authentication";
  if (["insufficient_quota", "billing_hard_limit_reached"].includes(normalizedCode)) return "quota";
  if (["context_length_exceeded"].includes(normalizedCode)) return "context_length";
  return "other";
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function clipServerText(value: string): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > SERVER_MESSAGE_LIMIT ? `${single.slice(0, SERVER_MESSAGE_LIMIT - 1)}…` : single;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A 2xx answer that carried no assistant message. */
export function endpointBodyFailureDetail(status: number, body: unknown): EndpointFailureDetail {
  const httpStatus = validStatus(status);
  if (looksLikeHtml(body)) return { httpStatus, responseKind: "html" };
  if (typeof body !== "string" || !isJson(body)) return { httpStatus, responseKind: "not_json" };
  return { httpStatus, responseKind: "no_message" };
}

/** The request never produced an HTTP answer. */
export function endpointTransportFailureDetail(message: string): EndpointFailureDetail {
  const normalized = message.toLowerCase();
  return {
    httpStatus: null,
    responseKind: normalized.includes("timed out") || normalized.includes("timeout") ? "timeout" : "unreachable",
  };
}

/**
 * The connection-test message for a custom endpoint that answered. Statuses
 * without a specific hint, including authentication failures, keep the shared
 * "Provider returned HTTP n." wording, which is already localized.
 *
 * `context.serverMessage` (the endpoint's own error text) is only for the
 * settings screen; callers whose message can reach diagnostics leave it out.
 */
export function customEndpointFailureMessage(
  detail: EndpointFailureDetail,
  context: { readonly model?: string; readonly serverMessage?: string | null } = {},
): string | null {
  const model = context.model?.trim();
  if (detail.errorCode === "model_not_found" && model) return endpointModelMissingMessage(model);
  switch (detail.responseKind) {
    case "html":
      return ENDPOINT_HTML_MESSAGE;
    case "not_json":
      return ENDPOINT_NOT_OPENAI_MESSAGE;
    case "no_message":
      return NO_ASSISTANT_MESSAGE;
    case "http_error": {
      const status = detail.httpStatus;
      if (status === 429) return ENDPOINT_RATE_LIMITED_MESSAGE;
      if (status === 404) return ENDPOINT_NOT_FOUND_MESSAGE;
      // A bare "Not Found" says less than the address hint above; other
      // statuses carry the server's own reason when it gave one.
      if (context.serverMessage) return endpointHttpDetailMessage(status, context.serverMessage);
      if (status !== null && status >= 500) return endpointServerErrorMessage(status);
      return `Provider returned HTTP ${status ?? "unknown"}.`;
    }
    case "timeout":
    case "unreachable":
      return null;
    default:
      return assertNever(detail.responseKind);
  }
}

/** A fixed analytics error kind, so the support journal can tell these apart. */
export function endpointFailureAnalyticsErrorKind(detail: EndpointFailureDetail): AnalyticsErrorKind {
  switch (detail.responseKind) {
    case "html":
    case "not_json":
      return "configuration";
    case "no_message":
      return "provider_error";
    case "timeout":
      return "timeout";
    case "unreachable":
      return "network";
    case "http_error": {
      if (detail.errorCode === "model_not_found") return "not_found";
      if (detail.errorCode === "authentication") return "not_authenticated";
      if (detail.errorCode === "quota") return "rate_limited";
      const status = detail.httpStatus;
      if (status === 401 || status === 403) return "not_authenticated";
      if (status === 404) return "not_found";
      if (status === 429) return "rate_limited";
      if (status !== null && status >= 500) return "unavailable";
      return "provider_error";
    }
    default:
      return assertNever(detail.responseKind);
  }
}

function looksLikeHtml(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const start = body.trimStart().slice(0, 512).toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html") || (start.startsWith("<") && start.includes("<head"));
}

function isJson(body: string): boolean {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

function validStatus(status: number): number | null {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled endpoint response kind: ${String(value)}`);
}

