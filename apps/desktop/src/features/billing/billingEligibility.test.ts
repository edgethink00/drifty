import { describe, expect, it } from "vitest";

import type { BillingEntitlement } from "./billingService";
import { canStartIndividualCheckout } from "./billingEligibility";

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
