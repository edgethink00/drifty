import { Toggle } from "../../components/Toggle";
import { DRIFT_ALERT_DELAY_OPTIONS, driftAlertDelaySecondsFromValue, driftAlertDelayValueFromSeconds, type DriftAlertDelaySeconds } from "../companion/driftAlarmData";
import type { DriftAlarmCopySettingsValue } from "../companion/driftAlarmCopy";
import { DriftAlarmCopySettings } from "../companion/DriftAlarmCopySettings";
import type { CompanionResidentPreference } from "../companion/companionPillSettings";
import { SettingsSelect } from "./SettingsSelect";
import { AutomaticCloseSettingsRow } from "./AutomaticCloseSettingsRow";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";

type NotificationsSettingsSectionProps = {
  readonly companionHiddenUntil: number | null;
  readonly companionSurfacePolicy: CompanionResidentPreference;
  readonly driftAlertDelaySeconds: DriftAlertDelaySeconds;
  readonly driftAlertsEnabled: boolean;
  readonly driftAlarmCopy: DriftAlarmCopySettingsValue;
  readonly extremeNudgeEnabled: boolean;
  readonly onDriftAlertDelaySecondsChange: (seconds: DriftAlertDelaySeconds) => void;
  readonly onDriftAlarmCopyChange: (value: DriftAlarmCopySettingsValue) => void;
  readonly onDriftAlertsChange: (enabled: boolean) => void;
  readonly onExtremeNudgeChange: (enabled: boolean) => void;
  readonly onHideCompanionForOneHour: () => void;
  readonly onShowCompanionNow: () => void;
  readonly onCompanionSurfacePolicyChange: (policy: CompanionResidentPreference) => void;

};

export function NotificationsSettingsSection({
  companionHiddenUntil,
  companionSurfacePolicy,
  driftAlertDelaySeconds,
  driftAlertsEnabled,
  driftAlarmCopy,
  extremeNudgeEnabled,
  onDriftAlertDelaySecondsChange,
  onDriftAlarmCopyChange,
  onDriftAlertsChange,
  onExtremeNudgeChange,
  onHideCompanionForOneHour,
  onShowCompanionNow,
  onCompanionSurfacePolicyChange,

}: NotificationsSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();

  const companionTemporarilyHidden = companionHiddenUntil !== null && companionHiddenUntil > Date.now();
  const hiddenUntilLabel = companionHiddenUntil !== null && companionHiddenUntil > Date.now()
    ? new Intl.DateTimeFormat(effectiveLanguage === "ko" ? "ko-KR" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(companionHiddenUntil))
    : null;
  const companionOff = companionSurfacePolicy === "off";
  const companionVisibilityDescription = companionOff
    ? t("settings.companion.offDescription")
    : hiddenUntilLabel
      ? t("settings.companion.hiddenUntil", { time: hiddenUntilLabel })
      : t("settings.companion.visibleDescription");
  const driftAlertDelayOptions = DRIFT_ALERT_DELAY_OPTIONS.map((option) => ({
    ...option,
    label: localizedDriftAlertDelayLabel(option.value, t),
  }));
  const handleAutomaticCloseChange = (enabled: boolean) => {
    if (enabled && !driftAlertsEnabled) {
      onDriftAlertsChange(true);
    }
    onExtremeNudgeChange(enabled);
  };
  const handleDriftAlertsChange = (enabled: boolean) => {
    onDriftAlertsChange(enabled);
    if (!enabled && extremeNudgeEnabled) {
      onExtremeNudgeChange(false);
    }
  };
  return (
    <div className="settings-section">
      <div className="settings-block">
        <h3>{t("settings.section.notifications")}</h3>
        <div className="settings-row settings-row--companion-visibility">
          <div>
            <div className="lbl">{t("settings.companion.visibility")}</div>
            <div className="desc">{companionVisibilityDescription}</div>
          </div>
          <div
            className="ctrl settings-row__actions companion-visibility-actions"
            role="group"
            aria-label={t("settings.companion.visibility")}
          >
            <button
              type="button"
              className="settings-btn companion-visibility-actions__temporary"
              disabled={companionOff}
              onClick={companionTemporarilyHidden ? onShowCompanionNow : onHideCompanionForOneHour}
            >
              {companionTemporarilyHidden
                ? t("settings.companion.showNow")
                : t("settings.companion.hideOneHour")}
            </button>
            <button
              type="button"
              className="settings-btn companion-visibility-actions__power"
              onClick={() => onCompanionSurfacePolicyChange(companionOff ? "menuBar" : "off")}
            >
              {companionOff
                ? t("settings.companion.turnOn")
                : t("settings.companion.turnOff")}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-block">
        <h3>{t("settings.notifications.driftAlerts")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.notifications.showDriftAlerts")}</div>
            <div className="desc">{t("settings.notifications.driftAlertsDescription")}</div>
          </div>
          <div className="ctrl">
            <Toggle
              checked={driftAlertsEnabled}
              onChange={handleDriftAlertsChange}
              ariaLabel={t("settings.notifications.toggleDrift")}
            />
          </div>
        </div>
        <AutomaticCloseSettingsRow
          checked={extremeNudgeEnabled}
          prerequisiteMissing={!driftAlertsEnabled}
          onChange={handleAutomaticCloseChange}
          availableDescription={t("settings.notifications.extremeOnDescription")}
          prerequisiteDescription={t("settings.notifications.extremeOffDescription")}
          toggleAriaLabel={t("settings.notifications.toggleExtreme")}
        />
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.notifications.timing")}</div>
            <div className="desc">{t("settings.notifications.timingDescription")}</div>
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
