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

export type VisibleBillingInterval = "monthly" | "yearly";

export function individualMonthlyDisplayAmount(interval: VisibleBillingInterval): number {
  return interval === "monthly"
    ? INDIVIDUAL_PRICING.monthly.amount
    : INDIVIDUAL_PRICING.yearly.monthlyEquivalent;
}
