import { canStartCloudTrial } from "../billing/billingEligibility";
import type { BillingEntitlement } from "../billing/billingService";
import type { AiClassificationUsageSummary } from "../classification/aiClassificationService";
import { isManagedLocalAiRoute, type LocalAiSetupState } from "../settings/localAiSetup";

export function formatAiErrorDetail(usage: AiClassificationUsageSummary): string {
  const parts = [
    usage.lastErrorType ? `type=${usage.lastErrorType}` : null,
    usage.lastErrorStatus ? `status=${usage.lastErrorStatus}` : null,
    usage.lastErrorAt ? `at=${new Date(usage.lastErrorAt).toLocaleString()}` : null,
    usage.lastErrorMessage ? `message=${usage.lastErrorMessage}` : "message unavailable for older errors",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function hasAiClassificationUsageMeasurement(usage: AiClassificationUsageSummary): boolean {
  return usage.itemsRequested > 0 || usage.estimatedCostUsd > 0;
}

export function formatTokenCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatUsdCost(value: number): string {
  if (value <= 0) return "$0.0000";
  if (value < 0.0001) return "<$0.0001";
  return `$${value.toFixed(4)}`;
}

export function formatProjectionMultiplier(value: number): string {
  if (value <= 0) return "0x";
  if (Number.isInteger(value)) return `${value.toLocaleString("en-US")}x`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}x`;
}

export function driftyCloudStatusLabel(
  entitlement: BillingEntitlement | null,
  loading: boolean,
  isConfigured: boolean,
  hasAccount: boolean,
): string {
  if (!isConfigured) return "Cloud off";
  if (!hasAccount) return "Sign-in needed";
  if (loading) return "Checking cloud";
  if (canStartCloudTrial(entitlement)) return "Cloud trial available";
  if (entitlement?.status === "locked") return "Drifty Cloud needs attention";
  return "Drifty Cloud is connected";
}

export function aiServerStatusLabelForCloud(
  entitlement: BillingEntitlement | null,
  loading: boolean,
  isConfigured: boolean,
  hasAccount: boolean,
): string {
  if (!isConfigured) return "Not configured";
  if (!hasAccount) return "Sign-in needed";
  if (loading) return "Checking";
  if (canStartCloudTrial(entitlement)) return "Trial available";
  if (entitlement?.status === "locked") return "Needs attention";
  return "Available";
}

export function aiConnectionStatusLabel(
  localAiSetup: LocalAiSetupState,
  entitlement: BillingEntitlement | null,
  cloudLoading: boolean,
  hasAccount: boolean,
): string {
  if (hasAccount && cloudLoading) return "AI checking";
  if (hasAccount && entitlement?.status !== "locked") return "Drifty Cloud AI";
  switch (localAiSetup.provider) {
    case "managed_local":
      if (!isManagedLocalAiRoute(localAiSetup)) return "AI not connected";
      return localAiSetup.managedLocalBaseUrl.trim() && localAiSetup.managedLocalModel.trim() ? "Managed Local AI" : "AI not connected";
    case "openrouter_byok":
      return localAiSetup.openRouterApiKey.trim() ? "OpenRouter AI" : "AI not connected";
    case "self_hosted":
      return localAiSetup.selfHostedBaseUrl.trim() && localAiSetup.selfHostedModel.trim() ? "Local AI" : "AI not connected";
    default:
      return assertNever(localAiSetup.provider);
  }
}

class AiConnectionStatusLabelError extends Error {
  constructor(readonly provider: string) {
    super(`Unhandled AI connection provider: ${provider}`);
    this.name = "AiConnectionStatusLabelError";
  }
}

function assertNever(value: never): never {
  throw new AiConnectionStatusLabelError(String(value));
}
