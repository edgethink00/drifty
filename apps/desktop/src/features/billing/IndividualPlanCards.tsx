import { useState } from "react";

import type { BillingInterval } from "./billingService";

// `individual` remains the billing wire id; Pro is its customer-facing name.
export type BillingPlanId = "free" | "individual";

type VisibleBillingInterval = Extract<BillingInterval, "monthly" | "yearly">;

type IndividualPrice = {
  readonly price: string;
  readonly cadence: string;
};

const INTERVAL_OPTIONS: readonly { readonly id: VisibleBillingInterval; readonly label: string; readonly savings?: string }[] = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly", savings: "Save 20%" },
];

const INDIVIDUAL_PRICE_BY_INTERVAL: Record<VisibleBillingInterval, IndividualPrice> = {
  monthly: {
    price: "$5",
    cadence: "/ month",
  },
  yearly: {
    price: "$4",
    cadence: "/ month · $48 billed yearly",
  },
};

const FREE_PLAN_FEATURES = [
  "Local classification and predefined rules",
  "OpenRouter API key supported",
  "Self-hosted local AI endpoint supported",
  "No drifty Cloud billing required",
] as const;

const INDIVIDUAL_PLAN_FEATURES = [
  "Includes all Free plan features",
  "No API keys or models to manage",
  "Richer focus and drift summaries",
  "Cloud AI classification on up to 2 Macs",
] as const;

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
  currentPlan = null,
  disabled = false,
  loadingInterval,
  mode = "checkout",
  onBillingIntervalChange,
  onSelectFreePlan,
  onSelectPlan,
  onManageCurrentPlan,
  manageCurrentPlanLabel = "Manage billing",
  manageCurrentPlanLoading = false,
}: {
  readonly billingInterval?: VisibleBillingInterval;
  readonly currentPlan?: BillingPlanId | null;
  readonly disabled?: boolean;
  readonly loadingInterval: BillingInterval | null;
  /** `checkout` and `display` name the host surface for styling. */
  readonly mode?: "checkout" | "display";
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
}) {
  const [internalBillingInterval, setInternalBillingInterval] = useState<VisibleBillingInterval>("monthly");
  const selectedInterval = billingInterval ?? internalBillingInterval;
  const individualPrice = INDIVIDUAL_PRICE_BY_INTERVAL[selectedInterval];
  const individualIsCurrent = currentPlan === "individual";
  const canSelectIndividual = Boolean(onSelectPlan) && !individualIsCurrent;

  const handleIntervalChange = (interval: VisibleBillingInterval) => {
    setInternalBillingInterval(interval);
    onBillingIntervalChange?.(interval);
  };

  const individualBadgeLabel = individualIsCurrent
    ? "Current plan"
    : "Recommended";

  const individualContent = (
    <>
      <span className="individual-plan-card__top">
        <span className="individual-plan-card__topline">
          <span>Pro</span>
          <small className="individual-plan-card__badge">{individualBadgeLabel}</small>
        </span>
        <span className="individual-plan-card__note">
          {loadingInterval === selectedInterval ? "Opening checkout..." : "Automatic AI classification while tracking stays local-first."}
        </span>
        <span className="individual-plan-card__price-row">
          <span className="individual-plan-card__price-stack">
            <span className="individual-plan-card__price-line">
              <strong>{individualPrice.price}</strong>
            </span>
            <span className="individual-plan-card__price-cadence">{individualPrice.cadence}</span>
          </span>
        </span>
      </span>
      <PlanFeatureList items={INDIVIDUAL_PLAN_FEATURES} />
      {individualIsCurrent && onManageCurrentPlan ? (
        <button
          type="button"
          className="individual-plan-card__cta individual-plan-card__cta--manage"
          disabled={disabled || manageCurrentPlanLoading}
          onClick={onManageCurrentPlan}
        >
          {manageCurrentPlanLoading ? "Opening billing..." : manageCurrentPlanLabel}
        </button>
      ) : (
        <span className="individual-plan-card__cta">{individualIsCurrent ? "Current plan" : "Upgrade to Pro"}</span>
      )}
    </>
  );

  const individualCard = canSelectIndividual ? (
    <button
      type="button"
      className="individual-plan-card individual-plan-card--featured"
      aria-label="Choose Pro plan"
      onClick={() => onSelectPlan?.(selectedInterval)}
      disabled={disabled || loadingInterval !== null}
    >
      {individualContent}
    </button>
  ) : (
    <article
      className={`individual-plan-card individual-plan-card--featured${individualIsCurrent ? " individual-plan-card--current" : ""}`}
      aria-label="Pro plan"
    >
      {individualContent}
    </article>
  );

  const intervalSwitch = (
    <div className="individual-plan-intervals" role="radiogroup" aria-label="Billing interval">
      {INTERVAL_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`individual-plan-interval${selectedInterval === option.id ? " is-active" : ""}`}
          role="radio"
          aria-checked={selectedInterval === option.id}
          onClick={() => handleIntervalChange(option.id)}
        >
          <span>{option.label}</span>
          {option.savings ? <small className="individual-plan-interval__save">{option.savings}</small> : null}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`individual-plan-suite individual-plan-suite--${mode}`} aria-label="Drifty billing plans">
      {intervalSwitch}
      <div className="individual-plan-cards">
        <article className={`individual-plan-card${currentPlan === "free" ? " individual-plan-card--current" : ""}`} aria-label="Free plan">
          <span className="individual-plan-card__top">
            <span className="individual-plan-card__topline">
              <span>Free</span>
            </span>
            <span className="individual-plan-card__note">Use drifty locally with rule-based classification and your own optional AI setup.</span>
            <span className="individual-plan-card__price-row">
              <span className="individual-plan-card__price-stack">
                <span className="individual-plan-card__price-line">
                  <strong>$0</strong>
                </span>
                <span className="individual-plan-card__price-cadence">forever</span>
              </span>
            </span>
          </span>
          <PlanFeatureList items={FREE_PLAN_FEATURES} />
          {onSelectFreePlan ? (
            <button type="button" className="individual-plan-card__cta" aria-label="Open AI setup" onClick={onSelectFreePlan}>
              AI setup
            </button>
          ) : (
            <span className="individual-plan-card__cta">{currentPlan === "free" ? "Current plan" : "Included"}</span>
          )}
        </article>
        {individualCard}
      </div>
    </div>
  );
}
