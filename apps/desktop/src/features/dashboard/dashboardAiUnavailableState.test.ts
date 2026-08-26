import { describe, expect, it } from "vitest";

import type { BillingEntitlement } from "../billing/billingService";
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
  it("routes trial expiration to plan recovery", () => {
    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: trialExpiredEntitlement,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: false,
    })).toMatchObject({ variant: "trial-ended", title: "Free trial ended" });
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

    expect(resolveLocked("payment_required")).toMatchObject({ variant: "cloud-billing", ctaLabel: "Fix billing" });
    expect(resolveLocked("billing_missing")).toMatchObject({ variant: "cloud-plan", ctaLabel: "Choose a plan" });
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
