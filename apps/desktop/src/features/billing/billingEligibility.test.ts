import { describe, expect, it } from "vitest";

import type { BillingEntitlement } from "./billingService";
import { canOfferPromoCode, canStartIndividualCheckout } from "./billingEligibility";

function entitlement(
  status: BillingEntitlement["status"],
  lockedReason?: BillingEntitlement["lockedReason"],
): BillingEntitlement {
  return {
    plan: "individual",
    status,
    canUseApp: status !== "locked",
    trialEndsAt: null,
    currentPeriodEnd: null,
    ...(lockedReason ? { lockedReason } : {}),
  };
}

describe("canStartIndividualCheckout", () => {
  it.each([
    entitlement("trialing"),
    entitlement("locked", "trial_expired"),
    entitlement("locked", "billing_missing"),
  ])("allows a new checkout for %#", (value) => {
    expect(canStartIndividualCheckout(value)).toBe(true);
  });

  it.each([
    null,
    entitlement("active"),
    entitlement("locked", "payment_required"),
    entitlement("locked", "device_limit_reached"),
    entitlement("locked"),
  ])("fails closed for %#", (value) => {
    expect(canStartIndividualCheckout(value)).toBe(false);
  });
});

// Mirrors redeem_trial_coupon_explicit: active and past-due billing return
// already_subscribed, so Account must not offer a code in those states.
describe("canOfferPromoCode", () => {
  it.each([
    null,
    entitlement("trialing"),
    entitlement("locked", "trial_expired"),
    entitlement("locked", "billing_missing"),
    entitlement("locked"),
  ])("offers a code for %#", (value) => {
    expect(canOfferPromoCode(value)).toBe(true);
  });

  it.each([
    entitlement("active"),
    entitlement("locked", "payment_required"),
    entitlement("locked", "device_limit_reached"),
    { ...entitlement("trialing"), entitlementOwner: "organization" as const },
  ])("hides the code for paid or organization access %#", (value) => {
    expect(canOfferPromoCode(value)).toBe(false);
  });
});
