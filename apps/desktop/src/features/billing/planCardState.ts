import type {
  BillingEntitlement,
  BillingEntitlementOrganization,
  BillingEntitlementOrganizationRole,
} from "./billingService";

/**
 * What the plan cards must say about the account right now.
 *
 * `currentPlan` alone could not express a trial: it had to answer both "which
 * plan does this account hold?" and "which card is still purchasable?", so a
 * trialing account was described as Free to keep Pro clickable. That made the
 * Free card claim "Current plan" while the user was actually using Pro.
 *
 * This projection separates the two questions, so a trial reads as Pro access
 * that has not converted yet, and Pro stays purchasable.
 */
export type PlanCardState =
  | "free"
  | "pro_trial"
  | "pro_active"
  | "trial_expired"
  | "payment_required"
  | "device_limited";

export function resolvePlanCardState(entitlement: BillingEntitlement | null): PlanCardState {
  if (!entitlement) return "free";

  if (entitlement.status === "active") return "pro_active";
  if (entitlement.status === "trialing") return "pro_trial";

  switch (entitlement.lockedReason) {
    case "device_limit_reached":
      return "device_limited";
    case "payment_required":
      return "payment_required";
    case "trial_expired":
      return "trial_expired";
    default:
      return "free";
  }
}

/**
 * Organization-seat presentation is a separate projection from plan cards.
 * The server keeps `plan: "individual"` and `status: "active"` on an
 * organization seat so older clients keep working, which makes
 * `resolvePlanCardState` report `pro_active`. This resolver is the only
 * signal that access comes from an organization seat, and it never infers
 * that from `plan` or `accessSource`.
 */
export type OrganizationSeatDisplay = {
  organizationName: string;
  role: BillingEntitlementOrganizationRole;
  canManageSeats: boolean;
  seatId: string;
};

export function resolveOrganizationSeatDisplay(
  entitlement: BillingEntitlement | null,
): OrganizationSeatDisplay | null {
  if (!entitlement || entitlement.entitlementOwner !== "organization") return null;
  if (!isWellFormedOrganization(entitlement.organization)) return null;

  return Object.freeze({
    organizationName: entitlement.organization.name,
    role: entitlement.organization.role,
    canManageSeats: entitlement.organization.role === "owner"
      || entitlement.organization.role === "admin",
    seatId: entitlement.organization.seatId,
  });
}

function isWellFormedOrganization(
  value: BillingEntitlementOrganization | undefined,
): value is BillingEntitlementOrganization {
  if (!value) return false;
  return typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && isOrganizationRole(value.role)
    && typeof value.seatId === "string"
    && value.seatId.trim().length > 0;
}

function isOrganizationRole(value: unknown): value is BillingEntitlementOrganizationRole {
  return value === "owner" || value === "admin" || value === "member";
}
