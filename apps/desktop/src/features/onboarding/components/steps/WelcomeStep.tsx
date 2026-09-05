import driftyWordmarkUrl from "../../../../assets/drifty-wordmark-trim.png";
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
      <img className="dc-onb-welcome__wordmark" src={driftyWordmarkUrl} alt="drifty" />
      <span className="dc-onb-welcome__headline">{t(promotionActive ? "onboarding.promo.headline" : "onboarding.welcome.headline")}</span>
      {promotionActive ? (
        <span className="dc-onb-welcome__body">
          {t("onboarding.promo.body")}
        </span>
      ) : (
        <span className="dc-onb-welcome__body">
          <span>{t("onboarding.welcome.body")}</span>
          <span>{t("onboarding.welcome.bodyDetail")}</span>
        </span>
      )}
      {promotionActive ? (
        promotionEndLabel ? (
          <span className="dc-onb-welcome__note">
            {t("onboarding.promo.activeThrough", { date: promotionEndLabel })}
          </span>
        ) : null
      ) : (
        <span className="dc-onb-welcome__note">{t("onboarding.welcome.note")}</span>
      )}
    </div>
  );
}
