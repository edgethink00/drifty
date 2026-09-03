import { describe, expect, it } from "vitest";

import { INDIVIDUAL_PRICING, individualMonthlyDisplayAmount } from "./individualPricing";

describe("individual pricing", () => {
  it("keeps the September 2026 price revision internally consistent", () => {
    expect(INDIVIDUAL_PRICING).toMatchObject({
      revision: "pro-usd-2026-09",
      currency: "USD",
      monthly: { amount: 7, interval: "month" },
      yearly: { amount: 60, interval: "year", monthlyEquivalent: 5, annualSavings: 24 },
    });
    expect(INDIVIDUAL_PRICING.monthly.amount * 12 - INDIVIDUAL_PRICING.yearly.amount)
      .toBe(INDIVIDUAL_PRICING.yearly.annualSavings);
    expect(INDIVIDUAL_PRICING.yearly.amount / 12)
      .toBe(INDIVIDUAL_PRICING.yearly.monthlyEquivalent);
  });

  it("provides the monthly display amount for both visible intervals", () => {
    expect(individualMonthlyDisplayAmount("monthly")).toBe(7);
    expect(individualMonthlyDisplayAmount("yearly")).toBe(5);
  });
});
