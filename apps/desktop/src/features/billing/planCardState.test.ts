import { describe, expect, it } from "vitest";

import { resolvePlanCardState } from "./planCardState";
import type { BillingEntitlement } from "./billingService";

const base = {
  plan: "individual",
  canUseApp: true,
  trialEndsAt: null,
  currentPeriodEnd: null,
} as const satisfies Omit<BillingEntitlement, "status">;

describe("resolvePlanCardState", () => {
  it("keeps an active trial on Pro instead of reporting the account as Free", () => {
    // The reported bug: a trialing account was projected to "free", so the Free
    // card claimed "Current plan" while Pro features were in use.
    expect(resolvePlanCardState({ ...base, status: "trialing", trialEndsAt: "2099-01-01T00:00:00.000Z" }))
      .toBe("pro_trial");
  });

  it("separates a paid subscription from a trial", () => {
    expect(resolvePlanCardState({ ...base, status: "active" })).toBe("pro_active");
  });

  it("maps each locked reason to its own recovery state", () => {
    const locked = (lockedReason: BillingEntitlement["lockedReason"]): BillingEntitlement => ({
      ...base,
      status: "locked",
      canUseApp: false,
      lockedReason,
    });

    expect(resolvePlanCardState(locked("trial_expired"))).toBe("trial_expired");
    expect(resolvePlanCardState(locked("payment_required"))).toBe("payment_required");
    expect(resolvePlanCardState(locked("device_limit_reached"))).toBe("device_limited");
    expect(resolvePlanCardState(locked("billing_missing"))).toBe("free");
  });

  it("treats a missing entitlement as the free plan", () => {
    expect(resolvePlanCardState(null)).toBe("free");
  });
});
