import { useState } from "react";

import type { BillingInterval } from "./billingService";
import {
  STANDARD_INDIVIDUAL_PRICING_QUOTE,
  formatIndividualPrice,
  individualMonthlyDisplayAmount,
  individualYearlyDisplayAmount,
  individualYearlySavingsPercent,
  type IndividualPricingQuote,
  type VisibleBillingInterval,
} from "./individualPricing";
import type { PlanCardState } from "./planCardState";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";

// `individual` remains the billing wire id; Pro is its customer-facing name.
export type BillingPlanId = "free" | "individual";

const INTERVAL_OPTIONS: readonly {
  readonly id: VisibleBillingInterval;
  readonly labelKey: TranslationKey;
  readonly savingsKey?: TranslationKey;
}[] = [
  { id: "monthly", labelKey: "billing.plan.intervalMonthly" },
  { id: "yearly", labelKey: "billing.plan.intervalYearly", savingsKey: "billing.plan.intervalSavings" },
];

const FREE_PLAN_FEATURE_KEYS = [
  "billing.plan.freeFeature1",
  "billing.plan.freeFeature2",
  "billing.plan.freeFeature3",
  "billing.plan.freeFeature4",
] as const satisfies readonly TranslationKey[];

const INDIVIDUAL_PLAN_FEATURE_KEYS = [
  "billing.plan.proFeature1",
  "billing.plan.proFeature2",
  "billing.plan.proFeature3",
  "billing.plan.proFeature4",
] as const satisfies readonly TranslationKey[];

function PlanFeatureList({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="individual-plan-card__feature-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function IndividualPlanCards({
  billingInterval,
  showBillingInterval = true,
  currentPlan = null,
  disabled = false,
  freePlanDisabled = disabled,
  loadingInterval,
  mode = "checkout",
  planState = null,
  onBillingIntervalChange,
  onSelectFreePlan,
  onSelectPlan,
  onManageCurrentPlan,
  manageCurrentPlanLabel,
  manageCurrentPlanLoading = false,
  pricingQuote = null,
}: {
  readonly showBillingInterval?: boolean;
  readonly billingInterval?: VisibleBillingInterval;
  readonly currentPlan?: BillingPlanId | null;
  readonly disabled?: boolean;
  readonly freePlanDisabled?: boolean;
  readonly loadingInterval: BillingInterval | null;
  /** `checkout` and `display` name the host surface for styling. */
  readonly mode?: "checkout" | "display";
  /**
   * The account's real billing state. It decides what each card says; `currentPlan`
   * only decides which card is styled as owned. A trial is Pro access that has
   * not converted, so Pro must stay purchasable while Free stops claiming to be
   * the current plan.
   */
  readonly planState?: PlanCardState | null;
  readonly onBillingIntervalChange?: (interval: VisibleBillingInterval) => void;
  readonly onSelectFreePlan?: () => void;
  readonly onSelectPlan?: (interval: VisibleBillingInterval) => void;
  /**
   * When Pro is the current plan its action becomes billing management.
   * The card already names the plan the user owns, so managing it here removes
   * the need for a separate status row that repeats the same plan name.
   */
  readonly onManageCurrentPlan?: () => void;
  readonly manageCurrentPlanLabel?: string;
  readonly manageCurrentPlanLoading?: boolean;
  readonly pricingQuote?: IndividualPricingQuote | null;
}) {
  const { t } = useLocalization();
  const [internalBillingInterval, setInternalBillingInterval] = useState<VisibleBillingInterval>("monthly");
  const selectedInterval = billingInterval ?? internalBillingInterval;
  const displayedPricing = pricingQuote ?? STANDARD_INDIVIDUAL_PRICING_QUOTE;
  const individualPrice = formatIndividualPrice(
    individualMonthlyDisplayAmount(selectedInterval, displayedPricing),
    displayedPricing.currency,
  );
  const yearlyPrice = formatIndividualPrice(
    individualYearlyDisplayAmount(displayedPricing),
    displayedPricing.currency,
  );
  const individualCadence = selectedInterval === "monthly"
    ? t("billing.plan.cadenceMonthly")
    : t("billing.plan.cadenceYearly", { amount: yearlyPrice });
  const yearlySavingsPercent = individualYearlySavingsPercent(displayedPricing);
  const isTrialing = planState === "pro_trial";
  const individualIsCurrent = currentPlan === "individual";
  const canSelectIndividual = Boolean(onSelectPlan) && !individualIsCurrent;

  const handleIntervalChange = (interval: VisibleBillingInterval) => {
    setInternalBillingInterval(interval);
    onBillingIntervalChange?.(interval);
  };

  const individualBadgeLabel = isTrialing
    ? t("billing.plan.trialBadge")
    : individualIsCurrent
      ? t("billing.plan.currentBadge")
      : t("billing.plan.recommendedBadge");

  const individualContent = (
    <>
      <span className="individual-plan-card__top">
        <span className="individual-plan-card__topline">
          <span>{t("billing.plan.pro")}</span>
          <small className="individual-plan-card__badge">{individualBadgeLabel}</small>
        </span>
        <span className={`individual-plan-card__value${loadingInterval === selectedInterval ? " individual-plan-card__value--status" : ""}`}>
          {loadingInterval === selectedInterval ? t("billing.plan.openingCheckout") : t("billing.plan.proNote")}
        </span>
        <span className="individual-plan-card__price-row">
          <span className="individual-plan-card__price-stack">
            <span className="individual-plan-card__price-line">
              <strong>{individualPrice}</strong>
            </span>
            <span className="individual-plan-card__price-cadence">{individualCadence}</span>
            {displayedPricing.variant === "regional" ? (
              <span className="individual-plan-card__price-cadence individual-plan-card__price-cadence--regional">
                {t("billing.plan.regionalPrice", { currency: displayedPricing.currency })}
              </span>
            ) : null}
          </span>
        </span>
      </span>
      <PlanFeatureList items={INDIVIDUAL_PLAN_FEATURE_KEYS.map((key) => t(key))} />
      {individualIsCurrent && onManageCurrentPlan ? (
        <button
          type="button"
          className="individual-plan-card__cta individual-plan-card__cta--manage"
          disabled={disabled || manageCurrentPlanLoading || loadingInterval !== null}
          onClick={onManageCurrentPlan}
        >
          {manageCurrentPlanLoading
            ? t("billing.plan.openingBilling")
            : manageCurrentPlanLabel ?? t("billing.plan.manageBilling")}
        </button>
      ) : (
        <span className="individual-plan-card__cta">
          {individualIsCurrent ? t("billing.plan.currentPlan") : t("billing.plan.proCta")}
        </span>
      )}
    </>
  );

  const individualCard = canSelectIndividual ? (
    <button
      type="button"
      className="individual-plan-card individual-plan-card--featured"
      aria-label={t("billing.plan.proChooseAria")}
      onClick={() => onSelectPlan?.(selectedInterval)}
      disabled={disabled || loadingInterval !== null || manageCurrentPlanLoading}
    >
      {individualContent}
    </button>
  ) : (
    <article
      className={`individual-plan-card individual-plan-card--featured${individualIsCurrent ? " individual-plan-card--current" : ""}`}
      aria-label={t("billing.plan.proAria")}
    >
      {individualContent}
    </article>
  );

  const intervalSwitch = (
    <div className="individual-plan-intervals" role="radiogroup" aria-label={t("billing.plan.intervalAria")}>
      {INTERVAL_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`individual-plan-interval${selectedInterval === option.id ? " is-active" : ""}`}
          role="radio"
          aria-checked={selectedInterval === option.id}
          tabIndex={selectedInterval === option.id ? 0 : -1}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const nextInterval = event.key === "Home" ? "monthly" : event.key === "End" ? "yearly" : selectedInterval === "monthly" ? "yearly" : "monthly";
            handleIntervalChange(nextInterval);
            const controls = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
            controls?.[nextInterval === "monthly" ? 0 : 1]?.focus();
          }}
          disabled={disabled || loadingInterval !== null || manageCurrentPlanLoading}
          onClick={() => handleIntervalChange(option.id)}
        >
          <span>{t(option.labelKey)}</span>
          {option.savingsKey ? (
            <small className="individual-plan-interval__save">
              {t(option.savingsKey, { percent: yearlySavingsPercent })}
            </small>
          ) : null}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`individual-plan-suite individual-plan-suite--${mode}`} aria-label={t("billing.plan.suiteAria")}>
      {showBillingInterval ? intervalSwitch : null}
      <div className="individual-plan-cards">
        <article
          className={`individual-plan-card${currentPlan === "free" && !isTrialing ? " individual-plan-card--current" : ""}`}
          aria-label={t("billing.plan.freeAria")}
        >
          <span className="individual-plan-card__top">
            <span className="individual-plan-card__topline">
              <span>{t("billing.plan.free")}</span>
            </span>
            <span className="individual-plan-card__value">{t("billing.plan.freeNote")}</span>
            <span className="individual-plan-card__price-row">
              <span className="individual-plan-card__price-stack">
                <span className="individual-plan-card__price-line">
                  <strong>$0</strong>
                </span>
                <span className="individual-plan-card__price-cadence">{t("billing.plan.freeCadence")}</span>
              </span>
            </span>
          </span>
          <PlanFeatureList items={FREE_PLAN_FEATURE_KEYS.map((key) => t(key))} />
          {onSelectFreePlan ? (
            <button type="button" className="individual-plan-card__cta" aria-label={t("billing.plan.freeCtaAria")} disabled={freePlanDisabled || loadingInterval !== null || manageCurrentPlanLoading} onClick={onSelectFreePlan}>
              {t("billing.plan.freeCta")}
            </button>
          ) : (
            <span className="individual-plan-card__cta">
              {/* A trial runs on Pro, so Free is included by it, never the current plan. */}
              {currentPlan === "free" && !isTrialing ? t("billing.plan.currentPlan") : t("billing.plan.included")}
            </span>
          )}
        </article>
        {individualCard}
      </div>
    </div>
  );
}
