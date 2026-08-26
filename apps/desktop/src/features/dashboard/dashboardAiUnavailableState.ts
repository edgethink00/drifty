import type { BillingEntitlement } from "../billing/billingService";

export type DashboardAiUnavailableVariant = "trial-ended" | "cloud-plan" | "cloud-billing" | "device-limit" | "connect-ai";

export type DashboardAiUnavailableState = {
  readonly variant: DashboardAiUnavailableVariant;
  readonly title: string;
  readonly body: string;
  readonly ctaLabel: string;
};

export type DashboardAiUnavailableInput = {
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly canUseCloudAiClassification: boolean;
  readonly hasRequiredAccountAuth: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly localAiReady: boolean;
};

const TRIAL_ENDED_STATE = {
  variant: "trial-ended",
  title: "Free trial ended",
  body: "Your local timeline, predefined rules, and local rules are still shown. Choose a plan to resume richer Drifty Cloud AI analysis.",
  ctaLabel: "Choose a plan",
} satisfies DashboardAiUnavailableState;

const CLOUD_BILLING_STATE = {
  variant: "cloud-billing",
  title: "Drifty Cloud billing needs attention",
  body: "Your local timeline, predefined rules, and local rules are still shown. Update the payment on this subscription to resume richer Cloud AI analysis.",
  ctaLabel: "Fix billing",
} satisfies DashboardAiUnavailableState;

const CLOUD_PLAN_STATE = {
  variant: "cloud-plan",
  title: "Choose a Drifty Cloud plan",
  body: "Your local timeline, predefined rules, and local rules are still shown. Choose Pro to resume richer Drifty Cloud AI analysis.",
  ctaLabel: "Choose a plan",
} satisfies DashboardAiUnavailableState;

const DEVICE_LIMIT_STATE = {
  variant: "device-limit",
  title: "Drifty Cloud device limit reached",
  body: "Your local timeline, predefined rules, and local rules are still shown. Pro includes 2 active desktop devices. Remove an old device to use Cloud AI here.",
  ctaLabel: "Manage devices",
} satisfies DashboardAiUnavailableState;

const CONNECT_AI_STATE = {
  variant: "connect-ai",
  title: "Connect an AI provider",
  body: "Your local timeline, predefined rules, and local rules are still shown. Richer AI analysis is unavailable until Cloud AI or a local provider is connected.",
  ctaLabel: "Connect AI",
} satisfies DashboardAiUnavailableState;

export function resolveDashboardAiUnavailableState(input: DashboardAiUnavailableInput): DashboardAiUnavailableState | null {
  if (input.localAiReady) return null;
  if (input.canUseCloudAiClassification) return null;
  if (input.billingEntitlement?.status === "locked") {
    if (input.billingEntitlement.lockedReason === "device_limit_reached") return DEVICE_LIMIT_STATE;
    if (input.billingEntitlement.lockedReason === "trial_expired") return TRIAL_ENDED_STATE;
    return input.billingEntitlement.lockedReason === "payment_required" ? CLOUD_BILLING_STATE : CLOUD_PLAN_STATE;
  }
  if (input.billingEntitlementLoading && input.isSupabaseConfigured && input.hasRequiredAccountAuth) return null;
  if (input.billingEntitlementError) return CONNECT_AI_STATE;
  if (!input.isSupabaseConfigured || !input.hasRequiredAccountAuth) return CONNECT_AI_STATE;
  return CONNECT_AI_STATE;
}

export function isCloudBillingVariant(variant: DashboardAiUnavailableVariant): boolean {
  return variant === "trial-ended" || variant === "cloud-plan" || variant === "cloud-billing";
}
