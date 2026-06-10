import type { BillingEntitlement } from "../billing/billingService";
import type { AiClassificationUsageSummary } from "../classification/aiClassificationService";
import type { LocalAiSetupState } from "../settings/localAiSetup";

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
  if (entitlement?.status === "locked") return "Needs attention";
  return "Available";
}

export function driftyCloudActionLabel(
  entitlement: BillingEntitlement | null,
  isConfigured: boolean,
  hasAccount: boolean,
): string | null {
  if (!isConfigured || !hasAccount || entitlement?.status !== "locked") return null;
  if (entitlement.lockedReason === "payment_required") return "Resolve billing";
  if (entitlement.lockedReason === "billing_missing") return "Set up billing";
  return "Subscribe";
}

export function driftyCloudSetupActionLabel(
  entitlement: BillingEntitlement | null,
  isConfigured: boolean,
  hasAccount: boolean,
): string {
  if (!isConfigured) return "Configure Supabase";
  if (!hasAccount) return "Continue on drifty.so";
  if (entitlement?.status === "locked") return driftyCloudActionLabel(entitlement, isConfigured, hasAccount) ?? "Subscribe";
  return "Refresh Drifty Cloud";
}

export function aiConnectionStatusLabel(
  localAiSetup: LocalAiSetupState,
  entitlement: BillingEntitlement | null,
  cloudLoading: boolean,
  hasAccount: boolean,
): string {
  if (hasAccount && cloudLoading) return "AI checking";
  if (hasAccount && entitlement?.status !== "locked") return "Drifty Cloud AI";
  if (localAiSetup.provider === "openrouter_byok") return localAiSetup.openRouterApiKey.trim() ? "OpenRouter AI" : "AI not connected";
  const hasSelfHostedConnection = Boolean(localAiSetup.selfHostedBaseUrl.trim() && localAiSetup.selfHostedModel.trim());
  return hasSelfHostedConnection ? "Self-hosted AI" : "AI not connected";
}
