// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthState } from "../auth/AuthContext";
import type { BillingEntitlement } from "./billingService";
import {
  CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS,
  useCloudBillingController,
} from "./useCloudBillingController";

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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a single entitlement failure provisional when the confirmation succeeds", async () => {
    vi.useFakeTimers();
    const activeEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "active",
      canUseApp: true,
      trialEndsAt: null,
      currentPeriodEnd: null,
    };
    billingMocks.fetchBillingEntitlement
      .mockResolvedValueOnce({ success: false, error: "Network connection failed." })
      .mockResolvedValueOnce({ success: true, data: activeEntitlement });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(1);
    expect(result.current.billingEntitlementLoading).toBe(true);
    expect(result.current.billingEntitlementError).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS);
    });
    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(2);
    expect(result.current.billingEntitlement).toEqual(activeEntitlement);
    expect(result.current.billingEntitlementError).toBeNull();
    expect(result.current.billingEntitlementLoading).toBe(false);
  });

  it("surfaces entitlement trouble only after the confirmation also fails", async () => {
    vi.useFakeTimers();
    billingMocks.fetchBillingEntitlement
      .mockResolvedValueOnce({ success: false, error: "Network connection failed." })
      .mockResolvedValueOnce({ success: false, error: "Network connection still failed." });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS);
    });
    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(2);
    expect(result.current.billingEntitlement).toBeNull();
    expect(result.current.billingEntitlementError).toBe("Network connection still failed.");
    expect(result.current.billingEntitlementLoading).toBe(false);
  });

  it("abandons a pending confirmation when entitlement checking is turned off", async () => {
    vi.useFakeTimers();
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: false, error: "Network connection failed." });

    const { result, rerender } = renderHook(
      (props: { shouldCheckBillingEntitlement: boolean }) => useCloudBillingController({
        hasRequiredAccountAuth: true,
        isSupabaseConfigured: true,
        shouldCheckBillingEntitlement: props.shouldCheckBillingEntitlement,
        user: signedInUser,
        onAuthRequired: vi.fn(),
        onOpenAiSetup: vi.fn(),
      }),
      { initialProps: { shouldCheckBillingEntitlement: true } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(1);
    expect(result.current.billingEntitlementLoading).toBe(true);

    rerender({ shouldCheckBillingEntitlement: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS);
    });

    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(1);
    expect(result.current.billingEntitlement).toBeNull();
    expect(result.current.billingEntitlementError).toBeNull();
    expect(result.current.billingEntitlementLoading).toBe(false);
  });

  it("keeps an explicit checkout failure local instead of marking Cloud unhealthy", async () => {
    const lockedEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: null,
      currentPeriodEnd: null,
      lockedReason: "payment_required",
    };
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: lockedEntitlement });
    billingMocks.createIndividualCheckout.mockResolvedValue({ success: false, error: "Checkout is temporarily unavailable." });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await waitFor(() => expect(result.current.billingEntitlement?.status).toBe("locked"));
    await act(async () => {
      await result.current.handleStartDriftyCloudSetup();
    });

    expect(result.current.billingActionError).toBe("Checkout is temporarily unavailable.");
    expect(result.current.billingEntitlementError).toBeNull();
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
