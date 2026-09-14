export const INDIVIDUAL_PRICING = {
  revision: "pro-regional-pilot-2026-09",
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
export type IndividualPricingCurrency = "USD" | "INR" | "IDR" | "PHP" | "ZAR";
export type IndividualPricingMarket = "IN" | "ID" | "PH" | "ZA";
export type IndividualPricingVariant = "standard" | "regional" | "usd_holdout" | "usd_fallback";

export type IndividualPricingQuote = {
  readonly assignmentId: string | null;
  readonly pricingRevision: string;
  readonly market: IndividualPricingMarket | null;
  readonly variant: IndividualPricingVariant;
  readonly currency: IndividualPricingCurrency;
  readonly monthlyAmountMinor: number;
  readonly yearlyAmountMinor: number;
};

export type IndividualPricingDeviceContext = {
  readonly deviceRegion: string | null;
  readonly deviceTimeZone: string | null;
};

export const STANDARD_INDIVIDUAL_PRICING_QUOTE: IndividualPricingQuote = {
  assignmentId: null,
  pricingRevision: INDIVIDUAL_PRICING.revision,
  market: null,
  variant: "standard",
  currency: "USD",
  monthlyAmountMinor: 700,
  yearlyAmountMinor: 6_000,
};

const CURRENCY_FORMAT_LOCALE: Readonly<Record<IndividualPricingCurrency, string>> = {
  USD: "en-US",
  INR: "en-IN",
  IDR: "id-ID",
  PHP: "en-PH",
  ZAR: "en-ZA",
};

// Kept for existing call sites and tests; quote-aware surfaces pass their
// server-confirmed quote so the visible value and checkout assignment agree.
export const INDIVIDUAL_YEARLY_SAVINGS_PERCENT = individualYearlySavingsPercent();

export function individualMonthlyDisplayAmount(
  interval: VisibleBillingInterval,
  quote: IndividualPricingQuote = STANDARD_INDIVIDUAL_PRICING_QUOTE,
): number {
  return interval === "monthly"
    ? quote.monthlyAmountMinor / 100
    : quote.yearlyAmountMinor / 1_200;
}

export function individualYearlyDisplayAmount(
  quote: IndividualPricingQuote = STANDARD_INDIVIDUAL_PRICING_QUOTE,
): number {
  return quote.yearlyAmountMinor / 100;
}

// Round down so the badge never overstates the annual discount.
export function individualYearlySavingsPercent(
  quote: IndividualPricingQuote = STANDARD_INDIVIDUAL_PRICING_QUOTE,
): number {
  return Math.floor((1 - quote.yearlyAmountMinor / (quote.monthlyAmountMinor * 12)) * 100);
}

export function formatIndividualPrice(
  amount: number,
  currency: IndividualPricingCurrency,
): string {
  const hasFraction = Math.abs(amount - Math.round(amount)) > Number.EPSILON;
  return new Intl.NumberFormat(CURRENCY_FORMAT_LOCALE[currency], {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(amount);
}

export function resolveIndividualPricingDeviceContext(): IndividualPricingDeviceContext {
  const localeCandidates = typeof navigator === "undefined"
    ? []
    : [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  let deviceRegion: string | null = null;
  for (const locale of localeCandidates) {
    try {
      const region = new Intl.Locale(locale).region;
      if (region) {
        deviceRegion = region.toUpperCase();
        break;
      }
    } catch {
      // Ignore malformed host locale values and continue to the next one.
    }
  }

  let deviceTimeZone: string | null = null;
  try {
    deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    // A missing timezone means the server will safely return standard USD.
  }
  return { deviceRegion, deviceTimeZone };
}

export function readIndividualPricingQuote(value: unknown): IndividualPricingQuote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const quote = value as Record<string, unknown>;
  if ((quote.assignmentId !== null && !isUuid(quote.assignmentId))
    || typeof quote.pricingRevision !== "string"
    || quote.pricingRevision !== INDIVIDUAL_PRICING.revision
    || !isMarketOrNull(quote.market)
    || !isVariant(quote.variant)
    || !isCurrency(quote.currency)
    || !isPositiveInteger(quote.monthlyAmountMinor)
    || !isPositiveInteger(quote.yearlyAmountMinor)) {
    return null;
  }
  if (quote.variant === "standard") {
    if (quote.assignmentId !== null || quote.market !== null || quote.currency !== "USD") return null;
  } else {
    if (quote.assignmentId === null || quote.market === null) return null;
    if ((quote.variant === "usd_holdout" || quote.variant === "usd_fallback") && quote.currency !== "USD") return null;
    if (quote.variant === "regional" && !regionalCurrencyMatchesMarket(quote.market, quote.currency)) return null;
  }
  return quote as IndividualPricingQuote;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isMarketOrNull(value: unknown): value is IndividualPricingMarket | null {
  return value === null || value === "IN" || value === "ID" || value === "PH" || value === "ZA";
}

function isVariant(value: unknown): value is IndividualPricingVariant {
  return value === "standard" || value === "regional" || value === "usd_holdout" || value === "usd_fallback";
}

function isCurrency(value: unknown): value is IndividualPricingCurrency {
  return value === "USD" || value === "INR" || value === "IDR" || value === "PHP" || value === "ZAR";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function regionalCurrencyMatchesMarket(
  market: IndividualPricingMarket,
  currency: IndividualPricingCurrency,
): boolean {
  return (market === "IN" && currency === "INR")
    || (market === "ID" && currency === "IDR")
    || (market === "PH" && currency === "PHP")
    || (market === "ZA" && currency === "ZAR");
}
