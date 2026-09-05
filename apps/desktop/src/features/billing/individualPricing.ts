export const INDIVIDUAL_PRICING = {
  revision: "pro-usd-2026-09",
  currency: "USD",
  monthly: { amount: 7, interval: "month" },
  yearly: {
    amount: 60,
    interval: "year",
    monthlyEquivalent: 5,
    annualSavings: 24,
  },
} as const;

// Round down so the badge never overstates the annual discount.
export const INDIVIDUAL_YEARLY_SAVINGS_PERCENT = Math.floor(
  (1 - INDIVIDUAL_PRICING.yearly.amount / (INDIVIDUAL_PRICING.monthly.amount * 12)) * 100,
);

export type VisibleBillingInterval = "monthly" | "yearly";

export function individualMonthlyDisplayAmount(interval: VisibleBillingInterval): number {
  return interval === "monthly"
    ? INDIVIDUAL_PRICING.monthly.amount
    : INDIVIDUAL_PRICING.yearly.monthlyEquivalent;
}
