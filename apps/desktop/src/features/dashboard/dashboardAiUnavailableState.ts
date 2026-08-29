import type { BillingEntitlement } from "../billing/billingService";
import type { TranslationKey } from "../localization/translations";

export type DashboardAiUnavailableVariant = "trial-ended" | "cloud-plan" | "cloud-billing" | "device-limit" | "connect-ai";

export type DashboardAiUnavailableState = {
  readonly variant: DashboardAiUnavailableVariant;
  readonly titleKey: TranslationKey;
  readonly bodyKey: TranslationKey;
  readonly ctaLabelKey: TranslationKey;
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
  titleKey: "dashboard.aiRecovery.trialEndedTitle",
  bodyKey: "dashboard.aiRecovery.trialEndedBody",
  ctaLabelKey: "billing.plan.proCta",
} satisfies DashboardAiUnavailableState;

const CLOUD_BILLING_STATE = {
  variant: "cloud-billing",
  titleKey: "dashboard.aiRecovery.billingTitle",
  bodyKey: "dashboard.aiRecovery.billingBody",
  ctaLabelKey: "dashboard.aiRecovery.fixBilling",
} satisfies DashboardAiUnavailableState;

const CLOUD_PLAN_STATE = {
  variant: "cloud-plan",
  titleKey: "dashboard.aiRecovery.planTitle",
  bodyKey: "dashboard.aiRecovery.planBody",
  ctaLabelKey: "billing.plan.proCta",
} satisfies DashboardAiUnavailableState;

const DEVICE_LIMIT_STATE = {
  variant: "device-limit",
  titleKey: "dashboard.aiRecovery.deviceTitle",
  bodyKey: "dashboard.aiRecovery.deviceBody",
  ctaLabelKey: "sidebar.cta.device.action",
} satisfies DashboardAiUnavailableState;

const CONNECT_AI_STATE = {
  variant: "connect-ai",
  titleKey: "dashboard.aiRecovery.connectTitle",
  bodyKey: "dashboard.aiRecovery.connectBody",
  ctaLabelKey: "sidebar.cta.ai.action",
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
