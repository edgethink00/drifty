import type { BillingInterval } from "./billingService";

type IndividualPlan = {
  readonly interval: BillingInterval;
  readonly name: string;
  readonly price: string;
  readonly cadence: string;
  readonly note: string;
  readonly badge?: string;
};

const INDIVIDUAL_PLANS: readonly IndividualPlan[] = [
  {
    interval: "monthly",
    name: "Monthly",
    price: "$10",
    cadence: "billed monthly",
    note: "Flexible Cloud AI access",
  },
  {
    interval: "quarterly",
    name: "Quarterly",
    price: "$27",
    cadence: "billed quarterly",
    note: "$9/mo equivalent",
    badge: "Save 10%",
  },
  {
    interval: "yearly",
    name: "Yearly",
    price: "$96",
    cadence: "billed yearly",
    note: "$8/mo equivalent",
    badge: "Save 20%",
  },
];

export function IndividualPlanCards({
  disabled = false,
  loadingInterval,
  mode = "checkout",
  onSelectPlan,
}: {
  readonly disabled?: boolean;
  readonly loadingInterval: BillingInterval | null;
  readonly mode?: "checkout" | "display";
  readonly onSelectPlan?: (interval: BillingInterval) => void;
}) {
  return (
    <div className={`individual-plan-cards individual-plan-cards--${mode}`} aria-label="Individual billing plans">
      {INDIVIDUAL_PLANS.map((plan) => {
        const className = `individual-plan-card${plan.interval === "yearly" ? " individual-plan-card--featured" : ""}`;
        const content = (
          <>
          <span className="individual-plan-card__topline">
            <span>{plan.name}</span>
            {plan.badge ? <small>{plan.badge}</small> : null}
          </span>
          <strong>{plan.price}</strong>
          <span className="individual-plan-card__cadence">{plan.cadence}</span>
          <span className="individual-plan-card__note">{loadingInterval === plan.interval ? "Opening checkout..." : plan.note}</span>
          </>
        );

        if (mode === "display") {
          return (
            <article key={plan.interval} className={className} aria-label={`${plan.name} plan`}>
              {content}
            </article>
          );
        }

        return (
          <button
            key={plan.interval}
            type="button"
            className={className}
            aria-label={`Choose ${plan.name} plan`}
            onClick={() => onSelectPlan?.(plan.interval)}
            disabled={disabled || loadingInterval !== null}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
