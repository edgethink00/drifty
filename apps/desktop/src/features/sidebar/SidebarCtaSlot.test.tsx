// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { SidebarCtaSlot, resolveSidebarCtaSlot } from "./SidebarCtaSlot";

const activeEntitlement = {
  plan: "individual",
  status: "active",
  canUseApp: true,
  trialEndsAt: null,
  currentPeriodEnd: null,
} as const;

const NOW = Date.parse("2026-07-29T00:00:00.000Z");

const baseInput = {
  billingCheckoutLoading: false,
  billingEntitlementError: null,
  billingEntitlementLoading: false,
  localAiProvider: "managed_local",
  localAiConfigured: true,
  now: NOW,
} as const;

afterEach(cleanup);

describe("SidebarCtaSlot", () => {
  it("prioritizes a confirmed AI disconnection", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Connection issue", tone: "warning" },
      billingEntitlement: activeEntitlement,
    })).toMatchObject({ kind: "ai", titleKey: "sidebar.cta.ai.title", actionLabelKey: "sidebar.cta.ai.action", alert: "critical" });
  });

  it("sells accuracy to a free user already running a local model", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "AI setup needed", tone: "error" },
      billingEntitlement: null,
    })).toMatchObject({
      kind: "upgrade",
      titleKey: "sidebar.cta.upgrade.localTitle",
      actionLabelKey: "sidebar.cta.upgrade.action",
      alert: null,
    });
  });

  it("sells the capability itself when no provider is configured", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "AI setup needed", tone: "error" },
      billingEntitlement: null,
      localAiConfigured: false,
    })).toMatchObject({ kind: "upgrade", titleKey: "sidebar.cta.upgrade.noAiTitle" });
  });

  // Someone who brought their own key or runs their own endpoint has already
  // opted out of paying us for inference, so there is nothing to sell.
  it.each(["openrouter_byok", "self_hosted"] as const)("stays empty for %s free users", (localAiProvider) => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "AI setup needed", tone: "error" },
      billingEntitlement: null,
      localAiProvider,
    })).toBeNull();
  });

  it("does not turn an unrelated Cloud billing failure into a BYOK recovery CTA", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Connection issue", tone: "warning" },
      billingEntitlement: null,
      billingEntitlementError: "Network connection failed while checking billing.",
      localAiConfigured: false,
      localAiProvider: "openrouter_byok",
    })).toBeNull();
  });

  it.each(["openrouter_byok", "self_hosted"] as const)("hides expired Cloud monetization from %s users", (localAiProvider) => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Connected", tone: "ok" },
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
      localAiProvider,
    })).toBeNull();
  });

  it("still recovers a disconnected BYOK provider without showing Cloud monetization", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Issue", tone: "error" },
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
      localAiProvider: "openrouter_byok",
    })).toMatchObject({ kind: "ai", actionLabelKey: "sidebar.cta.ai.action" });
  });

  it("counts down the trial and escalates the alert as it closes", () => {
    const trialing = (trialEndsAt: string) => resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Connected", tone: "ok" },
      billingEntitlement: { ...activeEntitlement, status: "trialing", trialEndsAt },
    });

    expect(trialing("2026-08-01T00:00:00.000Z")).toMatchObject({
      kind: "trial",
      titleKey: "sidebar.cta.trial.title",
      titleEmphasisCount: 3,
      actionLabelKey: "sidebar.cta.upgrade.action",
      alert: null,
    });
    expect(trialing("2026-07-31T00:00:00.000Z")).toMatchObject({ titleEmphasisCount: 2, alert: "warn" });
    expect(trialing("2026-07-30T00:00:00.000Z")).toMatchObject({ titleEmphasisCount: 1, alert: "critical" });
  });

  it("keeps an elapsed Cloud trial in the ended state before the backend lock arrives", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Connected", tone: "ok" },
      billingEntitlement: { ...activeEntitlement, status: "trialing", trialEndsAt: "2026-07-28T00:00:00.000Z" },
    })).toMatchObject({
      kind: "trial-ended",
      titleKey: "sidebar.cta.trialEnded.title",
      actionLabelKey: "sidebar.cta.upgrade.action",
    });
  });

  it("surfaces each locked reason with its own recovery action", () => {
    const locked = (lockedReason: "trial_expired" | "payment_required" | "device_limit_reached") => resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Connected", tone: "ok" },
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason },
    });

    expect(locked("trial_expired")).toMatchObject({
      kind: "trial-ended",
      titleKey: "sidebar.cta.trialEnded.title",
      actionLabelKey: "sidebar.cta.upgrade.action",
      alert: "critical",
    });
    expect(locked("payment_required")).toMatchObject({
      kind: "billing",
      titleKey: "sidebar.cta.billing.title",
      actionLabelKey: "sidebar.cta.upgrade.action",
    });
    expect(locked("device_limit_reached")).toMatchObject({
      kind: "device-limit",
      titleKey: "sidebar.cta.device.title",
      actionLabelKey: "sidebar.cta.device.action",
      alert: "warn",
    });
  });

  it("prioritizes an explicit billing lock over a simultaneous AI warning", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Connection issue", tone: "warning" },
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "payment_required" },
    })).toMatchObject({ kind: "billing", titleKey: "sidebar.cta.billing.title" });
  });

  it("does not mistake an unresolved entitlement request for a free account or AI disconnect", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Connection issue", tone: "warning" },
      billingEntitlement: null,
      billingEntitlementError: "Network connection failed while checking billing.",
      localAiConfigured: false,
    })).toBeNull();
  });

  it("still surfaces a configured local provider failure during a billing request failure", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Issue", tone: "error" },
      billingEntitlement: null,
      billingEntitlementError: "Network connection failed while checking billing.",
      localAiConfigured: true,
    })).toMatchObject({ kind: "ai" });
  });

  it("stays empty for a healthy active plan", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { label: "Connected", tone: "ok" },
      billingEntitlement: activeEntitlement,
    })).toBeNull();
  });

  it("renders one accessible whole-surface action", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<SidebarCtaSlot
      state={{
        actionLabelKey: "sidebar.cta.upgrade.action",
        alert: "warn",
        copyKey: "sidebar.cta.trial.detail",
        direction: "external",
        disabled: false,
        kind: "trial",
        titleKey: "sidebar.cta.trial.title",
        titleEmphasisCount: 2,
        tone: "trial",
      }}
      onAction={onAction}
      onDismiss={onDismiss}
    />);

    const action = screen.getByRole("button", { name: /Trial ends in 2 days.*Upgrade to Pro/i });
    expect(action.getAttribute("data-kind")).toBe("trial");
    expect(action.getAttribute("data-alert")).toBe("warn");
    expect(action.textContent).toContain("2 days");
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss upgrade" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("localizes the complete CTA state instead of only its action", () => {
    render(
      <LocalizationTestProvider language="ko">
        <SidebarCtaSlot
          state={{
            actionLabelKey: "sidebar.cta.upgrade.action",
            alert: "critical",
            copyKey: "sidebar.cta.trial.detail",
            direction: "external",
            disabled: false,
            kind: "trial",
            titleKey: "sidebar.cta.trial.title",
            titleEmphasisCount: 1,
            tone: "trial",
          }}
          onAction={vi.fn()}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("button", { name: /무료 체험 종료까지 1일.*Pro로 업그레이드/ })).toBeTruthy();
  });
});
