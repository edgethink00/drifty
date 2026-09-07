import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COUPON_REDEMPTION_TIMEOUT_MS,
  createBillingPortalSession,
  createIndividualCheckout,
  redeemTrialCoupon,
} from "./billingService";

type MockBillingClient = Parameters<typeof createBillingPortalSession>[0];

describe("billingService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["monthly", "yearly"] as const)("sends the selected %s interval to checkout", async (billingInterval) => {
    const invoke = vi.fn().mockResolvedValue({
      data: { url: "https://checkout.example.test" },
      error: null,
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await createIndividualCheckout(billingInterval, client);

    expect(result).toEqual({ success: true, data: { url: "https://checkout.example.test" } });
    expect(invoke).toHaveBeenCalledWith("create-polar-checkout", {
      timeout: 30_000,
      body: { plan: "individual", billingInterval, pricingRevision: "pro-usd-2026-09" },
    });
  });

  it("preserves a structured pricing revision failure", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: {
        context: {
          json: () => Promise.resolve({
            code: "pricing_revision_mismatch",
            error: "Update Drifty to confirm the current price before checkout.",
          }),
        },
      },
    });
    const client: MockBillingClient = { functions: { invoke } };

    await expect(createIndividualCheckout("monthly", client)).resolves.toEqual({
      success: false,
      code: "pricing_revision_mismatch",
      error: "Update Drifty to confirm the current price before checkout.",
    });
  });

  it("creates a Polar customer portal session", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { url: "https://portal.example.test" },
      error: null,
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await createBillingPortalSession(client);

    expect(result).toEqual({ success: true, data: { url: "https://portal.example.test" } });
    expect(invoke).toHaveBeenCalledWith("create-polar-customer-portal", { timeout: 30_000, body: {} });
  });

  it("accepts the Polar customer portal URL response key", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { customerPortalUrl: "https://portal.example.test/session" },
      error: null,
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await createBillingPortalSession(client);

    expect(result).toEqual({ success: true, data: { url: "https://portal.example.test/session" } });
  });

  it("returns the billing portal function error body when Supabase wraps the response context", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: {
        context: {
          json: () => Promise.resolve({ error: "Billing management is not available for this account yet." }),
        },
      },
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await createBillingPortalSession(client);

    expect(result).toEqual({ success: false, error: "Billing management is not available for this account yet." });
  });

  it("returns an error when the portal function omits a redirect URL", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {},
      error: null,
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await createBillingPortalSession(client);

    expect(result).toEqual({ success: false, error: "Billing management did not return a redirect URL." });
  });

  it("redeems an offline trial code without sending it to Polar", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        redemption: {
          status: "redeemed",
          grantedDays: 30,
          trialEndsAt: "2026-10-01T00:00:00.000Z",
          redeemedAt: "2026-08-24T00:00:00.000Z",
        },
      },
      error: null,
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await redeemTrialCoupon("DRFT-TEST-2026", client);

    expect(result).toEqual({
      success: true,
      data: {
        status: "redeemed",
        grantedDays: 30,
        trialEndsAt: "2026-10-01T00:00:00.000Z",
        redeemedAt: "2026-08-24T00:00:00.000Z",
      },
    });
    expect(invoke).toHaveBeenCalledWith("redeem-coupon", {
      body: { code: "DRFT-TEST-2026" },
      signal: expect.any(AbortSignal),
      timeout: COUPON_REDEMPTION_TIMEOUT_MS,
    });
  });

  it("preserves the structured coupon failure code from the Edge Function", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: {
        context: {
          json: () => Promise.resolve({ code: "coupon_expired", error: "That trial code has expired." }),
        },
      },
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await redeemTrialCoupon("DRFT-OLD-2026", client);

    expect(result).toEqual({
      success: false,
      code: "coupon_expired",
      error: "That trial code has expired.",
    });
  });

  it("preserves the coupon attempt rate-limit code from the Edge Function", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: {
        context: {
          json: () => Promise.resolve({
            code: "coupon_rate_limited",
            error: "Too many trial code attempts. Try again in 15 minutes.",
          }),
        },
      },
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await redeemTrialCoupon("DRFT-UNKNOWN-2026", client);

    expect(result).toEqual({
      success: false,
      code: "coupon_rate_limited",
      error: "Too many trial code attempts. Try again in 15 minutes.",
    });
  });

  it("returns coupon_unavailable when a desktop function invoke hangs past the deadline", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn(() => new Promise<never>(() => undefined));
    const client: MockBillingClient = { functions: { invoke } };

    const resultPromise = redeemTrialCoupon("DRFT-HUNG-2026", client);
    await vi.advanceTimersByTimeAsync(COUPON_REDEMPTION_TIMEOUT_MS);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      code: "coupon_unavailable",
      error: "Trial code redemption timed out.",
    });
    expect(invoke).toHaveBeenCalledWith("redeem-coupon", expect.objectContaining({
      signal: expect.any(AbortSignal),
      timeout: COUPON_REDEMPTION_TIMEOUT_MS,
    }));
  });
});
