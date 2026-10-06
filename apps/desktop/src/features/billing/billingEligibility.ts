import type { BillingEntitlement } from "./billingService";

/**
 * Client-side projection of the states that may start a new Pro checkout.
 * Keep this fail-closed: payment recovery, device recovery, active plans, and
 * future entitlement states must resolve through their own UI before billing.
 */
export function canStartIndividualCheckout(entitlement: Pick<BillingEntitlement, "status" | "lockedReason"> | null): boolean {
  return entitlement?.status === "trialing"
    || (entitlement?.status === "locked"
      && (entitlement.lockedReason === "trial_expired"
        || entitlement.lockedReason === "billing_missing"));
}

export function canStartCloudTrial(entitlement: BillingEntitlement | null | undefined): boolean {
  return entitlement?.trialActivation?.state === "available"
    && entitlement.status === "locked"
    && !entitlement.canUseApp
    && entitlement.entitlementOwner !== "organization"
    && (entitlement.lockedReason === "billing_missing" || entitlement.lockedReason === undefined);
}

/**
 * Whether Account offers a promo (trial) code. The server refuses a code for
 * an active or past-due subscription (device-limited plans are active ones)
 * and organization seats have nothing to extend, so the field is hidden there
 * instead of leading to an error. An unknown entitlement stays offered: the
 * server remains the authority when the client cannot tell.
 */
export function canOfferPromoCode(
  entitlement: Pick<BillingEntitlement, "status" | "lockedReason" | "entitlementOwner"> | null | undefined,
): boolean {
  if (!entitlement) return true;
  if (entitlement.entitlementOwner === "organization") return false;
  if (entitlement.status === "active") return false;
  return !(entitlement.status === "locked"
    && (entitlement.lockedReason === "payment_required" || entitlement.lockedReason === "device_limit_reached"));
}
