import { describe, expect, it } from "vitest";

import type { BillingEntitlement } from "../billing/billingService";
import { resolveClassificationAvailability } from "../classification/classificationAvailability";
import { resolveDashboardAiUnavailableState } from "./dashboardAiUnavailableState";
import { buildDashboardAiUnavailablePreviewInput } from "./dashboardAiUnavailablePreview";

const trialExpiredEntitlement = {
  plan: "individual",
  status: "locked",
  canUseApp: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  lockedReason: "trial_expired",
} satisfies BillingEntitlement;

describe("resolveDashboardAiUnavailableState", () => {
  it("does not show trial recovery when the selected local provider is ready", () => {
    const classificationAvailability = resolveClassificationAvailability({
      route: "local",
      localProviderStatus: { kind: "connected" },
      localConsecutiveFailures: 0,
      localDisconnectConfirmed: false,
      cloudOnline: true,
      cloudConfigured: true,
      cloudAuthenticated: true,
      billingEntitlement: trialExpiredEntitlement,
      billingEntitlementLoading: false,
      billingEntitlementError: null,
      cloudConnectionCheck: null,
    });

    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: trialExpiredEntitlement,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: true,
      classificationAvailability,
    })).toBeNull();
  });

  it("keeps an offline Cloud route quiet instead of showing billing recovery", () => {
    const activeEntitlement = { ...trialExpiredEntitlement, status: "active", canUseApp: true, lockedReason: undefined } as const;
    const classificationAvailability = resolveClassificationAvailability({
      route: "cloud",
      localProviderStatus: { kind: "unconfigured" },
      localConsecutiveFailures: 0,
      localDisconnectConfirmed: false,
      cloudOnline: false,
      cloudConfigured: true,
      cloudAuthenticated: true,
      billingEntitlement: activeEntitlement,
      billingEntitlementLoading: false,
      billingEntitlementError: null,
      cloudConnectionCheck: null,
    });

    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: activeEntitlement,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: false,
      classificationAvailability,
    })).toBeNull();
  });

  it("routes trial expiration to plan recovery", () => {
    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: trialExpiredEntitlement,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: false,
    })).toMatchObject({ variant: "trial-ended", titleKey: "dashboard.aiRecovery.trialEndedTitle" });
  });

  it("keeps plan, billing, and device recovery reasons distinct", () => {
    const resolveLocked = (lockedReason: "payment_required" | "billing_missing" | "device_limit_reached") => resolveDashboardAiUnavailableState({
      billingEntitlement: { ...trialExpiredEntitlement, lockedReason },
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: false,
    });

    expect(resolveLocked("payment_required")).toMatchObject({ variant: "cloud-billing", ctaLabelKey: "dashboard.aiRecovery.fixBilling" });
    expect(resolveLocked("billing_missing")).toMatchObject({ variant: "cloud-plan", ctaLabelKey: "billing.plan.proCta" });
    expect(resolveLocked("device_limit_reached")?.variant).toBe("device-limit");
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
    })).toBeNull();

    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: trialExpiredEntitlement,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: true,
    })).toBeNull();
  });
});

describe("buildDashboardAiUnavailablePreviewInput", () => {
  it("marks one preview Cloud device as the current Mac for device-limit QA", () => {
    const input = buildDashboardAiUnavailablePreviewInput("device-limit");
    const devices = input.billingEntitlement?.cloudDevices ?? [];

    expect(devices.filter((device) => device.isCurrent)).toHaveLength(1);
    expect(devices.find((device) => device.label === "Studio Mac")?.isCurrent).toBe(true);
  });
});

it("routes an unused trial to AI setup without selling a plan or calling it expired", () => {
  expect(resolveDashboardAiUnavailableState({
    billingEntitlement: { ...trialExpiredEntitlement, lockedReason: "billing_missing", trialActivation: { state: "available", startedAt: null, endsAt: null } },
    billingEntitlementError: null, billingEntitlementLoading: false, canUseCloudAiClassification: false,
    hasRequiredAccountAuth: true, isSupabaseConfigured: true, localAiReady: false,
  })).toMatchObject({ variant: "connect-ai", titleKey: "billing.trialActivation.available" });
});
