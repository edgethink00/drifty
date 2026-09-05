import { useState } from "react";

import type { BillingInterval } from "./billingService";
import {
  INDIVIDUAL_PRICING,
  INDIVIDUAL_YEARLY_SAVINGS_PERCENT,
  individualMonthlyDisplayAmount,
  type VisibleBillingInterval,
} from "./individualPricing";
import { useLocalization } from "../localization/LocalizationContext";

import "./UpgradeDecisionPanel.css";

export type UpgradeDecisionContext = "trial-active" | "trial-ended" | "upgrade" | "upgrade-local";

export function UpgradeDecisionPanel({
  context,
  disabled = false,
  loadingInterval,
  onContinueLocal,
  onSelectPlan,
}: {
  readonly context: UpgradeDecisionContext;
  readonly disabled?: boolean;
  readonly loadingInterval: BillingInterval | null;
  readonly onContinueLocal?: () => void;
  readonly onSelectPlan: (interval: VisibleBillingInterval) => void;
}) {
  const { t } = useLocalization();
  const [billingInterval, setBillingInterval] = useState<VisibleBillingInterval>("monthly");
  const price = `$${individualMonthlyDisplayAmount(billingInterval)}`;
  const cadence = billingInterval === "monthly"
    ? t("billing.plan.cadenceMonthly")
    : t("billing.plan.cadenceYearly", { amount: INDIVIDUAL_PRICING.yearly.amount });
  const checkoutOpening = loadingInterval !== null;
  const badgeKey = context === "trial-active"
    ? "billing.decision.activeBadge"
    : context === "trial-ended"
      ? "billing.decision.endedBadge"
      : "billing.plan.recommendedBadge";
  const ctaKey = checkoutOpening
    ? "billing.plan.openingCheckout"
    : context === "trial-active"
      ? "billing.decision.activeCta"
      : context === "trial-ended"
        ? "billing.decision.endedCta"
        : "billing.plan.proCta";
  const bodyKey = context === "trial-ended"
    ? "billing.equal.endedBody"
    : context === "trial-active"
      ? "billing.equal.activeBody"
      : context === "upgrade-local"
        ? "billing.equal.localUpgradeBody"
        : "billing.equal.upgradeBody";

  return (
    <div className="upgrade-decision" aria-label={t("billing.decision.panelAria")}>
      <div className="upgrade-decision__intervals" role="radiogroup" aria-label={t("billing.plan.intervalAria")}>
        <button
          type="button"
          className={billingInterval === "monthly" ? "is-active" : ""}
          role="radio"
          aria-checked={billingInterval === "monthly"}
          disabled={checkoutOpening}
          onClick={() => setBillingInterval("monthly")}
        >
          {t("billing.plan.intervalMonthly")}
        </button>
        <button
          type="button"
          className={billingInterval === "yearly" ? "is-active" : ""}
          role="radio"
          aria-checked={billingInterval === "yearly"}
          disabled={checkoutOpening}
          onClick={() => setBillingInterval("yearly")}
        >
          <span>{t("billing.plan.intervalYearly")}</span>
          <small>{t("billing.plan.intervalSavings", { percent: INDIVIDUAL_YEARLY_SAVINGS_PERCENT })}</small>
        </button>
      </div>

      <div className="upgrade-decision__choice-grid" data-choice-ratio="1:1">
        <section className="upgrade-decision__pro-card">
          <div className="upgrade-decision__plan-heading">
            <span>{t("billing.plan.pro")}</span>
            <small>{t(badgeKey)}</small>
          </div>
          <div className="upgrade-decision__choice-price">
            <div>
              <h3>{t("billing.plan.proNote")}</h3>
              <p>{t(bodyKey)}</p>
            </div>
            <div className="upgrade-decision__price" aria-label={`${price} ${cadence}`}>
              <strong>{price}</strong>
              <span>{cadence}</span>
            </div>
          </div>
          <ul className="upgrade-decision__benefits">
            {([
              "billing.decision.benefitAccuracy",
              "billing.decision.benefitNoSetup",
              "billing.decision.benefitDevices",
            ] as const).map((key) => <li key={key}>{t(key)}</li>)}
          </ul>
          <button
            type="button"
            className="upgrade-decision__primary"
            disabled={disabled || checkoutOpening}
            onClick={() => onSelectPlan(billingInterval)}
          >
            {t(ctaKey)}
          </button>
        </section>

        <aside className="upgrade-decision__local-card">
          <span className="upgrade-decision__local-label">
            {t(context === "upgrade-local" ? "billing.equal.localCurrentLabel" : "billing.decision.localLabel")}
          </span>
          <h3>{t("billing.decision.localTitle")}</h3>
          <p>{t(context === "upgrade-local" ? "billing.equal.localCurrentBody" : "billing.decision.localBody")}</p>
          <div className="upgrade-decision__local-facts">
            <div>
              <span>{t("billing.equal.localSetupLabel")}</span>
              <strong>{t("billing.equal.localSetupValue")}</strong>
            </div>
            <div>
              <span>{t("billing.equal.localCaveatLabel")}</span>
              <strong>{t("billing.equal.localCaveatValue")}</strong>
            </div>
          </div>
          {onContinueLocal ? (
            <button
              type="button"
              className="upgrade-decision__local-action"
              disabled={checkoutOpening}
              onClick={onContinueLocal}
            >
              {t("billing.decision.localAction")}
            </button>
          ) : null}
        </aside>
      </div>

      <p className="upgrade-decision__checkout-note">{t("billing.decision.checkoutNote")}</p>
    </div>
  );
}
