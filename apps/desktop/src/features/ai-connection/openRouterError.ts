import type { AiConnectionIssueKind } from "./aiConnectionHealth";

export function openRouterIssueKindFromResponse(status: number, body: unknown): AiConnectionIssueKind {
  return openRouterEmbeddedIssueKind(body) ?? openRouterIssueKindFromStatus(status);
}

export function openRouterEmbeddedIssueKind(body: unknown): AiConnectionIssueKind | null {
  const parsed = parseJsonRecord(body);
  if (!parsed) return null;
  const error = firstRecord(
    parsed["error"],
    firstArrayRecord(parsed["choices"])?.["error"],
    firstArrayRecord(parsed["choices"])?.["message"],
  );
  const metadata = isRecord(error?.["metadata"]) ? error["metadata"] : null;
  const errorType = stringValue(metadata?.["error_type"]) ?? stringValue(parsed["error_type"]);
  switch (errorType) {
    case "authentication":
      return "authentication";
    case "payment_required":
      return "credits";
    case "permission_denied":
      return "access";
    case "not_found":
      return "model_unavailable";
    case "rate_limit_exceeded":
      return "rate_limited";
    case "provider_overloaded":
    case "provider_unavailable":
    case "timeout":
      return "unavailable";
    default:
      return null;
  }
}

export function openRouterConnectionFailureMessage(issueKind: AiConnectionIssueKind, status: number): string {
  switch (issueKind) {
    case "authentication":
      return "OpenRouter rejected the API key.";
    case "credits":
      return "OpenRouter credits are required.";
    case "access":
      return "OpenRouter blocked this request.";
    case "model_unavailable":
      return "The selected OpenRouter model is unavailable.";
    case "rate_limited":
      return "OpenRouter is rate limiting requests.";
    case "unavailable":
      return "OpenRouter has no available provider for this request.";
    case "network":
      return "OpenRouter could not be reached.";
    case "provider":
      return `Provider returned HTTP ${status || "unknown"}.`;
    default:
      return assertNever(issueKind);
  }
}

function openRouterIssueKindFromStatus(status: number): AiConnectionIssueKind {
  switch (status) {
    case 401:
      return "authentication";
    case 402:
      return "credits";
    case 403:
      return "access";
    case 404:
      return "model_unavailable";
    case 429:
      return "rate_limited";
    case 408:
    case 502:
    case 503:
    case 504:
      return "unavailable";
    default:
      return "provider";
  }
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstArrayRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) && isRecord(value[0]) ? value[0] : null;
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  return values.find(isRecord) ?? null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function assertNever(value: never): never {
  throw new Error(`Unhandled OpenRouter issue kind: ${String(value)}`);
}
