import { Toggle } from "../../components/Toggle";
import { DRIFT_ALERT_DELAY_OPTIONS, driftAlertDelaySecondsFromValue, driftAlertDelayValueFromSeconds, type DriftAlertDelaySeconds } from "../companion/driftAlarmData";
import type { DriftAlarmCopySettingsValue } from "../companion/driftAlarmCopy";
import { DriftAlarmCopySettings } from "../companion/DriftAlarmCopySettings";
import type { CompanionResidentPreference } from "../companion/companionPillSettings";
import { SettingsSelect } from "./SettingsSelect";
import { AutomaticCloseSettingsRow } from "./AutomaticCloseSettingsRow";
import { PetSettings } from "./PetCoatPicker";
import type { PetModeCoat, PetModeSize } from "../pet-mode/petModeData";
import { FeatureNewBadge } from "../discovery/FeatureNewBadge";
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
  readonly petModeEnabled: boolean;
  readonly petModeCoat: PetModeCoat;
  readonly petModeSize: PetModeSize;
  readonly showPetNewBadge?: boolean;
  readonly onPetModeEnabledChange: (enabled: boolean) => void;
  readonly onPetModeCoatChange: (coat: PetModeCoat) => void;
  readonly onPetModeSizeChange: (size: PetModeSize) => void;
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
  petModeEnabled,
  petModeCoat,
  petModeSize,
  showPetNewBadge = false,
  onPetModeEnabledChange,
  onPetModeCoatChange,
  onPetModeSizeChange,
}: NotificationsSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const companionTemporarilyHidden = companionHiddenUntil !== null && companionHiddenUntil > Date.now();
  const hiddenUntilLabel = companionHiddenUntil !== null && companionHiddenUntil > Date.now()
    ? new Intl.DateTimeFormat(effectiveLanguage === "ko" ? "ko-KR" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(companionHiddenUntil))
    : null;
  const driftAlertDelayOptions = DRIFT_ALERT_DELAY_OPTIONS.map((option) => ({
    ...option,
    label: localizedDriftAlertDelayLabel(option.value, t),
  }));
  return (
    <div className="settings-section">
      <div className="settings-block">
        <h3>{t("settings.section.notifications")}</h3>
        {companionSurfacePolicy === "off" ? (
          <div className="settings-row">
            <div>
              <div className="lbl">{t("settings.companion.offTitle")}</div>
              <div className="desc">{t("settings.companion.offDescription")}</div>
            </div>
            <div className="ctrl">
              <button
                type="button"
                className="settings-btn"
                onClick={() => onCompanionSurfacePolicyChange("menuBar")}
              >
                {t("settings.companion.showInMenuBar")}
              </button>
            </div>
          </div>
        ) : <>
          <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.companion.temporaryHide")}</div>
            <div className="desc">
              {hiddenUntilLabel
                ? t("settings.companion.hiddenUntil", { time: hiddenUntilLabel })
                : t("settings.companion.temporaryHideDescription")}
            </div>
          </div>
          <div className="ctrl">
            <button
              type="button"
              className="settings-btn"
              onClick={companionTemporarilyHidden ? onShowCompanionNow : onHideCompanionForOneHour}
            >
              {companionTemporarilyHidden
                ? t("settings.companion.showNow")
                : t("settings.companion.hideOneHour")}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.companion.turnOff")}</div>
            <div className="desc">{t("settings.companion.offDescription")}</div>
          </div>
          <div className="ctrl">
            <button
              type="button"
              className="settings-btn"
              onClick={() => onCompanionSurfacePolicyChange("off")}
            >
              {t("common.off")}
            </button>
          </div>
        </div>
        </>}
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
              onChange={(enabled) => {
                onDriftAlertsChange(enabled);
                if (!enabled) onExtremeNudgeChange(false);
              }}
              ariaLabel={t("settings.notifications.toggleDrift")}
            />
          </div>
        </div>
        <AutomaticCloseSettingsRow
          checked={extremeNudgeEnabled}
          disabled={!driftAlertsEnabled}
          onChange={onExtremeNudgeChange}
          onDescription={t("settings.notifications.extremeOnDescription")}
          offDescription={t("settings.notifications.extremeOffDescription")}
          toggleAriaLabel={t("settings.notifications.toggleExtreme")}
        />
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

      {/* The pet is a companion surface, so it belongs on this tab rather than
          in Appearance, which covers the app's own chrome. It sits last because
          it is the most optional of the three: the pill and drift alerts are
          core to how Drifty nudges, while the pet is decoration you opt into. */}
      <div className="settings-block">
        <h3 className={showPetNewBadge ? "settings-block__title-with-badge" : undefined}>{t("settings.pet.title")}{showPetNewBadge ? <FeatureNewBadge /> : null}</h3>
        <PetSettings
          enabled={petModeEnabled}
          onEnabledChange={onPetModeEnabledChange}
          coat={petModeCoat}
          onCoatChange={onPetModeCoatChange}
          size={petModeSize}
          onSizeChange={onPetModeSizeChange}
          automaticCloseEnabled={extremeNudgeEnabled}
          automaticCloseDisabled={!driftAlertsEnabled}
          onAutomaticCloseChange={onExtremeNudgeChange}
        />
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
