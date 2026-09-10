import { describe, expect, it } from "vitest";

import { resolveOrganizationSeatDisplay, resolvePlanCardState } from "./planCardState";
import type { BillingEntitlement, BillingEntitlementOrganizationRole } from "./billingService";

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

describe("resolveOrganizationSeatDisplay", () => {
  const organization = {
    id: "org-1",
    name: "Acme",
    role: "member" as const,
    seatId: "seat-1",
  };

  const organizationSeat = (
    role: BillingEntitlementOrganizationRole,
  ): BillingEntitlement => ({
    ...base,
    status: "active",
    entitlementOwner: "organization",
    organization: { ...organization, role },
  });

  it("returns null for an individual entitlement", () => {
    expect(resolveOrganizationSeatDisplay({ ...base, status: "active" })).toBeNull();
    expect(resolveOrganizationSeatDisplay({
      ...base,
      status: "active",
      entitlementOwner: "individual",
    })).toBeNull();
  });

  it("returns null for a null entitlement", () => {
    expect(resolveOrganizationSeatDisplay(null)).toBeNull();
  });

  it("returns null when entitlementOwner says organization but the organization object is absent", () => {
    expect(resolveOrganizationSeatDisplay({
      ...base,
      status: "active",
      entitlementOwner: "organization",
    })).toBeNull();
  });

  it("does not infer an organization seat from plan or accessSource", () => {
    expect(resolveOrganizationSeatDisplay({
      ...base,
      status: "active",
      accessSource: "subscription",
      organization,
    })).toBeNull();
  });

  it("produces canManageSeats false for a member seat", () => {
    expect(resolveOrganizationSeatDisplay(organizationSeat("member"))).toEqual({
      organizationName: "Acme",
      role: "member",
      canManageSeats: false,
      seatId: "seat-1",
    });
  });

  it("produces canManageSeats true for owner and admin seats", () => {
    expect(resolveOrganizationSeatDisplay(organizationSeat("owner"))?.canManageSeats).toBe(true);
    expect(resolveOrganizationSeatDisplay(organizationSeat("admin"))?.canManageSeats).toBe(true);
  });

  it("returns a frozen copy", () => {
    const result = resolveOrganizationSeatDisplay(organizationSeat("owner"));
    expect(result).not.toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => {
      Object.assign(result as object, { organizationName: "mutated" });
    }).toThrow(TypeError);
  });
});
