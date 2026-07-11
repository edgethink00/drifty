import { Toggle } from "../../components/Toggle";
import { DRIFT_ALERT_DELAY_OPTIONS, driftAlertDelaySecondsFromValue, driftAlertDelayValueFromSeconds, type DriftAlertDelaySeconds } from "../companion/driftAlarmData";
import type { DriftAlarmCopySettingsValue } from "../companion/driftAlarmCopy";
import { DriftAlarmCopySettings } from "../companion/DriftAlarmCopySettings";
import { SettingsSelect } from "./SettingsSelect";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";

type NotificationsSettingsSectionProps = {
  readonly driftAlertDelaySeconds: DriftAlertDelaySeconds;
  readonly driftAlertsEnabled: boolean;
  readonly driftAlarmCopy: DriftAlarmCopySettingsValue;
  readonly extremeNudgeEnabled: boolean;
  readonly onDriftAlertDelaySecondsChange: (seconds: DriftAlertDelaySeconds) => void;
  readonly onDriftAlarmCopyChange: (value: DriftAlarmCopySettingsValue) => void;
  readonly onDriftAlertsChange: (enabled: boolean) => void;
  readonly onExtremeNudgeChange: (enabled: boolean) => void;
};

export function NotificationsSettingsSection({
  driftAlertDelaySeconds,
  driftAlertsEnabled,
  driftAlarmCopy,
  extremeNudgeEnabled,
  onDriftAlertDelaySecondsChange,
  onDriftAlarmCopyChange,
  onDriftAlertsChange,
  onExtremeNudgeChange,
}: NotificationsSettingsSectionProps) {
  const { t } = useLocalization();
  const driftAlertDelayOptions = DRIFT_ALERT_DELAY_OPTIONS.map((option) => ({
    ...option,
    label: localizedDriftAlertDelayLabel(option.value, t),
  }));
  return (
    <div className="settings-section">
      <div className="settings-block">
        <h3>{t("settings.section.notifications")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.notifications.driftAlerts")}</div>
            <div className="desc">{t("settings.notifications.driftAlertsDescription")}</div>
          </div>
          <div className="ctrl">
            <Toggle
              checked={driftAlertsEnabled}
              onChange={(enabled) => {
                onDriftAlertsChange(enabled);
                if (!enabled) onExtremeNudgeChange(false);
              }}
              ariaLabel={t("settings.notifications.toggleDrift")}
            />
          </div>
        </div>
        <div className={`settings-row${driftAlertsEnabled ? "" : " settings-row--disabled"}`}>
          <div>
            <div className="lbl settings-label-with-badge">{t("settings.notifications.extreme")} <span className="settings-beta-badge">{t("common.beta")}</span></div>
            <div className="desc">
              {driftAlertsEnabled
                ? t("settings.notifications.extremeOnDescription")
                : t("settings.notifications.extremeOffDescription")}
            </div>
          </div>
          <div className="ctrl">
            <Toggle
              checked={driftAlertsEnabled && extremeNudgeEnabled}
              disabled={!driftAlertsEnabled}
              onChange={onExtremeNudgeChange}
              ariaLabel={t("settings.notifications.toggleExtreme")}
            />
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.notifications.timing")}</div>
          </div>
          <div className="ctrl">
            <SettingsSelect
              ariaLabel={t("settings.notifications.timing")}
              value={driftAlertDelayValueFromSeconds(driftAlertDelaySeconds)}
              options={driftAlertDelayOptions}
              onChange={(value) => onDriftAlertDelaySecondsChange(driftAlertDelaySecondsFromValue(value))}
              className="settings-select-control--timing"
            />
          </div>
        </div>
        <DriftAlarmCopySettings value={driftAlarmCopy} onChange={onDriftAlarmCopyChange} />
      </div>
    </div>
  );
}

function localizedDriftAlertDelayLabel(value: string, t: LocalizationController["t"]): string {
  switch (value) {
    case "0": return t("settings.notifications.delay0");
    case "30": return t("settings.notifications.delay30");
    case "60": return t("settings.notifications.delay60");
    case "120": return t("settings.notifications.delay120");
    case "300": return t("settings.notifications.delay300");
    case "600": return t("settings.notifications.delay600");
    case "900": return t("settings.notifications.delay900");
    case "1800": return t("settings.notifications.delay1800");
    default: return value;
  }
}
