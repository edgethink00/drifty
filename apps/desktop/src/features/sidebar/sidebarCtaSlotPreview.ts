import type { BillingEntitlement } from "../billing/billingService";
import type { ManagedLocalAiStatus } from "../settings/managedLocalAiClient";

/**
 * Dev-mode preview for the sidebar CTA slot.
 *
 * Each case builds a real `resolveSidebarCtaSlot` input rather than a canned
 * state object, so the preview exercises the same branching the app runs in
 * production. If a rule changes, the preview changes with it.
 */
export type SidebarCtaPreviewCase =
  | "ai-disconnected"
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
  { id: "ai-disconnected", label: "AI disconnected", detail: "Opens AI settings" },
  { id: "upgrade-local", label: "Free · local model", detail: "Upgrade to Pro" },
  { id: "upgrade-none", label: "Free · no AI", detail: "Add Drifty Cloud AI" },
  { id: "trial-3", label: "Trial · 3 days", detail: "No alert shadow" },
  { id: "trial-2", label: "Trial · 2 days", detail: "Amber shadow" },
  { id: "trial-1", label: "Trial · 1 day", detail: "Red shadow" },
  { id: "trial-ended", label: "Trial ended", detail: "Upgrade to Pro" },
  { id: "billing", label: "Billing issue", detail: "Upgrade to Pro" },
  { id: "device-limit", label: "Device limit", detail: "Manage devices" },
  { id: "model-download", label: "Model download", detail: "42% · status only" },
  { id: "byok-hidden", label: "BYOK · hidden", detail: "Slot stays empty" },
] as const satisfies readonly SidebarCtaPreviewOption[];

type PreviewInput = {
  readonly aiStatus: { readonly label: string; readonly tone: "ok" | "warning" | "error" | "neutral" };
  readonly billingCheckoutLoading: boolean;
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly localAiProvider: "managed_local" | "openrouter_byok" | "self_hosted";
  readonly localAiConfigured: boolean;
  readonly managedLocalAiStatus: ManagedLocalAiStatus | null;
  readonly now: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const HEALTHY_AI = { label: "Connected", tone: "ok" } as const;

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
    managedLocalAiStatus: null,
    now,
  } as const;

  switch (previewCase) {
    case "ai-disconnected":
      return { ...base, aiStatus: { label: "Connection issue", tone: "error" }, billingEntitlement: ACTIVE_ENTITLEMENT };
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
        },
      };
    case "byok-hidden":
      return { ...base, billingEntitlement: null, localAiProvider: "openrouter_byok" };
    default:
      return { ...base, billingEntitlement: null };
  }
}
