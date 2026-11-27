// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordProFunnelStep = vi.fn((_properties: unknown) => Promise.resolve(true));
vi.mock("../../lib/analytics/proFunnel", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/analytics/proFunnel")>(),
  recordProFunnelStep: (properties: unknown) => recordProFunnelStep(properties),
}));

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { createIndividualCheckout, fetchBillingEntitlement, type FirstYearOffer } from "./billingService";
import { activeFirstYearOffer, firstYearOfferAmounts, firstYearOfferLastDay } from "./firstYearOffer";
import { STANDARD_INDIVIDUAL_PRICING_QUOTE } from "./individualPricing";
import { ProDecisionSheet } from "./ProDecisionSheet";
import { TrialEndNotice } from "./TrialEndNotice";

const offer: FirstYearOffer = {
  id: "55555555-5555-4555-8555-555555555555",
  kind: "first_year_yearly",
  billingInterval: "yearly",
  currency: "USD",
  regularAmountMinor: 6_000,
  amountMinor: 5_000,
  monthlyAmountMinor: 700,
  expiresAt: "2099-12-08T06:00:00.000Z",
};
const lastDay = (language: string) => new Intl.DateTimeFormat(language, { month: "long", day: "numeric" })
  .format(new Date(Date.parse(offer.expiresAt) - 86_400_000));

const trialExpired = {
  plan: "individual", status: "locked", canUseApp: false, trialEndsAt: "2099-11-01T00:00:00.000Z",
  currentPeriodEnd: null, lockedReason: "trial_expired",
} as const;

describe("first-year offer", () => {
  beforeEach(() => {
    recordProFunnelStep.mockClear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => cleanup());

  it("states the price against a year of monthly, rounded down, with the day before expiry as the last day", () => {
    expect(firstYearOfferAmounts(offer)).toEqual({
      percent: 40, total: "$50", regular: "$60", monthlyYear: "$84", perMonth: "$4.17",
    });
    expect(firstYearOfferLastDay(offer).toISOString()).toBe("2099-12-07T06:00:00.000Z");
  });

  it("shows an offer only before it expires and only at the standard USD price", () => {
    expect(activeFirstYearOffer(offer, null)).toBe(offer);
    expect(activeFirstYearOffer(offer, STANDARD_INDIVIDUAL_PRICING_QUOTE)).toBe(offer);
    expect(activeFirstYearOffer(offer, null, Date.parse(offer.expiresAt))).toBeNull();
    expect(activeFirstYearOffer(offer, { ...STANDARD_INDIVIDUAL_PRICING_QUOTE, variant: "regional", currency: "INR" })).toBeNull();
    expect(activeFirstYearOffer(undefined, null)).toBeNull();
  });

  it("asks the server for the offer only when told to, and reads a well-formed one", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { entitlement: trialExpired, offer }, error: null });
    const result = await fetchBillingEntitlement({ functions: { invoke } }, { requestFirstYearOffer: true });

    expect(result).toEqual({ success: true, data: { ...trialExpired, firstYearOffer: offer } });
    const body = invoke.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect(body.offers).toEqual(["first_year_yearly"]);
    expect(body).toHaveProperty("deviceRegion");
    expect(body).toHaveProperty("deviceTimeZone");

    invoke.mockClear();
    await fetchBillingEntitlement({ functions: { invoke } });
    expect(invoke.mock.calls[0]?.[1]?.body).not.toHaveProperty("offers");
  });

  it.each([
    ["an unknown kind", { ...offer, kind: "half_price" }],
    ["a price above the regular one", { ...offer, amountMinor: 7_000 }],
    ["an unreadable expiry", { ...offer, expiresAt: "soon" }],
  ])("ignores %s", async (_label, malformed) => {
    const invoke = vi.fn().mockResolvedValue({ data: { entitlement: trialExpired, offer: malformed }, error: null });
    const result = await fetchBillingEntitlement({ functions: { invoke } }, { requestFirstYearOffer: true });
    expect(result.success && result.data).not.toHaveProperty("firstYearOffer");
  });

  it("sends only the offer id with a checkout", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { url: "https://sandbox.polar.sh/checkout/offer" }, error: null });
    await createIndividualCheckout("yearly", null, { functions: { invoke } }, { offerId: offer.id });
    expect(invoke.mock.calls[0]?.[1]?.body).toEqual({
      plan: "individual",
      billingInterval: "yearly",
      pricingRevision: expect.any(String),
      trialActivation: "explicit-v1",
      offerId: offer.id,
    });
  });

  it("opens the sheet on the yearly card at the offer price, with one saving and no struck price", () => {
    const onSelectBillingPlan = vi.fn();
    render(<ProDecisionSheet
      open context="trial-ended" funnelEnabled trialEndsAt={null} unclassifiedSeconds={null}
      billingCheckoutLoadingInterval={null} firstYearOffer={offer}
      onSelectBillingPlan={onSelectBillingPlan} onDismiss={vi.fn()}
    />);
    const dialog = screen.getByRole("dialog", { name: "40% off your first year of Pro" });
    expect(within(dialog).getByText(`A year of monthly is $84. Start yearly by ${lastDay("en-US")} and pay $50 for the first year, then $60 a year.`)).toBeTruthy();
    const [monthly, yearly] = within(within(dialog).getByRole("radiogroup")).getAllByRole("radio");
    expect(yearly.getAttribute("aria-checked")).toBe("true");
    expect(within(monthly).getByText("$7")).toBeTruthy();
    expect(within(yearly).getByText("$4.17")).toBeTruthy();
    expect(within(yearly).getByText("$50 for the first year, then $60")).toBeTruthy();
    expect(within(yearly).getByText("40% off").className).toContain("is-offer");
    expect(dialog.querySelector("s")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Start yearly" }));
    expect(onSelectBillingPlan).toHaveBeenLastCalledWith("yearly");
  });

  it("writes the sheet in Korean with the monthly base beside the 40%", () => {
    render(<LocalizationTestProvider language="ko"><ProDecisionSheet
      open context="trial-ended" funnelEnabled={false} trialEndsAt={null} unclassifiedSeconds={null}
      billingCheckoutLoadingInterval={null} firstYearOffer={offer}
      onSelectBillingPlan={vi.fn()} onDismiss={vi.fn()}
    /></LocalizationTestProvider>);
    const dialog = screen.getByRole("dialog", { name: "Pro 첫해 40% 할인" });
    expect(within(dialog).getByText(`월간으로 1년이면 $84, ${lastDay("ko-KR")}까지 연간으로 시작하면 첫해 $50만 결제돼요. 다음 해부터는 연 $60 결제예요.`)).toBeTruthy();
    expect(within(dialog).getByText("40% 할인")).toBeTruthy();
    expect(within(dialog).getByText("첫해 $50, 이후 $60")).toBeTruthy();
  });

  it("names the offer in the trial-end notice and records the action with it", () => {
    const onViewPlans = vi.fn();
    render(<LocalizationTestProvider language="ko">
      <TrialEndNotice funnelEnabled unclassifiedSeconds={5100} firstYearOffer={offer} onViewPlans={onViewPlans} onDismiss={vi.fn()} />
    </LocalizationTestProvider>);
    const notice = screen.getByRole("status", { name: "Pro 첫해 40% 할인" });
    expect(notice.className).toContain("is-offer");
    expect(within(notice).getByText(`월간 1년 $84 → 연간 첫해 $50. ${lastDay("ko-KR")}까지, 다음 해부터는 연 $60 결제예요.`)).toBeTruthy();
    fireEvent.click(within(notice).getByRole("button", { name: "할인 보기" }));
    expect(onViewPlans).toHaveBeenCalledTimes(1);
    expect(recordProFunnelStep).toHaveBeenCalledWith(expect.objectContaining({
      step: "pro_offer_acted", offer_surface: "trial_end_notice", offer_action: "view_plans", price_offer: "first_year_yearly",
    }));
  });
});
