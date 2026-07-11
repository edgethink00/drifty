import driftyIconUrl from "../../../../assets/drifty-icon.png";
import { useLocalization } from "../../../localization/LocalizationContext";

export function WelcomeStep() {
  const { t } = useLocalization();
  return (
    <div className="dc-onb-welcome">
      <img className="dc-onb-welcome__icon" src={driftyIconUrl} alt="" aria-hidden="true" />
      <span className="dc-onb-welcome__headline">{t("onboarding.welcome.headline")}</span>
      <span className="dc-onb-welcome__headline dc-onb-welcome__headline--muted">{t("onboarding.welcome.tagline")}</span>
      <span className="dc-onb-welcome__body">
        {t("onboarding.welcome.body")}
      </span>
    </div>
  );
}
