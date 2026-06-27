// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthState } from "../auth/AuthContext";
import type { BillingEntitlement } from "./billingService";
import { useCloudBillingController } from "./useCloudBillingController";

const billingMocks = vi.hoisted(() => ({
  createBillingPortalSession: vi.fn(),
  createIndividualCheckout: vi.fn(),
  fetchBillingEntitlement: vi.fn(),
}));

const cloudDeviceMocks = vi.hoisted(() => ({
  revokeCloudDevice: vi.fn(),
}));

vi.mock("./billingService", () => ({
  createBillingPortalSession: billingMocks.createBillingPortalSession,
  createIndividualCheckout: billingMocks.createIndividualCheckout,
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
}));

vi.mock("../cloud-devices/cloudDeviceService", () => ({
  revokeCloudDevice: cloudDeviceMocks.revokeCloudDevice,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const signedInUser: NonNullable<AuthState["user"]> = {
  id: "user-1",
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-06-01T00:00:00.000Z",
  email: "alex@example.com",
};

describe("useCloudBillingController", () => {
  beforeEach(() => {
    billingMocks.createBillingPortalSession.mockReset();
    billingMocks.createIndividualCheckout.mockReset();
    billingMocks.fetchBillingEntitlement.mockReset();
    cloudDeviceMocks.revokeCloudDevice.mockReset();
    vi.mocked(openUrl).mockClear();
  });

  it("opens billing management when Cloud is locked only by the device limit", async () => {
    const lockedEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: null,
      currentPeriodEnd: null,
      lockedReason: "device_limit_reached",
    };
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: lockedEntitlement });
    billingMocks.createBillingPortalSession.mockResolvedValue({ success: true, data: { url: "https://portal.example.test" } });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await waitFor(() => expect(result.current.billingEntitlement?.lockedReason).toBe("device_limit_reached"));

    await act(async () => {
      await result.current.handleManageCloudBilling();
    });

    expect(billingMocks.createBillingPortalSession).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://portal.example.test");
    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(1);
  });
});
