import { Toggle } from "../../components/Toggle";
import { DRIFT_ALERT_DELAY_OPTIONS, driftAlertDelaySecondsFromValue, driftAlertDelayValueFromSeconds, type DriftAlertDelaySeconds } from "../companion/driftAlarmData";
import type { DriftAlarmCopySettingsValue } from "../companion/driftAlarmCopy";
import { DriftAlarmCopySettings } from "../companion/DriftAlarmCopySettings";
import {
  COMPANION_MENU_BAR_DISPLAY_OPTIONS,
  COMPANION_SURFACE_POLICY_OPTIONS,
  type CompanionSurfacePolicy,
} from "../companion/companionPillSettings";
import type { TrayDisplayMode } from "@drifty/domain";
import { SettingsSelect } from "./SettingsSelect";
import { PetSettings } from "./PetCoatPicker";
import type { PetModeCoat, PetModeSize } from "../pet-mode/petModeData";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";

type NotificationsSettingsSectionProps = {
  readonly companionSettingsVisible?: boolean;
  readonly companionHiddenUntil: number | null;
  readonly companionSurfacePolicy: CompanionSurfacePolicy;
  readonly companionMenuBarDisplayMode: TrayDisplayMode;
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
  readonly onCompanionSurfacePolicyChange: (policy: CompanionSurfacePolicy) => void;
  readonly onCompanionMenuBarDisplayModeChange: (mode: TrayDisplayMode) => void;
  readonly petModeEnabled: boolean;
  readonly petModeCoat: PetModeCoat;
  readonly petModeSize: PetModeSize;
  readonly onPetModeEnabledChange: (enabled: boolean) => void;
  readonly onPetModeCoatChange: (coat: PetModeCoat) => void;
  readonly onPetModeSizeChange: (size: PetModeSize) => void;
};

export function NotificationsSettingsSection({
  companionSettingsVisible = true,
  companionHiddenUntil,
  companionSurfacePolicy,
  companionMenuBarDisplayMode,
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
  onCompanionMenuBarDisplayModeChange,
  petModeEnabled,
  petModeCoat,
  petModeSize,
  onPetModeEnabledChange,
  onPetModeCoatChange,
  onPetModeSizeChange,
}: NotificationsSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const companionEnabled = companionSurfacePolicy !== "off";
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
      {companionSettingsVisible ? <div className="settings-block">
        <h3>{t("settings.section.notifications")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.companion.placement")}</div>
            <div className="desc">{companionSurfacePolicyDescription(companionSurfacePolicy, t)}</div>
          </div>
          <div className="ctrl">
            <div className="settings-mode-switch settings-mode-switch--compact" role="radiogroup" aria-label={t("settings.companion.placement")}>
              {COMPANION_SURFACE_POLICY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`settings-mode-option${companionSurfacePolicy === option.value ? " is-active" : ""}`}
                  role="radio"
                  aria-checked={companionSurfacePolicy === option.value}
                  onClick={() => onCompanionSurfacePolicyChange(option.value)}
                >
                  <span>{localizedCompanionPolicyLabel(option.value, t)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {companionSurfacePolicy === "menuBar" && (
          <div className="settings-row">
            <div>
              <div className="lbl">{t("settings.companion.menuBarDisplay")}</div>
              <div className="desc">{companionMenuBarDisplayMode === "focusTime"
                ? t("settings.companion.focusTimeDescription")
                : companionMenuBarDisplayMode === "donutFocusTime"
                  ? t("settings.companion.donutFocusTimeDescription")
                  : t("settings.companion.donutDescription")}</div>
            </div>
            <div className="ctrl">
              <div className="settings-mode-switch settings-mode-switch--triple" role="radiogroup" aria-label={t("settings.companion.menuBarDisplay")}>
                {COMPANION_MENU_BAR_DISPLAY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`settings-mode-option${companionMenuBarDisplayMode === option.value ? " is-active" : ""}`}
                    role="radio"
                    aria-checked={companionMenuBarDisplayMode === option.value}
                    onClick={() => onCompanionMenuBarDisplayModeChange(option.value)}
                  >
                    <span>{option.value === "focusTime"
                      ? t("settings.companion.focusTime")
                      : option.value === "donutFocusTime"
                        ? t("settings.companion.donutFocusTime")
                        : t("settings.companion.donut")}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className={`settings-row${companionEnabled ? "" : " settings-row--disabled"}`}>
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
              disabled={!companionEnabled}
              onClick={companionTemporarilyHidden ? onShowCompanionNow : onHideCompanionForOneHour}
            >
              {companionTemporarilyHidden
                ? t("settings.companion.showNow")
                : t("settings.companion.hideOneHour")}
            </button>
          </div>
        </div>
      </div> : null}

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

      {/* The pet is a companion surface, so it belongs on this tab rather than
          in Appearance, which covers the app's own chrome. It sits last because
          it is the most optional of the three: the pill and drift alerts are
          core to how Drifty nudges, while the pet is decoration you opt into. */}
      <div className="settings-block">
        <h3>Desktop pet</h3>
        <PetSettings
          enabled={petModeEnabled}
          onEnabledChange={onPetModeEnabledChange}
          coat={petModeCoat}
          onCoatChange={onPetModeCoatChange}
          size={petModeSize}
          onSizeChange={onPetModeSizeChange}
        />
      </div>
    </div>
  );
}

function companionSurfacePolicyDescription(
  policy: CompanionSurfacePolicy,
  t: LocalizationController["t"],
): string {
  if (policy === "menuBar") return t("settings.companion.menuBarDescription");
  if (policy === "floating") return t("settings.companion.floatingDescription");
  return t("settings.companion.offDescription");
}

function localizedCompanionPolicyLabel(
  policy: CompanionSurfacePolicy,
  t: LocalizationController["t"],
): string {
  if (policy === "menuBar") return t("settings.companion.menuBar");
  if (policy === "floating") return t("settings.companion.floating");
  return t("common.off");
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
