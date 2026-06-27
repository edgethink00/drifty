import { useState } from "react";

import type { BillingInterval } from "./billingService";

export type BillingPlanId = "free" | "individual" | "pro";

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
  "Drifty Cloud AI analysis",
  "2 active Macs included",
  "Richer focus and drift summaries",
  "Manage old Macs from Account settings",
  "Local tracking remains local-first",
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
}: {
  readonly billingInterval?: VisibleBillingInterval;
  readonly currentPlan?: BillingPlanId | null;
  readonly disabled?: boolean;
  readonly loadingInterval: BillingInterval | null;
  readonly mode?: "checkout" | "display";
  readonly onBillingIntervalChange?: (interval: VisibleBillingInterval) => void;
  readonly onSelectFreePlan?: () => void;
  readonly onSelectPlan?: (interval: VisibleBillingInterval) => void;
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

  const individualContent = (
    <>
      <span className="individual-plan-card__top">
        <span className="individual-plan-card__topline">
          <span>Individual</span>
          <small className="individual-plan-card__badge">{individualIsCurrent ? "Current plan" : "Cloud AI"}</small>
        </span>
        <span className="individual-plan-card__note">
          {loadingInterval === selectedInterval ? "Opening checkout..." : "For one person who wants hosted Cloud AI analysis on up to 2 active Macs without managing keys or models."}
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
      <span className="individual-plan-card__cta">{individualIsCurrent ? "Current plan" : "Start Individual"}</span>
    </>
  );

  return (
    <div className={`individual-plan-suite individual-plan-suite--${mode}`} aria-label="Drifty billing plans">
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
      <div className="individual-plan-cards">
        <article className={`individual-plan-card${currentPlan === "free" ? " individual-plan-card--current" : ""}`} aria-label="Free plan">
          <span className="individual-plan-card__top">
            <span className="individual-plan-card__topline">
              <span>Free</span>
              <small className="individual-plan-card__badge">Local-first</small>
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
        {canSelectIndividual ? (
          <button
            type="button"
            className="individual-plan-card individual-plan-card--featured"
            aria-label="Choose Individual plan"
            onClick={() => onSelectPlan?.(selectedInterval)}
            disabled={disabled || loadingInterval !== null}
          >
            {individualContent}
          </button>
        ) : (
          <article
            className={`individual-plan-card individual-plan-card--featured${individualIsCurrent ? " individual-plan-card--current" : ""}`}
            aria-label="Individual plan"
          >
            {individualContent}
          </article>
        )}
      </div>
    </div>
  );
}
