import { useCallback, useState } from "react";
import type { FirstYearOffer } from "./billingService";
import { formatIndividualPrice, type IndividualPricingQuote } from "./individualPricing";

const DAY_MS = 86_400_000;
const NOTICE_PREFIX = "drifty:billing:first-year-offer-notice:v1";

/**
 * The first-year offer to show now: unexpired, and only where the standard USD
 * price applies. An account the regional pilot prices never sees it, even if
 * its quote arrived after the offer.
 */
export function activeFirstYearOffer(
  offer: FirstYearOffer | null | undefined,
  quote: IndividualPricingQuote | null,
  now = Date.now(),
): FirstYearOffer | null {
  if (!offer || !(Date.parse(offer.expiresAt) > now)) return null;
  if (quote && (quote.variant !== "standard" || quote.currency !== "USD")) return null;
  return offer;
}

export type FirstYearOfferAmounts = {
  /** Saving against a year of monthly, rounded down like the yearly badge. */
  readonly percent: number;
  readonly total: string;
  readonly regular: string;
  readonly monthlyYear: string;
  readonly perMonth: string;
};

export function firstYearOfferAmounts(offer: FirstYearOffer): FirstYearOfferAmounts {
  const monthlyYearMinor = offer.monthlyAmountMinor * 12;
  return {
    percent: Math.floor((1 - offer.amountMinor / monthlyYearMinor) * 100),
    total: formatIndividualPrice(offer.amountMinor / 100, offer.currency),
    regular: formatIndividualPrice(offer.regularAmountMinor / 100, offer.currency),
    monthlyYear: formatIndividualPrice(monthlyYearMinor / 100, offer.currency),
    perMonth: formatIndividualPrice(Math.round(offer.amountMinor / 12) / 100, offer.currency),
  };
}

/**
 * The last day to show. A day before the expiry instant ends no later than the
 * expiry in any time zone, so the whole named day stays valid.
 */
export function firstYearOfferLastDay(offer: FirstYearOffer): Date {
  return new Date(Date.parse(offer.expiresAt) - DAY_MS);
}

function readSeen(offerId: string): boolean {
  try {
    return window.localStorage.getItem(`${NOTICE_PREFIX}:${offerId}`) === "1";
  } catch {
    return false;
  }
}

/** The offer's notice appears once per offer on this computer. */
export function useFirstYearOfferNotice(offerId: string | null) {
  const [sessionSeen, setSessionSeen] = useState<ReadonlySet<string>>(() => new Set());
  const seen = offerId === null || sessionSeen.has(offerId) || readSeen(offerId);
  const markSeen = useCallback(() => {
    if (offerId === null) return;
    try {
      window.localStorage.setItem(`${NOTICE_PREFIX}:${offerId}`, "1");
    } catch {
      // The in-memory mark still applies for this session.
    }
    setSessionSeen((current) => new Set(current).add(offerId));
  }, [offerId]);
  return { seen, markSeen };
}
