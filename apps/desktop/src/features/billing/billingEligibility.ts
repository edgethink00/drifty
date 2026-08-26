import type { BillingEntitlement } from "./billingService";

/**
 * Client-side projection of the states that may start a new Pro checkout.
 * Keep this fail-closed: payment recovery, device recovery, active plans, and
 * future entitlement states must resolve through their own UI before billing.
 */
export function canStartIndividualCheckout(entitlement: BillingEntitlement | null): boolean {
  return entitlement?.status === "trialing"
    || (entitlement?.status === "locked"
      && (entitlement.lockedReason === "trial_expired"
        || entitlement.lockedReason === "billing_missing"));
}
