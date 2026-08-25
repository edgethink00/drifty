import { ToggleButton } from "./shared";
import { OnboardingCatPreview } from "../OnboardingCatPreview";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";

export type DriftIntervention = "off" | "alert" | "close";

export function NudgesStep({
  driftAlarmEnabled,
  extremeNudgeEnabled,
  petModeEnabled,
  onInterventionChange,
  onPetToggle,
}: {
  readonly driftAlarmEnabled: boolean;
  readonly extremeNudgeEnabled: boolean;
  readonly petModeEnabled: boolean;
  readonly onInterventionChange: (next: DriftIntervention) => void;
  readonly onPetToggle: () => void;
}) {
  const { t } = useLocalization();
  const intervention: DriftIntervention = extremeNudgeEnabled ? "close" : driftAlarmEnabled ? "alert" : "off";

  const options: ReadonlyArray<{
    readonly id: DriftIntervention;
    readonly titleKey: TranslationKey;
    readonly descKey: TranslationKey;
    readonly recommended?: boolean;
    readonly beta?: boolean;
  }> = [
    {
      id: "off",
      titleKey: "onboarding.nudges.choiceOff",
      descKey: petModeEnabled ? "onboarding.nudges.choiceOffCatDescription" : "onboarding.nudges.choiceOffDescription",
    },
    {
      id: "alert",
      titleKey: "onboarding.nudges.choiceAlert",
      descKey: petModeEnabled ? "onboarding.nudges.choiceAlertCatDescription" : "onboarding.nudges.choiceAlertDescription",
      recommended: true,
    },
    {
      id: "close",
      titleKey: "onboarding.nudges.choiceClose",
      descKey: petModeEnabled ? "onboarding.nudges.choiceCloseCatDescription" : "onboarding.nudges.choiceCloseDescription",
      beta: true,
    },
  ];

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
        {options.map((option) => {
          const selected = intervention === option.id;
          return (
            <label
              key={option.id}
              className={[
                "dc-onb-intervene__option",
                selected ? "dc-onb-intervene__option--selected" : "",
                selected && option.id === "close" ? "dc-onb-intervene__option--close" : "",
              ].filter(Boolean).join(" ")}
            >
              <input
                type="radio"
                name="dc-onb-intervention"
                className="onb-visually-hidden"
                checked={selected}
                onChange={() => onInterventionChange(option.id)}
              />
              <span className="dc-onb-intervene__radio" aria-hidden="true" />
              <span className="dc-onb-intervene__copy">
                <span className="dc-onb-intervene__title">
                  {t(option.titleKey)}
                  {option.beta ? <span className="status-badge status-badge--beta">{t("common.beta")}</span> : null}
                  {option.recommended ? <span className="dc-onb-intervene__recommended">{t("onboarding.nudges.recommended")}</span> : null}
                </span>
                <span className="dc-onb-intervene__desc">{t(option.descKey)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </>
  );
}
