// @vitest-environment jsdom

import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BillingEntitlement } from "../billing/billingService";
import { DashboardAiUnavailableNotice, resolveDashboardAiUnavailableState } from "./DashboardAiUnavailableNotice";

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

describe("DashboardAiUnavailableNotice", () => {
  it("renders the setup-needed notice with a visible non-color status cue", () => {
    const onAction = vi.fn();

    render(createElement(
      DashboardAiUnavailableNotice,
      {
        state: {
          variant: "connect-ai",
          title: "Connect an AI provider",
          body: "Richer AI analysis is unavailable until Cloud AI or a local provider is connected.",
          ctaLabel: "Connect AI",
        },
        onAction,
      },
    ));

    const notice = screen.getByLabelText(/AI unavailable notice/i);
    expect(within(notice).getByText(/^AI setup needed$/i)).toBeTruthy();
    expect(notice.querySelector(".dashboard-ai-notice__signal")).toBeTruthy();
    expect(notice.querySelector(".dashboard-ai-notice__signal-dot")).toBeTruthy();
  });
});
