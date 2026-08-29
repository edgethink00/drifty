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
  const { displayLanguage, effectiveLanguage, setDisplayLanguage, t } = useLocalization();
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
      <div className="dc-onb-welcome__language" role="radiogroup" aria-label={t("onboarding.welcome.languageLabel")}>
        <button
          type="button"
          role="radio"
          aria-checked={displayLanguage === "en"}
          className={displayLanguage === "en" ? "is-active" : ""}
          onClick={() => setDisplayLanguage("en")}
        >
          English
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={displayLanguage === "ko"}
          className={displayLanguage === "ko" ? "is-active" : ""}
          onClick={() => setDisplayLanguage("ko")}
        >
          한국어 <span>{t("common.beta")}</span>
        </button>
      </div>
    </div>
  );
}
