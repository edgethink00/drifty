// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingPromoHandoff,
  hasPendingPromoHandoff,
  readBillingSuccessDeepLink,
  storePendingPromoHandoff,
} from "./promoHandoff";

describe("promo handoff", () => {
  beforeEach(() => window.localStorage.clear());

  it("distinguishes promo billing success without retaining a code or account token", () => {
    expect(readBillingSuccessDeepLink("drifty://billing/success?source=promo")).toEqual({ source: "promo" });
    expect(readBillingSuccessDeepLink("drifty://billing/success")).toEqual({ source: null });
    expect(readBillingSuccessDeepLink("drifty://auth/callback?source=promo")).toBeNull();
  });

  it("keeps a pending promo intent for a bounded cross-launch window", () => {
    storePendingPromoHandoff(1_000);
    expect(hasPendingPromoHandoff(1_000 + 23 * 60 * 60 * 1000)).toBe(true);
    expect(hasPendingPromoHandoff(1_000 + 25 * 60 * 60 * 1000)).toBe(false);
  });

  it("clears the pending intent after account verification or dismissal", () => {
    storePendingPromoHandoff(1_000);
    clearPendingPromoHandoff();
    expect(hasPendingPromoHandoff(1_000)).toBe(false);
  });
});
