import { canStartCloudTrial } from "../billing/billingEligibility";
import type { BillingEntitlement } from "../billing/billingService";
import type { TranslationKey } from "../localization/translations";
import type { ClassificationAvailability } from "../classification/classificationAvailability";

export type DashboardAiUnavailableVariant = "trial-ended" | "cloud-plan" | "cloud-billing" | "device-limit" | "connect-ai";
export const DASHBOARD_CLOUD_BILLING_VARIANTS = ["trial-ended", "cloud-plan", "cloud-billing"] as const;

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
  readonly classificationAvailability?: ClassificationAvailability;
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
  if (input.classificationAvailability) {
    const availability = input.classificationAvailability;
    if (availability.route === "local") {
      return availability.state === "unavailable" ? CONNECT_AI_STATE : null;
    }
    if (availability.state === "ready" || availability.state === "checking" || availability.state === "retrying" || availability.state === "degraded") {
      return null;
    }
  }
  if (input.localAiReady) return null;
  if (input.canUseCloudAiClassification) return null;
  if (canStartCloudTrial(input.billingEntitlement)) return {
    variant: "connect-ai", titleKey: "billing.trialActivation.available",
    bodyKey: "billing.trialActivation.availableBody", ctaLabelKey: "sidebar.cta.ai.action",
  };
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
  return DASHBOARD_CLOUD_BILLING_VARIANTS.some((candidate) => candidate === variant);
}
