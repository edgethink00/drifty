import {
  isManagedLocalAiRoute,
  normalizeOpenRouterPrimaryModel,
  OPENROUTER_RECOMMENDED_MODELS,
  type LocalAiProvider,
  type LocalAiSetupState,
} from "../settings/localAiSetup";
import { MANAGED_LOCAL_AI_FALLBACK_CATALOG } from "../settings/managedLocalAiCatalog";

export type AiConnectionIssueKind = "network" | "provider";

export type LocalAiConnectionCheck = {
  readonly provider: LocalAiProvider;
  readonly fingerprint: string;
  readonly status: "connected" | "failed";
  readonly issueKind: AiConnectionIssueKind | null;
  readonly message: string;
  readonly checkedAt: number;
};

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
