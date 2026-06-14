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
  "Richer focus and drift summaries",
  "Account-backed access on this Mac",
  "Local tracking remains local-first",
] as const;

const PRO_PLAN_FEATURES = [
  "Pro model access",
  "Longer context analysis",
  "Priority AI experiments",
  "Advanced weekly review workflows",
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
  onSelectPlan,
}: {
  readonly billingInterval?: VisibleBillingInterval;
  readonly currentPlan?: BillingPlanId | null;
  readonly disabled?: boolean;
  readonly loadingInterval: BillingInterval | null;
  readonly mode?: "checkout" | "display";
  readonly onBillingIntervalChange?: (interval: VisibleBillingInterval) => void;
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
          {loadingInterval === selectedInterval ? "Opening checkout..." : "For one person who wants hosted Cloud AI analysis without managing keys or models."}
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
          <span className="individual-plan-card__cta">{currentPlan === "free" ? "Current plan" : "Included"}</span>
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
        <article className="individual-plan-card individual-plan-card--pro individual-plan-card--coming-soon" aria-label="Pro plan">
          <span className="individual-plan-card__top">
            <span className="individual-plan-card__topline">
              <span>Pro</span>
              <small className="individual-plan-card__badge">Soon</small>
            </span>
            <span className="individual-plan-card__note">For heavier AI workflows and deeper review loops.</span>
            <span className="individual-plan-card__price-row individual-plan-card__price-row--soon">
              <span className="individual-plan-card__price-stack">
                <span className="individual-plan-card__price-line">
                  <strong>Launch pricing</strong>
                </span>
                <span className="individual-plan-card__price-cadence">coming soon</span>
              </span>
            </span>
          </span>
          <PlanFeatureList items={PRO_PLAN_FEATURES} />
          <span className="individual-plan-card__cta individual-plan-card__cta--muted" aria-disabled="true">Coming soon</span>
        </article>
      </div>
    </div>
  );
}
