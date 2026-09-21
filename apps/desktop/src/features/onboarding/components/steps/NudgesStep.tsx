import { ToggleButton } from "./shared";
import { OnboardingCatPreview } from "../OnboardingCatPreview";
import { useLocalization } from "../../../localization/LocalizationContext";

export function NudgesStep({
  extremeNudgeEnabled,
  petModeEnabled,
  onExtremeNudgeToggle,
  onPetToggle,
}: {
  readonly extremeNudgeEnabled: boolean;
  readonly petModeEnabled: boolean;
  readonly onExtremeNudgeToggle: () => void;
  readonly onPetToggle: () => void;
}) {
  const { t } = useLocalization();

  return (
    <>
      <p className="dc-onb-copy">{t("onboarding.nudges.intro")}</p>

      <div className={`dc-onb-cat-card${petModeEnabled ? " dc-onb-cat-card--on" : ""}`}>
        <OnboardingCatPreview
          enabled={petModeEnabled}
          label={t("onboarding.nudges.petPreview")}
          onEnable={onPetToggle}
        />
        <div className="dc-onb-cat-card__copy">
          <span className="dc-onb-cat-card__title">{t("onboarding.nudges.pet")}</span>
          <span className="dc-onb-cat-card__desc">{t("onboarding.nudges.petDescription")}</span>
        </div>
        <ToggleButton label={t("onboarding.nudges.pet")} on={petModeEnabled} onClick={onPetToggle} />
      </div>

      <fieldset className="dc-onb-intervene">
        <legend className="dc-onb-intervene__label">{t("onboarding.nudges.interventionGroup")}</legend>
        <div className={`dc-onb-intervene__option${extremeNudgeEnabled ? " dc-onb-intervene__option--selected dc-onb-intervene__option--close" : ""}`}>
          <span className="dc-onb-intervene__copy">
            <span className="dc-onb-intervene__title">
              {t("onboarding.nudges.choiceClose")}
              <span className="status-badge status-badge--beta">{t("common.beta")}</span>
            </span>
            <span className="dc-onb-intervene__desc">
              {t(petModeEnabled ? "onboarding.nudges.choiceCloseCatDescription" : "onboarding.nudges.choiceCloseDescription")}
            </span>
          </span>
          <ToggleButton
            label={t("onboarding.nudges.choiceClose")}
            on={extremeNudgeEnabled}
            onClick={onExtremeNudgeToggle}
          />
        </div>
      </fieldset>
    </>
  );
}
