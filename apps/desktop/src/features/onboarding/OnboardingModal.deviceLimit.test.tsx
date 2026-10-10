// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingEntitlement } from "../billing/billingService";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { DEFAULT_LOCAL_AI_SETUP } from "../settings/localAiSetup";
import { OnboardingModal } from "./OnboardingModal";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const device = (id: string, label: string) => ({
  id, label, platform: "macos", appVersion: "1.12.2",
  firstSeenAt: "2026-08-01T00:00:00.000Z", lastSeenAt: "2026-10-01T00:00:00.000Z",
  revokedAt: null, isActive: true, isCurrent: false,
});

const deviceLimited = {
  plan: "individual", status: "locked", canUseApp: false, lockedReason: "device_limit_reached",
  trialEndsAt: null, currentPeriodEnd: null,
  cloudDevices: [device("old-mac", "Old MacBook"), device("studio", "Studio iMac"), device("win", "Office PC")],
} as unknown as BillingEntitlement;

const active = {
  plan: "individual", status: "active", canUseApp: true,
  trialEndsAt: null, currentPeriodEnd: "2026-11-01T00:00:00.000Z",
} as BillingEntitlement;

function Harness({ revoke }: { readonly revoke: () => Promise<void> }) {
  const [entitlement, setEntitlement] = useState<BillingEntitlement>(deviceLimited);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  return (
    <LocalizationTestProvider language="en">
      <OnboardingModal
        userId="device-limit-user"
        accountConnected
        initialDisplayName="QA"
        trackerStatus={null}
        accessibilityGranted
        accessibilityRequired={false}
        onStartTracking={vi.fn().mockResolvedValue(undefined)}
        onEarlyTrackingStart={vi.fn()}
        onCheckAccessibility={vi.fn().mockResolvedValue(true)}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
        localAiSetup={DEFAULT_LOCAL_AI_SETUP}
        onLocalAiSetupChange={vi.fn()}
        cloudTrialStartedNotice={null}
        billingEntitlement={entitlement}
        billingEntitlementError={null}
        billingEntitlementLoading={false}
        expectsPromotion={false}
        cloudDeviceRevokingId={revokingId}
        cloudDeviceActionError={null}
        onRevokeCloudDevice={async (id) => {
          setRevokingId(id);
          await revoke();
          setRevokingId(null);
          setEntitlement(active);
        }}
        authCallbackStatus={null}
        onStartCloudTrialWithGoogle={vi.fn()}
        onAcknowledgeCloudTrialStartedNotice={vi.fn()}
        onComplete={vi.fn()}
        __devInitialStep="ready"
      />
    </LocalizationTestProvider>
  );
}

describe("OnboardingModal Cloud device limit", () => {
  it("holds Continue while a device removal is in flight, then lets Cloud setup continue", async () => {
    let finishRevoke!: () => void;
    const revoke = vi.fn(() => new Promise<void>((resolve) => { finishRevoke = resolve; }));
    render(<Harness revoke={revoke} />);

    const primary = screen.getByRole("button", { name: "Continue with Cloud" });
    expect(screen.getByRole("list", { name: "Cloud devices" }).textContent).toContain("Old MacBook");

    fireEvent.click(screen.getByRole("button", { name: "Remove: Old MacBook" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove device" }));

    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    expect((primary as HTMLButtonElement).disabled).toBe(true);

    await act(async () => finishRevoke());

    await waitFor(() => expect(screen.queryByRole("list", { name: "Cloud devices" })).toBeNull());
    expect((screen.getByRole("button", { name: "Continue with Cloud" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
