// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { recordProFunnelStep } from "../../lib/analytics/proFunnel";
import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthState } from "../auth/AuthContext";
import { LocalizationTestProvider, type DisplayLanguage } from "../localization/LocalizationContext";
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

vi.mock("../../lib/analytics/proFunnel", () => ({ recordProFunnelStep: vi.fn().mockResolvedValue(true) }));

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
    vi.mocked(openUrl).mockReset().mockResolvedValue(undefined);
    vi.mocked(recordProFunnelStep).mockClear();
  });

  afterEach(() => {
    cleanup();
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
    const trialExpiredEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: null,
      currentPeriodEnd: null,
      lockedReason: "trial_expired",
    };
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: trialExpiredEntitlement });
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
      await result.current.startCloudCheckout("monthly");
    });

    expect(result.current.billingActionError).toBe("Checkout is temporarily unavailable.");
    expect(result.current.billingEntitlementError).toBeNull();
  });

  it.each([
    ["en", "checkout_maintenance", "We're updating pricing. Please try again shortly."],
    ["ko", "checkout_maintenance", "가격 정보를 업데이트하고 있어요. 잠시 후 다시 시도해 주세요."],
    ["en", "pricing_revision_mismatch", "Update Drifty to confirm the current price."],
    ["ko", "pricing_revision_mismatch", "현재 가격을 확인하려면 Drifty를 업데이트해 주세요."],
  ] as const)("localizes the %s %s checkout failure", async (language, code, expected) => {
    const trialExpiredEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: null,
      currentPeriodEnd: null,
      lockedReason: "trial_expired",
    };
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: trialExpiredEntitlement });
    billingMocks.createIndividualCheckout.mockResolvedValue({
      success: false,
      code,
      error: "Server fallback that should not reach the UI.",
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <LocalizationTestProvider language={language as DisplayLanguage}>{children}</LocalizationTestProvider>
    );
    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }), { wrapper });

    await waitFor(() => expect(result.current.billingEntitlement?.status).toBe("locked"));
    await act(async () => {
      await result.current.startCloudCheckout("monthly");
    });

    expect(result.current.billingActionError).toBe(expected);
  });

  it("opens the billing portal instead of a second checkout when payment is blocked", async () => {
    const lockedEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: null,
      currentPeriodEnd: null,
      lockedReason: "payment_required",
    };
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: lockedEntitlement });
    billingMocks.createBillingPortalSession.mockResolvedValue({ success: true, data: { url: "https://portal.example.test" } });
    billingMocks.createIndividualCheckout.mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await waitFor(() => expect(result.current.billingEntitlement?.lockedReason).toBe("payment_required"));
    await act(async () => {
      await result.current.startCloudCheckout("yearly");
    });

    expect(billingMocks.createBillingPortalSession).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://portal.example.test");
    expect(billingMocks.createIndividualCheckout).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "an active subscription",
      entitlement: {
        plan: "individual" as const,
        status: "active" as const,
        canUseApp: true,
        trialEndsAt: null,
        currentPeriodEnd: null,
      },
    },
    {
      label: "a device-limit lock",
      entitlement: {
        plan: "individual" as const,
        status: "locked" as const,
        canUseApp: false,
        trialEndsAt: null,
        currentPeriodEnd: null,
        lockedReason: "device_limit_reached" as const,
      },
    },
  ])("refreshes instead of opening checkout for $label", async ({ entitlement }) => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: entitlement });
    billingMocks.createIndividualCheckout.mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
      onOpenAiSetup: vi.fn(),
    }));

    await waitFor(() => expect(result.current.billingEntitlement).toEqual(entitlement));
    const entitlementChecksBeforeAction = billingMocks.fetchBillingEntitlement.mock.calls.length;
    await act(async () => {
      await result.current.startCloudCheckout("yearly");
    });

    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(entitlementChecksBeforeAction + 1);
    expect(billingMocks.createIndividualCheckout).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("opens Polar checkout when a plan is explicitly selected", async () => {
    const trialExpiredEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: null,
      currentPeriodEnd: null,
      lockedReason: "trial_expired",
    };
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: trialExpiredEntitlement });
    billingMocks.createIndividualCheckout.mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } });

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
      await result.current.startCloudCheckout("yearly");
    });

    expect(billingMocks.createIndividualCheckout).toHaveBeenCalledWith("yearly");
    expect(openUrl).toHaveBeenCalledWith("https://checkout.example.test");
    expect(recordProFunnelStep).toHaveBeenCalledWith({ step: "checkout_opened", billing_interval: "yearly" });
  });

  it.each(["creation", "native_open"] as const)("does not record checkout exposure after %s failure", async (failure) => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: {
      plan: "individual", status: "locked", canUseApp: false, trialEndsAt: null, currentPeriodEnd: null, lockedReason: "trial_expired",
    } });
    billingMocks.createIndividualCheckout.mockResolvedValue(failure === "creation"
      ? { success: false, error: "Unavailable" }
      : { success: true, data: { url: "https://checkout.example.test" } });
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("Native opener failed"));
    const fallback = vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
      user: signedInUser, onAuthRequired: vi.fn(), onOpenAiSetup: vi.fn(),
    }));
    await waitFor(() => expect(result.current.billingEntitlement?.status).toBe("locked"));
    await act(async () => { await result.current.startCloudCheckout("monthly"); });
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    fallback.mockRestore();
  });

  it.each([false, true])("an async checkout carries no account ID; revoked=%s", async (revoke) => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: {
      plan: "individual", status: "locked", canUseApp: false, trialEndsAt: null, currentPeriodEnd: null, lockedReason: "trial_expired",
    } });
    let resolveCheckout!: (value: unknown) => void;
    billingMocks.createIndividualCheckout.mockReturnValue(new Promise((resolve) => { resolveCheckout = resolve; }));
    const { result, rerender } = renderHook(({ user }) => useCloudBillingController({
      hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
      user, onAuthRequired: vi.fn(), onOpenAiSetup: vi.fn(),
    }), { initialProps: { user: signedInUser } });
    await waitFor(() => expect(result.current.billingEntitlement?.status).toBe("locked"));
    let checkout!: Promise<void>;
    act(() => { checkout = result.current.startCloudCheckout("monthly"); });
    rerender({ user: { ...signedInUser, id: "user-2" } });
    if (revoke) {
      const { writeProductAnalyticsEnabled } = await import("../../lib/analytics/productAnalyticsPreference");
      act(() => {
        writeProductAnalyticsEnabled(false);
        writeProductAnalyticsEnabled(true);
      });
    }
    await act(async () => {
      resolveCheckout({ success: true, data: { url: "https://checkout.example.test" } });
      await checkout;
    });
    if (revoke) expect(recordProFunnelStep).not.toHaveBeenCalled();
    else expect(recordProFunnelStep).toHaveBeenCalledWith({ step: "checkout_opened", billing_interval: "monthly" });
  });

  it("blocks duplicate checkout attempts until the browser return is confirmed", async () => {
    const trialExpiredEntitlement: BillingEntitlement = {
      plan: "individual",
      status: "locked",
      canUseApp: false,
      trialEndsAt: null,
      currentPeriodEnd: null,
      lockedReason: "trial_expired",
    };
    const activeEntitlement: BillingEntitlement = {
      ...trialExpiredEntitlement,
      status: "active",
      canUseApp: true,
      lockedReason: undefined,
    };
    billingMocks.fetchBillingEntitlement
      .mockResolvedValueOnce({ success: true, data: trialExpiredEntitlement })
      .mockResolvedValueOnce({ success: true, data: trialExpiredEntitlement })
      .mockResolvedValueOnce({ success: true, data: activeEntitlement });
    billingMocks.createIndividualCheckout.mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } });

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
      await result.current.startCloudCheckout("monthly");
      await result.current.startCloudCheckout("monthly");
    });

    expect(billingMocks.createIndividualCheckout).toHaveBeenCalledTimes(1);
    expect(result.current.billingCheckoutAwaitingConfirmation).toBe(true);

    vi.useFakeTimers();
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS);
    });

    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(3);
    expect(result.current.billingEntitlement?.status).toBe("active");
    expect(result.current.billingCheckoutAwaitingConfirmation).toBe(false);
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
