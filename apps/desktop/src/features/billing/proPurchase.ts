import type { BillingEntitlement } from "./billingService";

/**
 * A Pro checkout opened from the app leaves a short-lived marker. The first
 * active entitlement that follows (on return from the browser, from a deep link
 * or on a later launch) is then recognized as that purchase, exactly once.
 */
const PRO_CHECKOUT_PENDING_PREFIX = "drifty:billing:pro-checkout-pending:v1";
/** Long enough to cover a checkout finished after an app restart; short enough not to claim an unrelated later subscription. */
export const PRO_CHECKOUT_PENDING_TTL_MS = 24 * 60 * 60_000;

export function getProCheckoutPendingKey(userId: string): string {
  return `${PRO_CHECKOUT_PENDING_PREFIX}:${userId}`;
}

export function markProCheckoutOpened(userId: string, now = Date.now()): void {
  try {
    window.localStorage.setItem(getProCheckoutPendingKey(userId), String(now));
  } catch {
    // Without storage the purchase still works; only the one-time follow-up is skipped.
  }
}

function clearProCheckoutPending(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing else to do: an unreadable marker can never be claimed either.
  }
}

/**
 * True once, when this account's entitlement is an active individual Pro
 * subscription and a checkout was opened from the app within the last day.
 */
export function claimProPurchase(userId: string, entitlement: BillingEntitlement | null, now = Date.now()): boolean {
  const key = getProCheckoutPendingKey(userId);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return false;
  }
  if (raw === null) return false;
  const age = now - Number(raw);
  if (!(age >= 0 && age <= PRO_CHECKOUT_PENDING_TTL_MS)) {
    clearProCheckoutPending(key);
    return false;
  }
  // An organization seat is not this purchase; leave the marker to expire on its own.
  if (entitlement?.status !== "active" || !entitlement.canUseApp || entitlement.entitlementOwner === "organization") return false;
  clearProCheckoutPending(key);
  return true;
}
