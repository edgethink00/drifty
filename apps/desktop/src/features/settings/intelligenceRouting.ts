import type { AnalysisAiSetupState } from "./analysisModelSetup";
import { normalizeOpenAiCompatibleBaseUrl } from "./localAiSetup";

export type AnalysisCredentialState = "idle" | "loading" | "ready" | "missing" | "error";
export type AnalysisUnavailableReason = "configuration" | "authentication" | "model_unavailable";

export interface IntelligenceRoute {
  readonly setup: AnalysisAiSetupState;
  readonly ready: boolean;
  readonly fallback: boolean;
  readonly reason: AnalysisUnavailableReason | "checking" | null;
}

/** This fingerprint stays in memory; it must never enter logs or persisted DTOs. */
export function analysisConnectionFingerprint(setup: AnalysisAiSetupState): string {
  switch (setup.provider) {
    case "cloud": return "cloud";
    case "openrouter": return JSON.stringify([setup.provider, setup.openRouterApiKey, setup.openRouterModel, setup.openRouterFallbackModels]);
    case "openai": return JSON.stringify([setup.provider, setup.openaiApiKey, setup.openaiModel]);
    case "anthropic": return JSON.stringify([setup.provider, setup.anthropicApiKey, setup.anthropicModel]);
    case "self_hosted": return JSON.stringify([setup.provider, setup.selfHostedBaseUrl, setup.selfHostedApiKey, setup.selfHostedModel]);
  }
}

export function resolveIntelligenceRoute(input: {
  readonly setup: AnalysisAiSetupState;
  readonly credentialState: AnalysisCredentialState;
  readonly cloudReady: boolean;
  /** Existing Classification selection opts this account into the Cloud route. */
  readonly cloudFallbackAllowed: boolean;
  readonly confirmedUnavailable?: AnalysisUnavailableReason | null;
}): IntelligenceRoute {
  const { setup } = input;
  if (setup.provider === "cloud") return { setup, ready: input.cloudReady, fallback: false, reason: null };

  // An OS read failure does not prove a missing key. Never change destinations
  // while credentials are still loading or their presence remains unknown.
  if (["idle", "loading", "error"].includes(input.credentialState)) {
    return { setup, ready: false, fallback: false, reason: "checking" };
  }
  const configured = setup.provider === "self_hosted"
    ? Boolean(normalizeOpenAiCompatibleBaseUrl(setup.selfHostedBaseUrl) && setup.selfHostedModel.trim())
    : setup.provider === "openrouter"
      ? input.credentialState === "ready" && Boolean(setup.openRouterModel.trim())
      : setup.provider === "openai"
        ? input.credentialState === "ready" && Boolean(setup.openaiModel.trim())
        : input.credentialState === "ready" && Boolean(setup.anthropicModel.trim());
  const reason = input.confirmedUnavailable ?? (configured ? null : "configuration");
  if (!reason) return { setup, ready: true, fallback: false, reason: null };
  if (input.cloudFallbackAllowed && input.cloudReady) {
    return { setup: { ...setup, provider: "cloud" }, ready: true, fallback: true, reason };
  }
  return { setup, ready: false, fallback: false, reason };
}

/** Only definite rejected requests permit another destination for this chunk. */
export function analysisUnavailableReasonFromHttp(status: number, body: unknown): AnalysisUnavailableReason | null {
  if (status === 401) return "authentication";
  let code = "";
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    if (parsed && typeof parsed === "object") {
      const error = (parsed as { error?: { code?: unknown; type?: unknown } }).error;
      code = String(error?.code ?? error?.type ?? "").toLowerCase();
    }
  } catch { /* An unstructured error does not establish a safe reroute. */ }
  if (["invalid_api_key", "authentication_error"].includes(code) && [400, 403].includes(status)) return "authentication";
  if (["model_not_found", "invalid_model", "model_not_available"].includes(code) && [400, 404].includes(status)) return "model_unavailable";
  return null;
}
