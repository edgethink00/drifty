import type { BillingEntitlement } from "./billingService";

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
