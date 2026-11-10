import type { BillingEntitlement } from "../billing/billingService";

/**
 * Development review only: ?driftyReadyReview=<state> shows the ready step's
 * Drifty Cloud states without an account or billing backend, so each can be
 * reviewed in a browser. Production builds compile readReadyReviewState() to
 * null. "checking" holds the access check open only once the ready step is
 * reached, so the earlier steps stay usable.
 */
export const READY_REVIEW_STATES = ["trial", "active", "checking", "unavailable", "uncheckable"] as const;
export type ReadyReviewState = (typeof READY_REVIEW_STATES)[number];

export function readReadyReviewState(): ReadyReviewState | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("driftyReadyReview");
  return READY_REVIEW_STATES.find((state) => state === value) ?? null;
}

type ReviewBilling = {
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
};

const LOCKED: BillingEntitlement = { plan: "individual", status: "locked", canUseApp: false, trialEndsAt: null, currentPeriodEnd: null };

export function readyReviewBilling(state: ReadyReviewState, readyReached: boolean, real: ReviewBilling): ReviewBilling {
  switch (state) {
    case "trial":
      return { billingEntitlement: { ...LOCKED, lockedReason: "billing_missing", trialActivation: { state: "available", startedAt: null, endsAt: null } }, billingEntitlementError: null, billingEntitlementLoading: false };
    case "active":
      return { billingEntitlement: { ...LOCKED, status: "trialing", canUseApp: true, accessSource: "standard_trial", trialEndsAt: new Date(Date.now() + 6 * 864e5).toISOString() }, billingEntitlementError: null, billingEntitlementLoading: false };
    case "checking":
      return readyReached ? { billingEntitlement: null, billingEntitlementError: null, billingEntitlementLoading: true } : real;
    case "unavailable":
      return { billingEntitlement: { ...LOCKED, lockedReason: "trial_expired", trialActivation: { state: "unavailable", startedAt: null, endsAt: null } }, billingEntitlementError: null, billingEntitlementLoading: false };
    case "uncheckable":
      return { billingEntitlement: null, billingEntitlementError: "review", billingEntitlementLoading: false };
  }
}
