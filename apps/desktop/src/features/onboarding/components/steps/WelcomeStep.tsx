import driftyIconUrl from "../../../../assets/drifty-icon.png";
import { useLocalization } from "../../../localization/LocalizationContext";
import { formatBillingAccessEndDate } from "../../../billing/billingAccessCopy";

export function WelcomeStep({
  promotionActive,
  promotionEndsAt,
}: {
  readonly promotionActive: boolean;
  readonly promotionEndsAt: string | null;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const promotionEndLabel = formatBillingAccessEndDate(promotionEndsAt, effectiveLanguage);
  return (
    <div className="dc-onb-welcome">
      <img className="dc-onb-welcome__icon" src={driftyIconUrl} alt="" aria-hidden="true" />
      <span className="dc-onb-welcome__headline">{t(promotionActive ? "onboarding.promo.headline" : "onboarding.welcome.headline")}</span>
      {!promotionActive ? (
        <span className="dc-onb-welcome__headline dc-onb-welcome__headline--muted">
          {t("onboarding.welcome.tagline")}
        </span>
      ) : null}
      <span className="dc-onb-welcome__body">
        {t(promotionActive ? "onboarding.promo.body" : "onboarding.welcome.body")}
      </span>
      {promotionActive && promotionEndLabel ? (
        <span className="dc-onb-welcome__note">
          {t("onboarding.promo.activeThrough", { date: promotionEndLabel })}
        </span>
      ) : null}
    </div>
  );
}
