import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COUPON_REDEMPTION_TIMEOUT_MS,
  createBillingPortalSession,
  createIndividualCheckout,
  fetchBillingEntitlement,
  fetchIndividualPricingQuote,
  fetchFriendInvite,
  createFriendInvite,
  redeemTrialCoupon,
} from "./billingService";

type MockBillingClient = Parameters<typeof createBillingPortalSession>[0];

describe("billingService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("separates read from create and validates the empty invite state", async () => {
    const empty = { code: null, expiresAt: null, codeEntryUntil: null, durationDays: 30, maxClaims: 10, claimedCount: 0, status: "uncreated", claims: [] };
    const invoke = vi.fn().mockResolvedValue({ data: { enabled: true, invite: empty }, error: null });
    const client: MockBillingClient = { functions: { invoke } };
    await expect(fetchFriendInvite(client)).resolves.toEqual({ kind: "ready", invite: empty });
    expect(invoke.mock.calls[0]?.[1].body).toEqual({ action: "read" });
    await expect(createFriendInvite(client)).resolves.toEqual({ kind: "unavailable" });
    expect(invoke.mock.calls[1]?.[1].body).toEqual({ action: "create" });
    invoke.mockResolvedValue({ data: { enabled: true, invite: { ...empty, claimedCount: 1 } }, error: null });
    await expect(fetchFriendInvite(client)).resolves.toEqual({ kind: "unavailable" });
    invoke.mockResolvedValue({ data: { enabled: true, invite: { ...empty, status: "active" } }, error: null });
    await expect(fetchFriendInvite(client)).resolves.toEqual({ kind: "unavailable" });
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
      body: {
        plan: "individual",
        billingInterval,
        pricingRevision: "pro-regional-pilot-2026-09",
        trialActivation: "explicit-v1",
      },
    });
  });

  it("requests and validates a regional price quote with device context", async () => {
    const quote = {
      assignmentId: "4f708408-1e56-4dad-8f45-2f02d755ae24",
      pricingRevision: "pro-regional-pilot-2026-09",
      market: "IN",
      variant: "regional",
      currency: "INR",
      monthlyAmountMinor: 29_900,
      yearlyAmountMinor: 249_000,
    } as const;
    const invoke = vi.fn().mockResolvedValue({ data: { quote }, error: null });
    const client: MockBillingClient = { functions: { invoke } };

    await expect(fetchIndividualPricingQuote({
      deviceRegion: "IN",
      deviceTimeZone: "Asia/Kolkata",
    }, client)).resolves.toEqual({ success: true, data: quote });
    expect(invoke).toHaveBeenCalledWith("create-polar-checkout", {
      timeout: 30_000,
      body: {
        action: "quote",
        plan: "individual",
        billingInterval: "monthly",
        pricingRevision: "pro-regional-pilot-2026-09",
        trialActivation: "explicit-v1",
        deviceRegion: "IN",
        deviceTimeZone: "Asia/Kolkata",
      },
    });
  });

  it("pins checkout to the assignment that supplied the visible price", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { url: "https://checkout.example.test" },
      error: null,
    });
    const client: MockBillingClient = { functions: { invoke } };
    const quote = {
      assignmentId: "4f708408-1e56-4dad-8f45-2f02d755ae24",
      pricingRevision: "pro-regional-pilot-2026-09",
      market: "IN",
      variant: "regional",
      currency: "INR",
      monthlyAmountMinor: 29_900,
      yearlyAmountMinor: 249_000,
    } as const;

    await expect(createIndividualCheckout("yearly", quote, client)).resolves.toEqual({
      success: true,
      data: { url: "https://checkout.example.test" },
    });
    expect(invoke).toHaveBeenCalledWith("create-polar-checkout", {
      timeout: 30_000,
      body: {
        plan: "individual",
        billingInterval: "yearly",
        pricingRevision: "pro-regional-pilot-2026-09",
        trialActivation: "explicit-v1",
        pricingAssignmentId: quote.assignmentId,
      },
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

  it("keeps the checkout states the server codes and drops codes it does not know", async () => {
    const refusal = (body: Record<string, unknown>) => vi.fn().mockResolvedValue({
      data: null,
      error: { context: { json: () => Promise.resolve(body) } },
    });
    const pending = refusal({ code: "checkout_payment_pending", error: "The previous checkout is being processed." });
    await expect(createIndividualCheckout("monthly", { functions: { invoke: pending } })).resolves.toEqual({
      success: false,
      code: "checkout_payment_pending",
      error: "The previous checkout is being processed.",
    });

    const unknown = refusal({ code: "uncoded", error: "Unable to create checkout." });
    await expect(createIndividualCheckout("monthly", { functions: { invoke: unknown } })).resolves.toEqual({
      success: false,
      error: "Unable to create checkout.",
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
      body: { code: "DRFT-TEST-2026", trialActivation: "explicit-v1" },
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

  describe("fetchBillingEntitlement", () => {
    const invalidEntitlementResult = {
      success: false,
      error: "Billing entitlement returned an invalid response.",
    } as const;

    const individualEntitlement = {
      plan: "individual" as const,
      status: "active" as const,
      canUseApp: true,
      trialEndsAt: null,
      currentPeriodEnd: null,
    };

    const organization = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Drifty Enterprise Pilot",
      role: "member" as const,
      seatId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };

    function entitlementClient(entitlement: unknown): MockBillingClient {
      return {
        functions: {
          invoke: vi.fn().mockResolvedValue({ data: { entitlement }, error: null }),
        },
      };
    }

    it("keeps an individual entitlement without organization fields", async () => {
      const result = await fetchBillingEntitlement(entitlementClient(individualEntitlement));

      expect(result).toEqual({ success: true, data: individualEntitlement });
      expect(result.success && "entitlementOwner" in result.data).toBe(false);
      expect(result.success && "organization" in result.data).toBe(false);
    });

    it("accepts a valid organization entitlement and preserves all four fields", async () => {
      const entitlement = {
        ...individualEntitlement,
        currentPeriodEnd: "2026-10-05T20:19:17.11+00:00",
        accessSource: "subscription" as const,
        entitlementOwner: "organization" as const,
        organization,
      };

      await expect(fetchBillingEntitlement(entitlementClient(entitlement))).resolves.toEqual({
        success: true,
        data: entitlement,
      });
    });

    it("rejects an organization payload that is not owned by an organization entitlement", async () => {
      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        organization,
      }))).resolves.toEqual(invalidEntitlementResult);

      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        entitlementOwner: "individual",
        organization,
      }))).resolves.toEqual(invalidEntitlementResult);
    });

    it("rejects entitlementOwner organization when organization is missing or malformed", async () => {
      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        entitlementOwner: "organization",
      }))).resolves.toEqual(invalidEntitlementResult);

      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        entitlementOwner: "organization",
        organization: null,
      }))).resolves.toEqual(invalidEntitlementResult);

      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        entitlementOwner: "organization",
        organization: { ...organization, seatId: undefined },
      }))).resolves.toEqual(invalidEntitlementResult);
    });

    it("rejects an organization role outside owner, admin, or member", async () => {
      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        entitlementOwner: "organization",
        organization: { ...organization, role: "superadmin" },
      }))).resolves.toEqual(invalidEntitlementResult);
    });

    it("rejects a non-UUID organization id or seatId", async () => {
      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        entitlementOwner: "organization",
        organization: { ...organization, id: "organization-1" },
      }))).resolves.toEqual(invalidEntitlementResult);

      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        entitlementOwner: "organization",
        organization: { ...organization, seatId: "SEAT-1" },
      }))).resolves.toEqual(invalidEntitlementResult);

      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        entitlementOwner: "organization",
        organization: { ...organization, id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
      }))).resolves.toEqual(invalidEntitlementResult);
    });

    it("rejects an empty or control-character organization name", async () => {
      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        entitlementOwner: "organization",
        organization: { ...organization, name: "" },
      }))).resolves.toEqual(invalidEntitlementResult);

      await expect(fetchBillingEntitlement(entitlementClient({
        ...individualEntitlement,
        entitlementOwner: "organization",
        organization: { ...organization, name: "Drifty\nEnterprise" },
      }))).resolves.toEqual(invalidEntitlementResult);
    });
  });
});
