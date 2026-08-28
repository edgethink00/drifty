export type OnboardingAccountAccessState =
  | "disconnected"
  | "checking"
  | "promotion-confirmed"
  | "standard-confirmed"
  | "verification-deferred"
  | "promotion-mismatch";

export function resolveOnboardingAccountAccessState({
  accountConnected,
  billingEntitlementError,
  billingEntitlementLoading,
  billingAccessSource,
  entitlementResolved,
  expectsPromotion,
  promotionActive,
}: {
  readonly accountConnected: boolean;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly billingAccessSource: "subscription" | "standard_trial" | "promotion" | undefined;
  readonly entitlementResolved: boolean;
  readonly expectsPromotion: boolean;
  readonly promotionActive: boolean;
}): OnboardingAccountAccessState {
  if (!accountConnected) return "disconnected";
  if (promotionActive) return "promotion-confirmed";
  if (expectsPromotion) {
    if (billingEntitlementError) return "verification-deferred";
    if (billingEntitlementLoading || !entitlementResolved) return "checking";
    if (billingAccessSource && billingAccessSource !== "promotion") return "promotion-mismatch";
    return "verification-deferred";
  }
  return "standard-confirmed";
}
