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
};

export const ENDPOINT_HTML_MESSAGE = "The endpoint returned a web page instead of an API response. Check the base URL; it usually ends in /v1.";
export const ENDPOINT_NOT_OPENAI_MESSAGE = "The endpoint did not return an OpenAI-compatible response. Check the base URL; it usually ends in /v1.";
export const ENDPOINT_NOT_FOUND_MESSAGE = "The endpoint returned HTTP 404. Check that the base URL ends in /v1 and that the model ID exists.";
export const ENDPOINT_RATE_LIMITED_MESSAGE = "The endpoint is rate limiting requests (HTTP 429). Try again in a moment.";
export const NO_ASSISTANT_MESSAGE = "Provider responded, but no assistant message was returned.";

export function endpointServerErrorMessage(status: number): string {
  return `The endpoint returned a server error (HTTP ${status}). Check the server and the account it uses.`;
}

/** A non-2xx answer. */
export function endpointHttpFailureDetail(status: number, body: unknown): EndpointFailureDetail {
  return { httpStatus: validStatus(status), responseKind: looksLikeHtml(body) ? "html" : "http_error" };
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
 */
export function customEndpointFailureMessage(detail: EndpointFailureDetail): string | null {
  switch (detail.responseKind) {
    case "html":
      return ENDPOINT_HTML_MESSAGE;
    case "not_json":
      return ENDPOINT_NOT_OPENAI_MESSAGE;
    case "no_message":
      return NO_ASSISTANT_MESSAGE;
    case "http_error": {
      const status = detail.httpStatus;
      if (status === 404) return ENDPOINT_NOT_FOUND_MESSAGE;
      if (status === 429) return ENDPOINT_RATE_LIMITED_MESSAGE;
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

