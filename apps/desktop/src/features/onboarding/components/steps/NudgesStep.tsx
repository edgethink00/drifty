import { ToggleButton } from "./shared";
import { useLocalization } from "../../../localization/LocalizationContext";

export function NudgesStep({
  driftAlarmEnabled,
  extremeNudgeEnabled,
  onDriftToggle,
  onExtremeToggle,
}: {
  readonly driftAlarmEnabled: boolean;
  readonly extremeNudgeEnabled: boolean;
  readonly onDriftToggle: () => void;
  readonly onExtremeToggle: () => void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <p className="dc-onb-copy">{t("onboarding.nudges.intro")}</p>
      <ul className="dc-onb-row-list">
        <li className="dc-onb-row">
          <div className="dc-onb-row__copy">
            <span className="dc-onb-row__title">{t("onboarding.nudges.alarm")}</span>
            <span className="dc-onb-row__desc">{t("onboarding.nudges.alarmDescription")}</span>
          </div>
          <ToggleButton label={t("onboarding.nudges.alarm")} on={driftAlarmEnabled} onClick={onDriftToggle} />
        </li>
        <li className={`dc-onb-row${extremeNudgeEnabled ? " dc-onb-row--extreme-on" : ""}`}>
          <div className="dc-onb-row__copy">
            <span className="dc-onb-row__title dc-onb-row__title--with-badge">
              {t("onboarding.nudges.extreme")} <span className="status-badge status-badge--beta">{t("common.beta")}</span>
            </span>
            <span className="dc-onb-row__desc">{t("onboarding.nudges.extremeDescription")}</span>
          </div>
          <ToggleButton label={t("onboarding.nudges.extreme")} on={extremeNudgeEnabled} tone="extreme" onClick={onExtremeToggle} />
        </li>
      </ul>
    </>
  );
}
