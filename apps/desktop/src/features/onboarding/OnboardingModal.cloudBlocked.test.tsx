// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingEntitlement } from "../billing/billingService";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { DEFAULT_LOCAL_AI_SETUP } from "../settings/localAiSetup";
import { OnboardingModal } from "./OnboardingModal";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const expired = {
  plan: "individual", status: "locked", canUseApp: false, lockedReason: "trial_expired",
  trialEndsAt: null, currentPeriodEnd: null, trialActivation: { state: "unavailable", startedAt: null, endsAt: null },
} as BillingEntitlement;

function renderReady(billing: { entitlement: BillingEntitlement | null; error?: string | null; loading?: boolean }, refresh = vi.fn().mockResolvedValue(null)) {
  render(
    <LocalizationTestProvider language="en">
      <OnboardingModal
        userId="cloud-blocked-user"
        accountConnected
        initialDisplayName="QA"
        trackerStatus={null}
        accessibilityGranted
        accessibilityRequired={false}
        onStartTracking={vi.fn().mockResolvedValue(undefined)}
        onEarlyTrackingStart={vi.fn()}
        onCheckAccessibility={vi.fn().mockResolvedValue(true)}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
        onRefreshBillingEntitlement={refresh}
        localAiSetup={DEFAULT_LOCAL_AI_SETUP}
        onLocalAiSetupChange={vi.fn()}
        cloudTrialStartedNotice={null}
        billingEntitlement={billing.entitlement}
        billingEntitlementError={billing.error ?? null}
        billingEntitlementLoading={billing.loading ?? false}
        expectsPromotion={false}
        authCallbackStatus={null}
        onStartCloudTrialWithGoogle={vi.fn()}
        onAcknowledgeCloudTrialStartedNotice={vi.fn()}
        onComplete={vi.fn()}
        __devInitialStep="ready"
      />
    </LocalizationTestProvider>,
  );
  return refresh;
}

describe("OnboardingModal ready step when Drifty Cloud can't be used", () => {
  it("offers the other ways to classify instead of a ready check over an unavailable notice", () => {
    renderReady({ entitlement: expired });

    expect(screen.getByRole("heading", { name: "Drifty Cloud isn't available" })).toBeTruthy();
    expect(document.querySelector(".dc-onb-ready-seal")).toBeNull();
    expect(screen.queryByText("unavailable")).toBeNull();
    const local = screen.getByRole("radio", { name: /Local AI/ });
    const provider = screen.getByRole("radio", { name: /Connect your own AI provider/ });
    expect(local.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Continue with Local AI" })).toBeTruthy();

    fireEvent.click(provider);
    expect(provider.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Continue with my provider" })).toBeTruthy();
  });

  it("continues to the chosen setup's connection step", async () => {
    renderReady({ entitlement: expired });

    fireEvent.click(screen.getByRole("button", { name: "Continue with Local AI" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Set up your local AI model" })).toBeTruthy());
  });

  it("says the check failed and lets the person check again", () => {
    const refresh = renderReady({ entitlement: null, error: "network" });

    expect(screen.getByRole("heading", { name: "Couldn't check Drifty Cloud" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows no unavailable notice while the access check is still running", () => {
    renderReady({ entitlement: null, loading: true });

    expect(screen.getByRole("heading", { name: "You're ready to go" })).toBeTruthy();
    expect(document.querySelector(".dc-onb-inline-status")).toBeNull();
    expect(document.querySelector(".dc-onb-ready-line")?.textContent).toContain("Drifty Cloud checking…");
    expect((screen.getByRole("button", { name: "Checking Cloud access…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
