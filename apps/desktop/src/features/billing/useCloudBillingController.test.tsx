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
  CLOUD_ENTITLEMENT_BACKGROUND_RETRY_MS,
  useCloudBillingController,
} from "./useCloudBillingController";

const billingMocks = vi.hoisted(() => ({
  createBillingPortalSession: vi.fn(),
  createIndividualCheckout: vi.fn(),
  fetchBillingEntitlement: vi.fn(),
  startCloudTrial: vi.fn(),
  fetchIndividualPricingQuote: vi.fn(),
  redeemTrialCoupon: vi.fn(),
}));

const cloudDeviceMocks = vi.hoisted(() => ({
  revokeCloudDevice: vi.fn(),
}));

vi.mock("./billingService", () => ({
  createBillingPortalSession: billingMocks.createBillingPortalSession,
  createIndividualCheckout: billingMocks.createIndividualCheckout,
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  startCloudTrial: billingMocks.startCloudTrial,
  fetchIndividualPricingQuote: billingMocks.fetchIndividualPricingQuote,
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
    billingMocks.startCloudTrial.mockReset();
    billingMocks.fetchIndividualPricingQuote.mockReset().mockResolvedValue({
      success: false,
      error: "Pricing unavailable in this test.",
    });
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

  it("retains last-confirmed Pro after a failed refresh and restores verified access automatically", async () => {
    vi.useFakeTimers();
    const pro: BillingEntitlement = { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null };
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: pro });
    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
      user: signedInUser, onAuthRequired: vi.fn(),
    }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.billingEntitlement).toEqual(pro);
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: false, error: "Plan check unavailable." });
    await act(async () => {
      const pending = result.current.refreshBillingEntitlement();
      await vi.advanceTimersByTimeAsync(CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS);
      await pending;
    });
    expect(result.current.billingEntitlement).toEqual(pro);
    expect(result.current.billingEntitlementError).toBe("Plan check unavailable.");
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: pro });
    await act(async () => { await vi.advanceTimersByTimeAsync(CLOUD_ENTITLEMENT_BACKGROUND_RETRY_MS); });
    expect(result.current.billingEntitlementError).toBeNull();
    expect(result.current.billingEntitlementLoading).toBe(false);
    expect(billingMocks.createIndividualCheckout).not.toHaveBeenCalled();
  });

  it("backs off repeated entitlement failures and stops retrying after recovery", async () => {
    vi.useFakeTimers();
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: false, error: "Unavailable." });
    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
      user: signedInUser, onAuthRequired: vi.fn(),
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS); });
    for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      const count = billingMocks.fetchBillingEntitlement.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1); });
      expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(count);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      await act(async () => { await vi.advanceTimersByTimeAsync(CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS); });
      expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(count + 2);
    }
    const pro: BillingEntitlement = { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null };
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: pro });
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(result.current.billingEntitlement).toEqual(pro);
    expect(result.current.billingEntitlementError).toBeNull();
    const count = billingMocks.fetchBillingEntitlement.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(count);
  });

  it.each(["unmount", "account switch"] as const)("cancels the failed account's background retry on %s", async (change) => {
    vi.useFakeTimers();
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: false, error: "Unavailable." });
    const { result, rerender, unmount } = renderHook(
      ({ user }) => useCloudBillingController({
        hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
        user, onAuthRequired: vi.fn(),
      }), { initialProps: { user: signedInUser } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS); });
    if (change === "unmount") unmount();
    else {
      billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: {
        plan: "individual", status: "locked", canUseApp: false, lockedReason: "billing_missing", trialEndsAt: null, currentPeriodEnd: null,
      } });
      rerender({ user: { ...signedInUser, id: "user-2" } });
      await act(async () => { await Promise.resolve(); });
      expect(result.current.billingEntitlement?.canUseApp).toBe(false);
      expect(result.current.billingEntitlementError).toBeNull();
    }
    const count = billingMocks.fetchBillingEntitlement.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(count);
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
    }));

    await waitFor(() => expect(result.current.billingEntitlement?.status).toBe("locked"));
    await act(async () => {
      await result.current.startCloudCheckout("yearly");
    });

    expect(billingMocks.createIndividualCheckout).toHaveBeenCalledWith("yearly");
    expect(openUrl).toHaveBeenCalledWith("https://checkout.example.test");
    expect(recordProFunnelStep).toHaveBeenCalledWith({ step: "checkout_opened", billing_interval: "yearly" });
  });

  it("uses the same server assignment for the visible price and checkout", async () => {
    const quote = {
      assignmentId: "4f708408-1e56-4dad-8f45-2f02d755ae24",
      pricingRevision: "pro-regional-pilot-2026-09",
      market: "IN",
      variant: "regional",
      currency: "INR",
      monthlyAmountMinor: 29_900,
      yearlyAmountMinor: 249_000,
    } as const;
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: {
      plan: "individual", status: "locked", canUseApp: false, trialEndsAt: null,
      currentPeriodEnd: null, lockedReason: "trial_expired",
    } });
    billingMocks.fetchIndividualPricingQuote.mockResolvedValue({ success: true, data: quote });
    billingMocks.createIndividualCheckout.mockResolvedValue({
      success: true,
      data: { url: "https://checkout.example.test" },
    });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
    }));
    await waitFor(() => expect(result.current.individualPricingQuote).toEqual(quote));
    await act(async () => { await result.current.startCloudCheckout("monthly"); });

    expect(billingMocks.createIndividualCheckout).toHaveBeenCalledWith("monthly", quote);
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
      user: signedInUser, onAuthRequired: vi.fn(),
    }));
    await waitFor(() => expect(result.current.billingEntitlement?.status).toBe("locked"));
    await act(async () => { await result.current.startCloudCheckout("monthly"); });
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    fallback.mockRestore();
  });

  it.each([false, true])("discards checkout from a previous account; analytics revoked=%s", async (revoke) => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: {
      plan: "individual", status: "locked", canUseApp: false, trialEndsAt: null, currentPeriodEnd: null, lockedReason: "trial_expired",
    } });
    let resolveCheckout!: (value: unknown) => void;
    billingMocks.createIndividualCheckout.mockReturnValue(new Promise((resolve) => { resolveCheckout = resolve; }));
    const { result, rerender } = renderHook(({ user }) => useCloudBillingController({
      hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
      user, onAuthRequired: vi.fn(),
    }), { initialProps: { user: signedInUser } });
    await waitFor(() => expect(result.current.billingEntitlement?.status).toBe("locked"));
    let checkout!: Promise<void>;
    act(() => { checkout = result.current.startCloudCheckout("monthly"); });
    await act(async () => { rerender({ user: { ...signedInUser, id: "user-2" } }); });
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
    expect(openUrl).not.toHaveBeenCalled();
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    expect(result.current.billingCheckoutLoadingInterval).toBeNull();
  });

  it.each(["checkout", "portal"] as const)("keeps the new account's %s request intact when the old one finishes", async (kind) => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: {
      plan: "individual", status: kind === "portal" ? "active" : "locked", canUseApp: kind === "portal",
      trialEndsAt: null, currentPeriodEnd: null, lockedReason: kind === "portal" ? undefined : "trial_expired",
    } });
    const resolvers: Array<(value: unknown) => void> = [];
    const create = kind === "portal" ? billingMocks.createBillingPortalSession : billingMocks.createIndividualCheckout;
    create.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
    const { result, rerender } = renderHook(({ user }) => useCloudBillingController({
      hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
      user, onAuthRequired: vi.fn(),
    }), { initialProps: { user: signedInUser } });
    await waitFor(() => expect(result.current.billingEntitlement).not.toBeNull());
    const start = () => kind === "portal" ? result.current.handleManageCloudBilling() : result.current.startCloudCheckout("monthly");
    let oldRequest!: Promise<void>; let newRequest!: Promise<void>;
    act(() => { oldRequest = start(); });
    rerender({ user: {...signedInUser, id: "user-2"} });
    await waitFor(() => expect(result.current.billingEntitlementLoading).toBe(false));
    act(() => { newRequest = start(); void start(); });
    expect(create).toHaveBeenCalledTimes(2);
    await act(async () => { resolvers[0]({success: true, data: {url: "https://old.example.test"}}); await oldRequest; });
    expect(openUrl).not.toHaveBeenCalled();
    expect(kind === "portal" ? result.current.billingPortalLoading : result.current.billingCheckoutLoadingInterval === "monthly").toBe(true);
    await act(async () => { resolvers[1]({success: true, data: {url: "https://new.example.test"}}); await newRequest; });
    expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://new.example.test");
  });

  it("clears the previous account's plan while the new entitlement is unresolved", async () => {
    billingMocks.fetchBillingEntitlement.mockResolvedValueOnce({success: true, data: {
      plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null,
    }}).mockReturnValue(new Promise(() => {}));
    const {result, rerender} = renderHook(({user}) => useCloudBillingController({
      hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
      user, onAuthRequired: vi.fn(),
    }), {initialProps: {user: signedInUser}});
    await waitFor(() => expect(result.current.billingEntitlement?.status).toBe("active"));
    rerender({user: {...signedInUser, id: "user-2"}});
    expect(result.current.billingEntitlement).toBeNull();
    expect(result.current.billingEntitlementLoading).toBe(true);
    await act(async () => { await result.current.handleManageCloudBilling(); });
    expect(billingMocks.createBillingPortalSession).not.toHaveBeenCalled();
  });

  it("does not launch browser fallback after a pending native opener belongs to a previous account", async () => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({success: true, data: {
      plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null,
    }});
    billingMocks.createBillingPortalSession.mockResolvedValue({success: true, data: {url: "https://old.example.test"}});
    let rejectOpen!: (reason: Error) => void;
    vi.mocked(openUrl).mockImplementation(() => new Promise((_resolve, reject) => {rejectOpen = reject;}));
    const fallback = vi.spyOn(window, "open").mockReturnValue(null);
    const {result, rerender} = renderHook(({user}) => useCloudBillingController({
      hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
      user, onAuthRequired: vi.fn(),
    }), {initialProps: {user: signedInUser}});
    await waitFor(() => expect(result.current.billingEntitlement?.status).toBe("active"));
    let pending!: Promise<void>;
    act(() => {pending = result.current.handleManageCloudBilling();});
    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
    await act(async () => {rerender({user: {...signedInUser, id: "user-2"}});});
    await act(async () => {rejectOpen(new Error("Native opener failed")); await pending;});
    expect(fallback).not.toHaveBeenCalled();
    expect(result.current.billingActionError).toBeNull();
    fallback.mockRestore();
  });

  it("refreshes the plan once after returning from billing management", async () => {
    const active = {plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null};
    billingMocks.fetchBillingEntitlement.mockResolvedValue({success: true, data: active});
    billingMocks.createBillingPortalSession.mockResolvedValue({success: true, data: {url: "https://portal.example.test"}});
    const {result} = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
      user: signedInUser, onAuthRequired: vi.fn(),
    }));
    await waitFor(() => expect(result.current.billingEntitlement?.status).toBe("active"));
    await act(async () => {await result.current.handleManageCloudBilling();});
    billingMocks.fetchBillingEntitlement.mockResolvedValue({success: true, data: {...active, status: "locked", canUseApp: false, lockedReason: "payment_required"}});
    const before = billingMocks.fetchBillingEntitlement.mock.calls.length;
    await act(async () => {window.dispatchEvent(new Event("focus"));});
    expect(result.current.billingEntitlement?.lockedReason).toBe("payment_required");
    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(before + 1);
    await act(async () => {window.dispatchEvent(new Event("focus"));});
    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(before + 1);
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
    const redeemedAt = new Date();
    const redeemedTrialEndsAt = new Date(redeemedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
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
        trialEndsAt: redeemedTrialEndsAt,
        redeemedAt: redeemedAt.toISOString(),
      },
    });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
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
      trialEndsAt: redeemedTrialEndsAt,
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
      trialEndsAt: redeemedTrialEndsAt,
    });
    expect(result.current.billingEntitlementError).toBe("Network connection still failed.");
  });

  it("keeps a redeemed overlay when the confirmation fetch returns a stale locked snapshot", async () => {
    const redeemedAt = new Date();
    const redeemedTrialEndsAt = new Date(redeemedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
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
        trialEndsAt: redeemedTrialEndsAt,
        redeemedAt: redeemedAt.toISOString(),
      },
    });

    const { result } = renderHook(() => useCloudBillingController({
      hasRequiredAccountAuth: true,
      isSupabaseConfigured: true,
      shouldCheckBillingEntitlement: true,
      user: signedInUser,
      onAuthRequired: vi.fn(),
    }));

    await waitFor(() => expect(result.current.billingEntitlement).toEqual(lockedEntitlement));
    await act(async () => {
      await result.current.handleRedeemTrialCoupon("DRFT-STALE-2026");
    });

    expect(result.current.couponRedemption?.status).toBe("redeemed");
    expect(result.current.billingEntitlement).toMatchObject({
      status: "trialing",
      canUseApp: true,
      trialEndsAt: redeemedTrialEndsAt,
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
    }));

    await waitFor(() => expect(result.current.billingEntitlement).toEqual(paidLikeLockedEntitlement));
    await act(async () => {
      await result.current.handleRedeemTrialCoupon("DRFT-OLD-2026");
    });

    expect(result.current.couponRedemption?.status).toBe("already_redeemed");
    expect(result.current.billingEntitlement).toEqual(paidLikeLockedEntitlement);
  });
});


describe("explicit Cloud trial activation", () => {
  const available: BillingEntitlement = {
    plan: "individual", status: "locked", canUseApp: false, trialEndsAt: null, currentPeriodEnd: null,
    lockedReason: "billing_missing", trialActivation: { state: "available", startedAt: null, endsAt: null },
  };
  const granted: BillingEntitlement = {
    ...available, status: "trialing", canUseApp: true, trialEndsAt: "2026-09-22T03:00:00Z",
    trialActivation: { state: "started", startedAt: "2026-09-15T03:00:00Z", endsAt: "2026-09-22T03:00:00Z" },
  };
  beforeEach(() => {
    billingMocks.fetchBillingEntitlement.mockReset().mockResolvedValue({ success: true, data: available });
    billingMocks.startCloudTrial.mockReset();
  });
  afterEach(cleanup);
  function setup() {
    return renderHook(({ user }) => useCloudBillingController({
      user, hasRequiredAccountAuth: true, isSupabaseConfigured: true, shouldCheckBillingEntitlement: true,
      onAuthRequired: vi.fn(),
    }), { initialProps: { user: signedInUser } });
  }
  it("does not activate on a read, and joins two simultaneous explicit clicks", async () => {
    let finish!: (value: { success: true; data: BillingEntitlement }) => void;
    billingMocks.startCloudTrial.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = setup();
    await waitFor(() => expect(result.current.billingEntitlement).toEqual(available));
    expect(billingMocks.startCloudTrial).not.toHaveBeenCalled();
    let first!: Promise<BillingEntitlement>;
    let second!: Promise<BillingEntitlement>;
    act(() => { first = result.current.activateCloudTrial(); second = result.current.activateCloudTrial(); });
    expect(first).toBe(second);
    expect(billingMocks.startCloudTrial).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ success: true, data: granted }); await first; });
    expect(result.current.billingEntitlement).toEqual(granted);
    expect(result.current.cloudTrialStarting).toBe(false);
  });
  it("keeps an activation failure retryable without claiming a grant", async () => {
    billingMocks.startCloudTrial.mockResolvedValueOnce({ success: false, error: "Connection interrupted" })
      .mockResolvedValueOnce({ success: true, data: granted });
    const { result } = setup();
    await waitFor(() => expect(result.current.billingEntitlement).toEqual(available));
    await act(async () => { await expect(result.current.activateCloudTrial()).rejects.toThrow("Connection interrupted"); });
    expect(result.current.billingEntitlement).toEqual(available);
    expect(result.current.cloudTrialStarting).toBe(false);
    await act(async () => { await result.current.activateCloudTrial(); });
    expect(result.current.billingEntitlement).toEqual(granted);
    expect(result.current.cloudTrialError).toBeNull();
  });
  it("does not apply the previous account's grant after switching accounts", async () => {
    let finish!: (value: { success: true; data: BillingEntitlement }) => void;
    billingMocks.startCloudTrial.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.billingEntitlement).toEqual(available));
    let pending!: Promise<BillingEntitlement>;
    act(() => { pending = result.current.activateCloudTrial(); });
    rerender({ user: { ...signedInUser, id: "user-2" } });
    await act(async () => { finish({ success: true, data: granted }); await expect(pending).rejects.toThrow(); });
    expect(result.current.billingEntitlement).toEqual(available);
    expect(result.current.cloudTrialError).toBeNull();
  });
});
