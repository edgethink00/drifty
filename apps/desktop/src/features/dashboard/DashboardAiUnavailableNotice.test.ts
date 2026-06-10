import { describe, expect, it } from "vitest";

import type { BillingEntitlement } from "../billing/billingService";
import { resolveDashboardAiUnavailableState } from "./DashboardAiUnavailableNotice";

const trialExpiredEntitlement = {
  plan: "individual",
  status: "locked",
  canUseApp: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  lockedReason: "trial_expired",
} satisfies BillingEntitlement;

describe("resolveDashboardAiUnavailableState", () => {
  it("routes trial expiration to plan selection", () => {
    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: trialExpiredEntitlement,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: false,
      observedAiClassificationFailure: false,
    })).toMatchObject({
      variant: "trial-ended",
      title: "Free trial ended",
      ctaLabel: "Choose a plan",
    });
  });

  it("routes billing locks to plan review without treating them as provider setup", () => {
    const paymentRequiredEntitlement = {
      ...trialExpiredEntitlement,
      lockedReason: "payment_required",
    } satisfies BillingEntitlement;

    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: paymentRequiredEntitlement,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: true,
      observedAiClassificationFailure: true,
    })).toMatchObject({
      variant: "cloud-billing",
      ctaLabel: "Review plans",
    });
  });

  it("routes disconnected local, auth, and provider states to Connect AI", () => {
    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: null,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: false,
      localAiReady: false,
      observedAiClassificationFailure: false,
    })?.variant).toBe("connect-ai");
  });

  it("stays quiet when cloud or local AI can run richer analysis", () => {
    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: null,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: true,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: false,
      observedAiClassificationFailure: false,
    })).toBeNull();

    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: null,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: true,
      observedAiClassificationFailure: false,
    })).toBeNull();
  });

  it("shows provider disconnected when a configured local provider has failed", () => {
    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: null,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: true,
      observedAiClassificationFailure: true,
    })).toMatchObject({
      variant: "provider-disconnected",
      ctaLabel: "Open AI setup",
    });
  });
});
