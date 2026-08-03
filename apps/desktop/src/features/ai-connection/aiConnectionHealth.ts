import {
  isManagedLocalAiRoute,
  normalizeOpenRouterPrimaryModel,
  OPENROUTER_RECOMMENDED_MODELS,
  type LocalAiProvider,
  type LocalAiSetupState,
} from "../settings/localAiSetup";
import { MANAGED_LOCAL_AI_FALLBACK_CATALOG } from "../settings/managedLocalAiCatalog";

export type AiConnectionIssueKind =
  | "network"
  | "provider"
  | "authentication"
  | "credits"
  | "access"
  | "model_unavailable"
  | "rate_limited"
  | "unavailable";

export type LocalAiConnectionCheck = {
  readonly provider: LocalAiProvider;
  readonly fingerprint: string;
  readonly status: "connected" | "failed";
  readonly issueKind: AiConnectionIssueKind | null;
  readonly message: string;
  readonly checkedAt: number;
  readonly consecutiveFailures: number;
};

export type LocalAiConnectionEvent =
  | { readonly kind: "connection_test_success"; readonly message: string }
  | { readonly kind: "connection_test_failure"; readonly issueKind: AiConnectionIssueKind; readonly message: string }
  // A provider round-trip completed (classifications saved, or the provider
  // responded with unusable content) — proof the connection itself works.
  | { readonly kind: "provider_contact_ok"; readonly message: string }
  // A classification run failed at the transport layer (fetch/HTTP/timeout).
  | { readonly kind: "classification_transport_failure"; readonly issueKind?: AiConnectionIssueKind; readonly message: string };

// A lone transport failure from a background classification run is weak
// evidence (rate limits, wake-from-sleep blips); require this many consecutive
// failures before tearing down an established "connected" state.
export const CLASSIFICATION_FAILURE_DISCONNECT_THRESHOLD = 2;

// The dashboard "AI provider disconnected" overlay is reserved for failures
// confirmed by more than one probe, so a single failed launch test cannot
// summon it before the automatic re-test has a chance to run.
export const ESTABLISHED_DISCONNECT_FAILURE_THRESHOLD = 2;

export function nextLocalAiConnectionCheck(
  previousCheck: LocalAiConnectionCheck | null,
  target: { readonly provider: LocalAiProvider; readonly fingerprint: string },
  event: LocalAiConnectionEvent,
  checkedAt: number,
): LocalAiConnectionCheck | null {
  const matchingPrevious = previousCheck
    && previousCheck.provider === target.provider
    && previousCheck.fingerprint === target.fingerprint
    ? previousCheck
    : null;
  const priorFailures = matchingPrevious?.consecutiveFailures ?? 0;

  switch (event.kind) {
    case "connection_test_success":
    case "provider_contact_ok":
      return {
        provider: target.provider,
        fingerprint: target.fingerprint,
        status: "connected",
        issueKind: null,
        message: event.message,
        checkedAt,
        consecutiveFailures: 0,
      };
    case "connection_test_failure":
      // A connection test is a direct probe of the provider, so its verdict
      // lands immediately instead of accumulating toward the threshold.
      return {
        provider: target.provider,
        fingerprint: target.fingerprint,
        status: "failed",
        issueKind: event.issueKind,
        message: event.message,
        checkedAt,
        consecutiveFailures: priorFailures + 1,
      };
    case "classification_transport_failure": {
      const consecutiveFailures = priorFailures + 1;
      if (matchingPrevious?.status === "connected" && consecutiveFailures < CLASSIFICATION_FAILURE_DISCONNECT_THRESHOLD) {
        return { ...matchingPrevious, consecutiveFailures };
      }
      return {
        provider: target.provider,
        fingerprint: target.fingerprint,
        status: "failed",
        issueKind: event.issueKind ?? aiConnectionIssueKindFromMessage(event.message),
        message: event.message,
        checkedAt,
        consecutiveFailures,
      };
    }
    default:
      return assertNever(event);
  }
}

export function isEstablishedLocalAiDisconnect(check: LocalAiConnectionCheck | null): boolean {
  return check?.status === "failed" && check.consecutiveFailures >= ESTABLISHED_DISCONNECT_FAILURE_THRESHOLD;
}

const NETWORK_ERROR_PATTERNS = [
  "failed to fetch",
  "network",
  "offline",
  "timed out",
  "timeout",
  "connection refused",
  "could not connect",
  "cannot connect",
  "dns",
  "no internet",
  "internet connection",
  "load failed",
  "error sending request",
  "tcp connect",
  "host unreachable",
  "http 0",
] as const;

export function aiConnectionIssueKindFromMessage(message: string | null): AiConnectionIssueKind {
  const normalizedMessage = message?.trim().toLowerCase() ?? "";
  if (!normalizedMessage) return "provider";
  if (normalizedMessage.includes("openrouter rejected the api key")) return "authentication";
  if (normalizedMessage.includes("openrouter credits are required")) return "credits";
  if (normalizedMessage.includes("openrouter blocked this request")) return "access";
  if (normalizedMessage.includes("selected openrouter model is unavailable")) return "model_unavailable";
  if (normalizedMessage.includes("openrouter is rate limiting requests")) return "rate_limited";
  if (normalizedMessage.includes("openrouter has no available provider")) return "unavailable";
  return NETWORK_ERROR_PATTERNS.some((pattern) => normalizedMessage.includes(pattern)) ? "network" : "provider";
}

export function localAiProviderLabel(setup: LocalAiSetupState): string {
  switch (setup.provider) {
    case "managed_local":
      if (!isManagedLocalAiRoute(setup)) return "Drifty Cloud";
      return managedLocalModelStatusLabel(setup);
    case "openrouter_byok":
      return `${openRouterModelStatusLabel(setup)} BYOK`;
    case "self_hosted":
      return selfHostedModelStatusLabel(setup);
    default:
      return assertNever(setup.provider);
  }
}

export function localAiSetupFingerprint(setup: LocalAiSetupState): string | null {
  switch (setup.provider) {
    case "managed_local": {
      if (!isManagedLocalAiRoute(setup)) return null;
      const baseUrl = setup.managedLocalBaseUrl.trim();
      const model = setup.managedLocalModel.trim();
      const modelId = setup.managedLocalModelId.trim();
      if (!baseUrl || !model || !modelId) return null;
      return ["managed_local", baseUrl, model, modelId].join("|");
    }
    case "openrouter_byok": {
      const apiKey = setup.openRouterApiKey.trim();
      if (!apiKey) return null;
      return [
        "openrouter_byok",
        hashSecretForFingerprint(apiKey),
        setup.openRouterModel.trim(),
        ...setup.openRouterFallbackModels.map((model) => model.trim()).filter(Boolean),
      ].join("|");
    }
    case "self_hosted": {
      const baseUrl = setup.selfHostedBaseUrl.trim();
      const model = setup.selfHostedModel.trim();
      if (!baseUrl || !model) return null;
      return ["self_hosted", baseUrl, model].join("|");
    }
    default:
      return assertNever(setup.provider);
  }
}

function hashSecretForFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function managedLocalModelStatusLabel(setup: LocalAiSetupState): string {
  const catalogModel = MANAGED_LOCAL_AI_FALLBACK_CATALOG.find((model) => model.id === setup.managedLocalModelId);
  const modelLabel = catalogModel?.label ?? setup.managedLocalModel.trim();
  return modelLabel || "Local AI";
}

function openRouterModelStatusLabel(setup: LocalAiSetupState): string {
  const modelId = normalizeOpenRouterPrimaryModel(setup.openRouterModel);
  return OPENROUTER_RECOMMENDED_MODELS.find((model) => model.id === modelId)?.label ?? modelId;
}

function selfHostedModelStatusLabel(setup: LocalAiSetupState): string {
  const model = setup.selfHostedModel.trim();
  return model || "Local AI";
}

class AiConnectionHealthError extends Error {
  constructor(readonly provider: string) {
    super(`Unhandled local AI provider: ${provider}`);
    this.name = "AiConnectionHealthError";
  }
}

function assertNever(value: never): never {
  throw new AiConnectionHealthError(String(value));
}
