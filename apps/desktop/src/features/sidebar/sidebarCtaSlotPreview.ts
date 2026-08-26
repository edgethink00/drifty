import type { BillingEntitlement } from "../billing/billingService";
import type { AiConnectionIssueKind } from "../ai-connection/aiConnectionHealth";
import type { ManagedLocalAiStatus } from "../settings/managedLocalAiClient";

/**
 * Dev-mode preview for the sidebar CTA slot.
 *
 * Each case builds a real `resolveSidebarCtaSlot` input rather than a canned
 * state object, so the preview exercises the same branching the app runs in
 * production. If a rule changes, the preview changes with it.
 */
export type SidebarCtaPreviewCase =
  | "ai-network-transient"
  | "ai-network"
  | "ai-provider"
  | "openrouter-key"
  | "openrouter-credits"
  | "openrouter-access"
  | "openrouter-model-unavailable"
  | "openrouter-rate-limited"
  | "openrouter-unavailable"
  | "local-download-failed"
  | "local-model-missing"
  | "local-memory"
  | "local-storage"
  | "local-runtime-missing"
  | "local-runtime-failed"
  | "upgrade-local"
  | "upgrade-none"
  | "trial-3"
  | "trial-2"
  | "trial-1"
  | "trial-ended"
  | "billing"
  | "device-limit"
  | "model-download"
  | "byok-hidden";

export type SidebarCtaPreviewOption = {
  readonly id: SidebarCtaPreviewCase;
  readonly label: string;
  readonly detail: string;
};

export const SIDEBAR_CTA_PREVIEW_OPTIONS = [
  { id: "ai-network-transient", label: "AI · reconnecting", detail: "Topbar only · sidebar stays clear" },
  { id: "ai-network", label: "AI · network issue", detail: "Confirmed after repeated failures" },
  { id: "ai-provider", label: "AI · provider issue", detail: "Check-settings copy" },
  { id: "openrouter-key", label: "OpenRouter · key", detail: "Update API key" },
  { id: "openrouter-credits", label: "OpenRouter · credits", detail: "Add credits" },
  { id: "openrouter-access", label: "OpenRouter · access", detail: "Check permissions and guardrails" },
  { id: "openrouter-model-unavailable", label: "OpenRouter · model unavailable", detail: "Choose another model" },
  { id: "openrouter-rate-limited", label: "OpenRouter · rate limited", detail: "Topbar only · automatic retry" },
  { id: "openrouter-unavailable", label: "OpenRouter · unavailable", detail: "Topbar only · automatic retry" },
  { id: "local-download-failed", label: "Local AI · download failed", detail: "Retry in AI settings" },
  { id: "local-model-missing", label: "Local AI · model missing", detail: "Reinstall in AI settings" },
  { id: "local-memory", label: "Local AI · memory", detail: "Choose a smaller model" },
  { id: "local-storage", label: "Local AI · storage", detail: "Free up storage" },
  { id: "local-runtime-missing", label: "Local AI · runtime missing", detail: "Reinstall Local AI" },
  { id: "local-runtime-failed", label: "Local AI · start failed", detail: "Restart Local AI" },
  { id: "upgrade-local", label: "Free · local model", detail: "Upgrade to Pro" },
  { id: "upgrade-none", label: "Free · no AI", detail: "Add Drifty Cloud AI" },
  { id: "trial-3", label: "Trial · 3 days", detail: "No alert shadow" },
  { id: "trial-2", label: "Trial · 2 days", detail: "Amber shadow" },
  { id: "trial-1", label: "Trial · 1 day", detail: "Red shadow" },
  { id: "trial-ended", label: "Trial ended", detail: "Upgrade to Pro" },
  { id: "billing", label: "Billing issue", detail: "Fix billing" },
  { id: "device-limit", label: "Device limit", detail: "Manage devices" },
  { id: "model-download", label: "Model download", detail: "42% · status only" },
  { id: "byok-hidden", label: "BYOK · hidden", detail: "Slot stays empty" },
] as const satisfies readonly SidebarCtaPreviewOption[];

type PreviewInput = {
  readonly aiStatus: {
    readonly issueKind: AiConnectionIssueKind | null;
    readonly label: string;
    readonly providerLabel: string;
    readonly tone: "ok" | "warning" | "error" | "neutral";
  };
  readonly billingCheckoutLoading: boolean;
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly localAiProvider: "managed_local" | "openrouter_byok" | "self_hosted";
  readonly localAiConfigured: boolean;
  readonly localAiDisconnectConfirmed: boolean;
  readonly managedLocalAiStatus: ManagedLocalAiStatus | null;
  readonly now: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const HEALTHY_AI = { issueKind: null, label: "Connected", providerLabel: "Qwen 3.5 4B", tone: "ok" } as const;

const ACTIVE_ENTITLEMENT = {
  plan: "individual",
  status: "active",
  canUseApp: true,
  trialEndsAt: null,
  currentPeriodEnd: null,
} as const satisfies BillingEntitlement;

function trialingEntitlement(now: number, days: number): BillingEntitlement {
  // Nudge past the exact boundary so the ceil-based day count lands on `days`.
  return {
    ...ACTIVE_ENTITLEMENT,
    status: "trialing",
    trialEndsAt: new Date(now + (days - 0.5) * MS_PER_DAY).toISOString(),
  };
}

function lockedEntitlement(lockedReason: BillingEntitlement["lockedReason"]): BillingEntitlement {
  return { ...ACTIVE_ENTITLEMENT, status: "locked", canUseApp: false, lockedReason };
}

export function buildSidebarCtaPreviewInput(previewCase: SidebarCtaPreviewCase, now: number): PreviewInput {
  const base = {
    aiStatus: HEALTHY_AI,
    billingCheckoutLoading: false,
    billingEntitlementError: null,
    billingEntitlementLoading: false,
    localAiProvider: "managed_local",
    localAiConfigured: true,
    localAiDisconnectConfirmed: true,
    managedLocalAiStatus: null,
    now,
  } as const;

  switch (previewCase) {
    case "ai-network-transient":
      return {
        ...base,
        aiStatus: { issueKind: "network", label: "Reconnecting", providerLabel: "DeepSeek V4 Flash BYOK", tone: "warning" },
        billingEntitlement: ACTIVE_ENTITLEMENT,
        localAiDisconnectConfirmed: false,
        localAiProvider: "openrouter_byok",
      };
    case "ai-network":
      return {
        ...base,
        aiStatus: { issueKind: "network", label: "Connection issue", providerLabel: "DeepSeek V4 Flash BYOK", tone: "warning" },
        billingEntitlement: ACTIVE_ENTITLEMENT,
        localAiProvider: "openrouter_byok",
      };
    case "ai-provider":
      return {
        ...base,
        aiStatus: { issueKind: "provider", label: "Issue", providerLabel: "DeepSeek V4 Flash BYOK", tone: "error" },
        billingEntitlement: ACTIVE_ENTITLEMENT,
        localAiDisconnectConfirmed: false,
        localAiProvider: "openrouter_byok",
      };
    case "openrouter-key":
      return openRouterIssuePreview(base, "authentication", "Key issue");
    case "openrouter-credits":
      return openRouterIssuePreview(base, "credits", "Credits needed");
    case "openrouter-access":
      return openRouterIssuePreview(base, "access", "Access blocked");
    case "openrouter-model-unavailable":
      return openRouterIssuePreview(base, "model_unavailable", "Model unavailable");
    case "openrouter-rate-limited":
      return openRouterIssuePreview(base, "rate_limited", "Rate limited", "warning");
    case "openrouter-unavailable":
      return openRouterIssuePreview(base, "unavailable", "Provider unavailable", "warning");
    case "local-download-failed":
      return {
        ...base,
        billingEntitlement: ACTIVE_ENTITLEMENT,
        managedLocalAiStatus: managedLocalError("download_failed", "Managed local model download failed."),
      };
    case "local-model-missing":
      return {
        ...base,
        billingEntitlement: ACTIVE_ENTITLEMENT,
        managedLocalAiStatus: managedLocalError("model_artifact_missing", "Managed local model artifact is missing."),
      };
    case "local-memory":
      return {
        ...base,
        billingEntitlement: ACTIVE_ENTITLEMENT,
        managedLocalAiStatus: managedLocalError("insufficient_memory", "Selected local model requires more memory than this computer has."),
      };
    case "local-storage":
      return {
        ...base,
        billingEntitlement: ACTIVE_ENTITLEMENT,
        managedLocalAiStatus: managedLocalError("insufficient_storage", "Not enough free storage to download the selected local model."),
      };
    case "local-runtime-missing":
      return {
        ...base,
        billingEntitlement: ACTIVE_ENTITLEMENT,
        managedLocalAiStatus: managedLocalError("runtime_missing", "Managed local AI runtime is missing."),
      };
    case "local-runtime-failed":
      return {
        ...base,
        billingEntitlement: ACTIVE_ENTITLEMENT,
        managedLocalAiStatus: managedLocalError("runtime_failed", "Managed local AI runtime failed to start."),
      };
    case "upgrade-local":
      return { ...base, billingEntitlement: null };
    case "upgrade-none":
      return { ...base, billingEntitlement: null, localAiConfigured: false };
    case "trial-3":
      return { ...base, billingEntitlement: trialingEntitlement(now, 3) };
    case "trial-2":
      return { ...base, billingEntitlement: trialingEntitlement(now, 2) };
    case "trial-1":
      return { ...base, billingEntitlement: trialingEntitlement(now, 1) };
    case "trial-ended":
      return { ...base, billingEntitlement: lockedEntitlement("trial_expired") };
    case "billing":
      return { ...base, billingEntitlement: lockedEntitlement("payment_required") };
    case "device-limit":
      return { ...base, billingEntitlement: lockedEntitlement("device_limit_reached") };
    case "model-download":
      return {
        ...base,
        billingEntitlement: ACTIVE_ENTITLEMENT,
        managedLocalAiStatus: {
          state: "installing",
          selectedModelId: "drifty-qwen3-5-4b-default",
          installedModels: [],
          baseUrl: null,
          model: null,
          message: "Downloading managed local model... (42%)",
          artifactDir: null,
          progress: { percent: 42, downloadedBytes: 1_176_000_000, totalBytes: 2_800_000_000 },
          errorKind: null,
          memoryUsageBytes: null,
          requiredResourceBytes: null,
          availableResourceBytes: null,
        },
      };
    case "byok-hidden":
      return { ...base, billingEntitlement: null, localAiProvider: "openrouter_byok" };
    default:
      return { ...base, billingEntitlement: null };
  }
}

function openRouterIssuePreview(
  base: Omit<PreviewInput, "billingEntitlement">,
  issueKind: AiConnectionIssueKind,
  label: string,
  tone: "error" | "warning" = "error",
): PreviewInput {
  return {
    ...base,
    aiStatus: { issueKind, label, providerLabel: "DeepSeek V4 Flash BYOK", tone },
    billingEntitlement: ACTIVE_ENTITLEMENT,
    localAiDisconnectConfirmed: true,
    localAiProvider: "openrouter_byok",
  };
}

function managedLocalError(
  errorKind: NonNullable<ManagedLocalAiStatus["errorKind"]>,
  message: string,
): ManagedLocalAiStatus {
  const resource = errorKind === "insufficient_memory"
    ? { requiredResourceBytes: 8 * 1024 ** 3, availableResourceBytes: 4 * 1024 ** 3 }
    : errorKind === "insufficient_storage"
      ? { requiredResourceBytes: 6 * 1024 ** 3, availableResourceBytes: 1.8 * 1024 ** 3 }
      : { requiredResourceBytes: null, availableResourceBytes: null };
  return {
    state: "error",
    selectedModelId: "drifty-qwen3-5-4b-default",
    installedModels: [],
    baseUrl: null,
    model: null,
    message,
    artifactDir: null,
    progress: null,
    errorKind,
    memoryUsageBytes: null,
    ...resource,
  };
}
