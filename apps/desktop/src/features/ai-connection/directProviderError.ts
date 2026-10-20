import type { AiConnectionIssueKind } from "./aiConnectionHealth";

export type DirectProviderLabel = "OpenAI" | "Anthropic";

export function directProviderIssueKindFromStatus(status: number): AiConnectionIssueKind {
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
    case 500:
    case 502:
    case 503:
    case 504:
    case 529:
      return "unavailable";
    default:
      return "provider";
  }
}

export function directProviderFailureMessage(label: DirectProviderLabel, issueKind: AiConnectionIssueKind, status: number): string {
  switch (issueKind) {
    case "authentication":
      return `${label} rejected the API key.`;
    case "credits":
      return `${label} credits are required.`;
    case "access":
      return `${label} blocked this request.`;
    case "model_unavailable":
      return `The selected ${label} model is unavailable.`;
    case "rate_limited":
      return `${label} is rate limiting requests.`;
    case "unavailable":
      return `${label} is temporarily unavailable.`;
    case "network":
      return `${label} could not be reached.`;
    case "entitlement":
    case "provider":
      return `Provider returned HTTP ${status || "unknown"}.`;
    default:
      return issueKind satisfies never;
  }
}
