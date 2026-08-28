import type { ReactNode } from "react";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { TRIAL_DAYS } from "./shared";
import { useLocalization } from "../../../localization/LocalizationContext";
import { formatBillingAccessEndDate } from "../../../billing/billingAccessCopy";

type SetupCardProps = {
  readonly badge?: string;
  readonly description: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly selected: boolean;
  readonly onClick: () => void;
};

export function SetupChoiceStep({
  advancedVisible,
  flow,
  onToggleAdvanced,
}: {
  readonly advancedVisible: boolean;
  readonly flow: OnboardingFlow;
  readonly onToggleAdvanced: () => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const promotionEndLabel = formatBillingAccessEndDate(flow.promotionEndsAt, effectiveLanguage)
    ?? t("onboarding.promo.activePeriod");
  return (
    <div className="dc-onb-setup">
      <SetupCard
        badge={flow.promotionActive ? t("onboarding.setup.included") : t("common.recommended")}
        description={flow.promotionActive
          ? t("onboarding.setup.promoCloudDescription", { date: promotionEndLabel })
          : t("onboarding.setup.cloudDescription", { days: TRIAL_DAYS })}
        icon={<CloudIcon />}
        label={t("onboarding.setup.cloud")}
        selected={flow.setupChoice === "simple"}
        onClick={() => flow.handleSetupChoice("simple")}
      />
      <SetupCard
        description={t("onboarding.setup.localDescription")}
        icon={<LocalIcon />}
        label={t("onboarding.setup.local")}
        selected={flow.setupChoice === "local_ai"}
        onClick={() => flow.handleSetupChoice("local_ai")}
      />
      <button
        type="button"
        className="dc-onb-advanced-toggle"
        onClick={onToggleAdvanced}
        aria-expanded={advancedVisible}
      >
        <ChevronIcon rotated={advancedVisible} />
        {t("onboarding.setup.ownProvider")}
      </button>
      {advancedVisible ? (
        <div className="dc-onb-advanced-cards">
          <SetupCard
            description={t("onboarding.setup.byokDescription")}
            icon={<KeyIcon />}
            label={t("onboarding.setup.byok")}
            selected={flow.setupChoice === "byok"}
            onClick={() => flow.handleSetupChoice("byok")}
          />
          <SetupCard
            description={t("onboarding.setup.customDescription")}
            icon={<CustomEndpointIcon />}
            label={t("onboarding.setup.custom")}
            selected={flow.setupChoice === "custom_endpoint"}
            onClick={() => flow.handleSetupChoice("custom_endpoint")}
          />
        </div>
      ) : null}
    </div>
  );
}

function SetupCard({ badge, description, icon, label, selected, onClick }: SetupCardProps) {
  return (
    <button
      type="button"
      className={`dc-onb-setup-card${selected ? " dc-onb-setup-card--selected" : ""}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className="dc-onb-setup-card__icon" aria-hidden="true">{icon}</span>
      <span className="dc-onb-setup-card__copy">
        <span className="dc-onb-setup-card__title-line">
          <span className="dc-onb-setup-card__title">{label}</span>
          {badge ? <span className="dc-onb-setup-card__badge">{badge}</span> : null}
        </span>
        <span className="dc-onb-setup-card__desc">{description}</span>
      </span>
      {selected ? <CheckCircleIcon className="dc-onb-setup-card__check" /> : null}
    </button>
  );
}

function CheckCircleIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ rotated }: { readonly rotated: boolean }) {
  return (
    <span className={rotated ? "dc-onb-chevron dc-onb-chevron--rotated" : "dc-onb-chevron"} aria-hidden="true">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <path d="M5.25 3.5L8.75 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.2 17.2h9.2a4 4 0 0 0 .4-8 5.8 5.8 0 0 0-11 1.8 3.2 3.2 0 0 0 1.4 6.2Z" />
    </svg>
  );
}

function LocalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6.8" width="12" height="8.4" rx="1.4" />
      <path d="M8.4 18h7.2M9.2 9.8h5.6M9.2 12.2h5.6" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.1" cy="15.9" r="2.45" />
      <path d="M9.85 14.15 16.9 7.1M15.35 8.65l1.8 1.8M13.95 10.05l1.25 1.25" />
    </svg>
  );
}

function CustomEndpointIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.4 8.2h7.9a3.8 3.8 0 1 1 0 7.6H9.6M9.6 12h9M9.6 15.8a3.8 3.8 0 1 1 0-7.6h3.7" />
    </svg>
  );
}
