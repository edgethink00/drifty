// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { BillingEntitlement } from "./billingService";
import { claimProPurchase, getProCheckoutPendingKey, markProCheckoutOpened, PRO_CHECKOUT_PENDING_TTL_MS } from "./proPurchase";

const active: BillingEntitlement = { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null, accessSource: "subscription" };
const locked: BillingEntitlement = { plan: "individual", status: "locked", canUseApp: false, trialEndsAt: null, currentPeriodEnd: null, lockedReason: "billing_missing" };
const NOW = Date.parse("2026-10-10T10:00:00.000Z");

describe("proPurchase", () => {
  afterEach(() => window.localStorage.clear());

  it("confirms a checkout opened from the app exactly once, when the subscription turns active", () => {
    markProCheckoutOpened("user-1", NOW);
    // Back from the browser before the webhook landed: still waiting.
    expect(claimProPurchase("user-1", locked, NOW + 1_000)).toBe(false);
    expect(window.localStorage.getItem(getProCheckoutPendingKey("user-1"))).not.toBeNull();
    expect(claimProPurchase("user-1", active, NOW + 5_000)).toBe(true);
    expect(claimProPurchase("user-1", active, NOW + 6_000)).toBe(false);
  });

  it("never confirms without an in-app checkout, for another account, or for an organization seat", () => {
    expect(claimProPurchase("user-1", active, NOW)).toBe(false);
    markProCheckoutOpened("user-1", NOW);
    expect(claimProPurchase("user-2", active, NOW)).toBe(false);
    expect(claimProPurchase("user-1", { ...active, entitlementOwner: "organization" }, NOW)).toBe(false);
    expect(claimProPurchase("user-1", { ...active, canUseApp: false }, NOW)).toBe(false);
  });

  it("drops a marker older than a day, from the future, or unreadable", () => {
    markProCheckoutOpened("user-1", NOW);
    expect(claimProPurchase("user-1", active, NOW + PRO_CHECKOUT_PENDING_TTL_MS + 1)).toBe(false);
    expect(window.localStorage.getItem(getProCheckoutPendingKey("user-1"))).toBeNull();
    markProCheckoutOpened("user-1", NOW + 10 * 60_000);
    expect(claimProPurchase("user-1", active, NOW)).toBe(false);
    window.localStorage.setItem(getProCheckoutPendingKey("user-1"), "not-a-time");
    expect(claimProPurchase("user-1", active, NOW)).toBe(false);
    expect(window.localStorage.getItem(getProCheckoutPendingKey("user-1"))).toBeNull();
  });
});
