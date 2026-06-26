// @vitest-environment jsdom

import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { readAppStyles } from "../../test/readStyles";
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
      localAiReady: false,
      observedAiClassificationFailure: false,
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
      billingEntitlement: trialExpiredEntitlement,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: false,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: true,
      observedAiClassificationFailure: false,
    })).toBeNull();

    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: null,
      billingEntitlementError: null,
      billingEntitlementLoading: false,
      canUseCloudAiClassification: true,
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      localAiReady: true,
      observedAiClassificationFailure: true,
    })).toBeNull();
  });

  it("routes failed local AI ahead of locked Cloud billing", () => {
    expect(resolveDashboardAiUnavailableState({
      billingEntitlement: trialExpiredEntitlement,
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
    const heading = notice.querySelector(".dashboard-ai-notice__heading");
    const titleRow = notice.querySelector(".dashboard-ai-notice__title-row");
    const body = notice.querySelector(".dashboard-ai-notice__body");

    expect(heading).toBeTruthy();
    expect(titleRow).toBeTruthy();
    expect(body).toBeTruthy();
    expect(within(notice).queryByText(/^AI setup needed$/i)).toBeNull();
    expect(within(notice).getByText(/^Connect an AI provider$/i)).toBeTruthy();
    expect(within(heading as HTMLElement).getByRole("button", { name: /^Connect AI$/i })).toBeTruthy();
    expect(within(heading as HTMLElement).getByText(/Richer AI analysis is unavailable/i)).toBeTruthy();
    expect(titleRow?.querySelector(".dashboard-ai-notice__signal")).toBeTruthy();
    expect(titleRow?.querySelector(".dashboard-ai-notice__signal-dot")).toBeTruthy();
    expect(titleRow?.firstElementChild?.classList.contains("dashboard-ai-notice__signal")).toBe(true);
  });

  it("keeps the notice surface lightly tinted with an outline rim and outer shadow", () => {
    const styles = readAppStyles();
    const noticeBlocks = Array.from(
      styles.matchAll(/\.dashboard-ai-notice\s*\{(?<body>[\s\S]*?)\n\}/g),
      (match) => match.groups?.body ?? "",
    );
    const surfaceBlocks = noticeBlocks.filter((block) => block.includes("--dashboard-ai-notice-panel:"));
    const finalNoticeBlock = surfaceBlocks[surfaceBlocks.length - 1] ?? "";

    expect(finalNoticeBlock).toContain("--dashboard-ai-notice-panel: color-mix(in srgb, var(--surface) 91%, var(--dashboard-ai-notice-soft));");
    expect(finalNoticeBlock).toContain("--dashboard-ai-notice-panel-edge: color-mix(in srgb, var(--surface) 94%, var(--dashboard-ai-notice-soft));");
    expect(finalNoticeBlock).toContain("border: 1px solid transparent;");
    expect(finalNoticeBlock).toContain("var(--dashboard-ai-notice-rim) border-box;");
    expect(finalNoticeBlock).toContain("0 6px 14px color-mix(in srgb, var(--text) 4%, transparent)");
    expect(finalNoticeBlock).toContain("0 3px 8px color-mix(in srgb, var(--dashboard-ai-notice-accent) 5%, transparent)");
  });
});
