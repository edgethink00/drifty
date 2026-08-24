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
  redeemTrialCoupon: vi.fn(),
}));

const cloudDeviceMocks = vi.hoisted(() => ({
  revokeCloudDevice: vi.fn(),
}));

vi.mock("./billingService", () => ({
  createBillingPortalSession: billingMocks.createBillingPortalSession,
  createIndividualCheckout: billingMocks.createIndividualCheckout,
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  redeemTrialCoupon: billingMocks.redeemTrialCoupon,
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
    billingMocks.redeemTrialCoupon.mockReset();
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

  it("redeems a trial code and refreshes entitlement without opening Polar checkout", async () => {
    const originalEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "trialing",
      canUseApp: true,
      trialEndsAt: "2026-08-31T00:00:00.000Z",
      currentPeriodEnd: null,
    };
    const extendedEntitlement: BillingEntitlement = {
      ...originalEntitlement,
      trialEndsAt: "2026-09-30T00:00:00.000Z",
    };
    billingMocks.fetchBillingEntitlement
      .mockResolvedValueOnce({ success: true, data: originalEntitlement })
      .mockResolvedValueOnce({ success: true, data: extendedEntitlement });
    billingMocks.redeemTrialCoupon.mockResolvedValue({
      success: true,
      data: {
        status: "redeemed",
        grantedDays: 30,
        trialEndsAt: "2026-09-30T00:00:00.000Z",
        redeemedAt: "2026-08-24T00:00:00.000Z",
      },
    });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await waitFor(() => expect(result.current.billingEntitlement).toEqual(originalEntitlement));
    await act(async () => {
      await result.current.handleRedeemTrialCoupon("DRFT-TEST-2026");
    });

    expect(billingMocks.redeemTrialCoupon).toHaveBeenCalledWith("DRFT-TEST-2026");
    expect(billingMocks.createIndividualCheckout).not.toHaveBeenCalled();
    expect(result.current.couponRedemption?.status).toBe("redeemed");
    expect(result.current.couponRedemptionErrorCode).toBeNull();
    expect(result.current.billingEntitlement).toEqual(extendedEntitlement);
  });

  it("keeps the redeemed entitlement locally available when the confirmation refresh is offline", async () => {
    vi.useFakeTimers();
    const lockedEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: "2026-08-20T00:00:00.000Z",
      currentPeriodEnd: null,
      lockedReason: "trial_expired",
    };
    billingMocks.fetchBillingEntitlement
      .mockResolvedValueOnce({ success: true, data: lockedEntitlement })
      .mockResolvedValueOnce({ success: false, error: "Network connection failed." })
      .mockResolvedValueOnce({ success: false, error: "Network connection still failed." });
    billingMocks.redeemTrialCoupon.mockResolvedValue({
      success: true,
      data: {
        status: "redeemed",
        grantedDays: 30,
        trialEndsAt: "2026-09-23T00:00:00.000Z",
        redeemedAt: "2026-08-24T00:00:00.000Z",
      },
    });

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
    expect(result.current.billingEntitlement).toEqual(lockedEntitlement);

    let redemptionPromise: Promise<void> | undefined;
    await act(async () => {
      redemptionPromise = result.current.handleRedeemTrialCoupon("DRFT-OFFLINE-2026");
      await Promise.resolve();
    });
    expect(result.current.billingEntitlement).toMatchObject({
      status: "trialing",
      canUseApp: true,
      trialEndsAt: "2026-09-23T00:00:00.000Z",
    });
    expect(result.current.billingEntitlement?.lockedReason).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS);
      await redemptionPromise;
    });

    expect(result.current.couponRedemption?.status).toBe("redeemed");
    expect(result.current.billingEntitlement).toMatchObject({
      status: "trialing",
      canUseApp: true,
      trialEndsAt: "2026-09-23T00:00:00.000Z",
    });
    expect(result.current.billingEntitlementError).toBe("Network connection still failed.");
  });

  it("keeps a redeemed overlay when the confirmation fetch returns a stale locked snapshot", async () => {
    const lockedEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: "2026-08-20T00:00:00.000Z",
      currentPeriodEnd: null,
      lockedReason: "trial_expired",
    };
    billingMocks.fetchBillingEntitlement
      .mockResolvedValueOnce({ success: true, data: lockedEntitlement })
      .mockResolvedValueOnce({ success: true, data: lockedEntitlement });
    billingMocks.redeemTrialCoupon.mockResolvedValue({
      success: true,
      data: {
        status: "redeemed",
        grantedDays: 30,
        trialEndsAt: "2026-09-23T00:00:00.000Z",
        redeemedAt: "2026-08-24T00:00:00.000Z",
      },
    });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await waitFor(() => expect(result.current.billingEntitlement).toEqual(lockedEntitlement));
    await act(async () => {
      await result.current.handleRedeemTrialCoupon("DRFT-STALE-2026");
    });

    expect(result.current.couponRedemption?.status).toBe("redeemed");
    expect(result.current.billingEntitlement).toMatchObject({
      status: "trialing",
      canUseApp: true,
      trialEndsAt: "2026-09-23T00:00:00.000Z",
    });
    expect(result.current.billingEntitlement?.lockedReason).toBeUndefined();
  });

  it("never demotes an active subscriber on an already-redeemed response", async () => {
    const activeEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "active",
      canUseApp: true,
      trialEndsAt: "2026-09-01T00:00:00.000Z",
      currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    };
    billingMocks.fetchBillingEntitlement
      .mockResolvedValueOnce({ success: true, data: activeEntitlement })
      .mockRejectedValueOnce(new Error("Confirmation network failure"));
    billingMocks.redeemTrialCoupon.mockResolvedValue({
      success: true,
      data: {
        status: "already_redeemed",
        grantedDays: 30,
        trialEndsAt: "2026-09-01T00:00:00.000Z",
        redeemedAt: "2026-07-24T00:00:00.000Z",
      },
    });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await waitFor(() => expect(result.current.billingEntitlement).toEqual(activeEntitlement));
    await act(async () => {
      await result.current.handleRedeemTrialCoupon("DRFT-OLD-2026");
    });

    expect(result.current.couponRedemption?.status).toBe("already_redeemed");
    expect(result.current.billingEntitlement).toEqual(activeEntitlement);
    expect(billingMocks.createIndividualCheckout).not.toHaveBeenCalled();
  });

  it("recovers a real grant when the first response timed out and retry is already-redeemed", async () => {
    const lockedEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: "2026-08-20T00:00:00.000Z",
      currentPeriodEnd: null,
      lockedReason: "trial_expired",
    };
    billingMocks.fetchBillingEntitlement
      .mockResolvedValueOnce({ success: true, data: lockedEntitlement })
      .mockResolvedValueOnce({ success: true, data: lockedEntitlement });
    billingMocks.redeemTrialCoupon
      .mockResolvedValueOnce({
        success: false,
        code: "coupon_unavailable",
        error: "Trial code redemption timed out.",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          status: "already_redeemed",
          grantedDays: 30,
          trialEndsAt: "2099-09-23T00:00:00.000Z",
          redeemedAt: "2026-08-24T00:00:00.000Z",
        },
      });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await waitFor(() => expect(result.current.billingEntitlement).toEqual(lockedEntitlement));
    await act(async () => {
      await result.current.handleRedeemTrialCoupon("DRFT-TIMEOUT-2026");
    });
    expect(result.current.couponRedemptionErrorCode).toBe("coupon_unavailable");
    expect(result.current.billingEntitlement).toEqual(lockedEntitlement);

    await act(async () => {
      await result.current.handleRedeemTrialCoupon("DRFT-TIMEOUT-2026");
    });

    expect(result.current.couponRedemption?.status).toBe("already_redeemed");
    expect(result.current.billingEntitlement).toMatchObject({
      status: "trialing",
      canUseApp: true,
      trialEndsAt: "2099-09-23T00:00:00.000Z",
    });
  });

  it("does not overlay a paid-like locked period from an already-redeemed response", async () => {
    const paidLikeLockedEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: "2026-08-20T00:00:00.000Z",
      currentPeriodEnd: "2099-10-01T00:00:00.000Z",
      lockedReason: "payment_required",
    };
    billingMocks.fetchBillingEntitlement
      .mockResolvedValueOnce({ success: true, data: paidLikeLockedEntitlement })
      .mockRejectedValueOnce(new Error("Confirmation network failure"));
    billingMocks.redeemTrialCoupon.mockResolvedValue({
      success: true,
      data: {
        status: "already_redeemed",
        grantedDays: 30,
        trialEndsAt: "2099-09-23T00:00:00.000Z",
        redeemedAt: "2026-08-24T00:00:00.000Z",
      },
    });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await waitFor(() => expect(result.current.billingEntitlement).toEqual(paidLikeLockedEntitlement));
    await act(async () => {
      await result.current.handleRedeemTrialCoupon("DRFT-OLD-2026");
    });

    expect(result.current.couponRedemption?.status).toBe("already_redeemed");
    expect(result.current.billingEntitlement).toEqual(paidLikeLockedEntitlement);
  });
});
