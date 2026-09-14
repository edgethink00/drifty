import { describe, expect, it } from "vitest";

import {
  INDIVIDUAL_PRICING,
  formatIndividualPrice,
  individualMonthlyDisplayAmount,
  individualYearlySavingsPercent,
  readIndividualPricingQuote,
} from "./individualPricing";

describe("individual pricing", () => {
  it("keeps the September 2026 price revision internally consistent", () => {
    expect(INDIVIDUAL_PRICING).toMatchObject({
      revision: "pro-regional-pilot-2026-09",
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

  it("formats each pilot currency with its familiar local symbol", () => {
    expect(formatIndividualPrice(299, "INR")).toBe("₹299");
    expect(formatIndividualPrice(59_000, "IDR")).toBe("Rp 59.000");
    expect(formatIndividualPrice(249, "PHP")).toBe("₱249");
    expect(formatIndividualPrice(79, "ZAR")).toBe("R 79");
  });

  it("accepts a coherent regional quote and derives its displayed savings", () => {
    const quote = readIndividualPricingQuote({
      assignmentId: "4f708408-1e56-4dad-8f45-2f02d755ae24",
      pricingRevision: "pro-regional-pilot-2026-09",
      market: "IN",
      variant: "regional",
      currency: "INR",
      monthlyAmountMinor: 29_900,
      yearlyAmountMinor: 249_000,
    });
    expect(quote).not.toBeNull();
    expect(individualMonthlyDisplayAmount("yearly", quote ?? undefined)).toBe(207.5);
    expect(individualYearlySavingsPercent(quote ?? undefined)).toBe(30);
  });

  it("rejects a quote whose market and currency do not agree", () => {
    expect(readIndividualPricingQuote({
      assignmentId: "4f708408-1e56-4dad-8f45-2f02d755ae24",
      pricingRevision: "pro-regional-pilot-2026-09",
      market: "IN",
      variant: "regional",
      currency: "PHP",
      monthlyAmountMinor: 29_900,
      yearlyAmountMinor: 249_000,
    })).toBeNull();
  });

  it("accepts a verified-country fallback only at the standard USD price shape", () => {
    const base = {
      assignmentId: "4f708408-1e56-4dad-8f45-2f02d755ae24",
      pricingRevision: "pro-regional-pilot-2026-09",
      market: "IN",
      variant: "usd_fallback",
      monthlyAmountMinor: 700,
      yearlyAmountMinor: 6_000,
    } as const;
    expect(readIndividualPricingQuote({ ...base, currency: "USD" })).toEqual({ ...base, currency: "USD" });
    expect(readIndividualPricingQuote({ ...base, currency: "INR" })).toBeNull();
  });
});
