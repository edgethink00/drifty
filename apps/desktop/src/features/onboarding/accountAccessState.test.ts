import { describe, expect, it } from "vitest";
import { resolveOnboardingAccountAccessState } from "./accountAccessState";

const connectedDefaults = {
  accountConnected: true,
  billingAccessSource: undefined,
  billingEntitlementError: null,
  billingEntitlementLoading: false,
  entitlementResolved: true,
  expectsPromotion: false,
  promotionActive: false,
} as const;

describe("resolveOnboardingAccountAccessState", () => {
  it.each([
    ["disconnected", { ...connectedDefaults, accountConnected: false }],
    ["standard-confirmed", { ...connectedDefaults, billingEntitlementLoading: true }],
    ["checking", { ...connectedDefaults, billingEntitlementLoading: true, expectsPromotion: true }],
    ["checking", { ...connectedDefaults, entitlementResolved: false, expectsPromotion: true }],
    ["promotion-confirmed", {
      ...connectedDefaults,
      billingAccessSource: "promotion",
      expectsPromotion: true,
      promotionActive: true,
    }],
    ["standard-confirmed", connectedDefaults],
    ["verification-deferred", { ...connectedDefaults, billingEntitlementError: "offline", expectsPromotion: true }],
    ["verification-deferred", { ...connectedDefaults, expectsPromotion: true }],
    ["promotion-mismatch", {
      ...connectedDefaults,
      billingAccessSource: "standard_trial",
      expectsPromotion: true,
    }],
  ] as const)("returns %s for the matching account state", (expected, options) => {
    expect(resolveOnboardingAccountAccessState(options)).toBe(expected);
  });
});
