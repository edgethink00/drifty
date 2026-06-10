import type { BillingEntitlement } from "../billing/billingService";
import type { DashboardAiUnavailableInput } from "./DashboardAiUnavailableNotice";

export type DashboardAiUnavailablePreviewCase = "trial-ended" | "cloud-billing" | "provider-disconnected" | "connect-ai";

export type DashboardAiUnavailablePreviewOption = {
  readonly id: DashboardAiUnavailablePreviewCase;
  readonly label: string;
  readonly detail: string;
};

export type DashboardAiUnavailablePreviewState = {
  readonly caseId: DashboardAiUnavailablePreviewCase;
  readonly appliedDay: string;
};

export const DASHBOARD_AI_UNAVAILABLE_PREVIEW_OPTIONS = [
  {
    id: "trial-ended",
    label: "Trial ended",
    detail: "Cloud plan CTA and plan cards",
  },
  {
    id: "cloud-billing",
    label: "Billing issue",
    detail: "Cloud billing review CTA",
  },
  {
    id: "provider-disconnected",
    label: "Provider error",
    detail: "OpenRouter or local provider setup",
  },
  {
    id: "connect-ai",
    label: "Connect AI",
    detail: "No provider connected",
  },
] as const satisfies readonly DashboardAiUnavailablePreviewOption[];

const TRIAL_EXPIRED_ENTITLEMENT = {
  plan: "individual",
  status: "locked",
  canUseApp: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  lockedReason: "trial_expired",
} as const satisfies BillingEntitlement;

const BILLING_LOCKED_ENTITLEMENT = {
  ...TRIAL_EXPIRED_ENTITLEMENT,
  lockedReason: "payment_required",
} as const satisfies BillingEntitlement;

const CONNECTED_ENTITLEMENT = {
  plan: "individual",
  status: "active",
  canUseApp: true,
  trialEndsAt: null,
  currentPeriodEnd: null,
} as const satisfies BillingEntitlement;

export function buildDashboardAiUnavailablePreviewInput(caseId: DashboardAiUnavailablePreviewCase): DashboardAiUnavailableInput {
  switch (caseId) {
    case "trial-ended":
      return {
        billingEntitlement: TRIAL_EXPIRED_ENTITLEMENT,
        billingEntitlementError: null,
        billingEntitlementLoading: false,
        canUseCloudAiClassification: false,
        hasRequiredAccountAuth: true,
        isSupabaseConfigured: true,
        localAiReady: false,
        observedAiClassificationFailure: false,
      };
    case "cloud-billing":
      return {
        billingEntitlement: BILLING_LOCKED_ENTITLEMENT,
        billingEntitlementError: null,
        billingEntitlementLoading: false,
        canUseCloudAiClassification: false,
        hasRequiredAccountAuth: true,
        isSupabaseConfigured: true,
        localAiReady: false,
        observedAiClassificationFailure: false,
      };
    case "provider-disconnected":
      return {
        billingEntitlement: CONNECTED_ENTITLEMENT,
        billingEntitlementError: null,
        billingEntitlementLoading: false,
        canUseCloudAiClassification: false,
        hasRequiredAccountAuth: true,
        isSupabaseConfigured: true,
        localAiReady: true,
        observedAiClassificationFailure: true,
      };
    case "connect-ai":
      return {
        billingEntitlement: null,
        billingEntitlementError: null,
        billingEntitlementLoading: false,
        canUseCloudAiClassification: false,
        hasRequiredAccountAuth: false,
        isSupabaseConfigured: false,
        localAiReady: false,
        observedAiClassificationFailure: false,
      };
    default:
      return assertNever(caseId);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled dashboard AI preview case: ${value}`);
}
