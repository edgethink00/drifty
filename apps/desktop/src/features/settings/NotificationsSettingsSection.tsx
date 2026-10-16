import { useEffect, useState } from "react";
import { Toggle } from "../../components/Toggle";
import { DRIFT_ALERT_DELAY_OPTIONS, driftAlertDelaySecondsFromValue, driftAlertDelayValueFromSeconds, type DriftAlertDelaySeconds } from "../companion/driftAlarmData";
import type { DriftAlarmCopySettingsValue } from "../companion/driftAlarmCopy";
import type { DriftAlarmCopyOverrides } from "../companion/driftAlarmCopyStorage";
import { DriftAlarmCopySettings } from "../companion/DriftAlarmCopySettings";
import { END_OF_DAY_REVIEW_MINUTE_OPTIONS } from "../companion/endOfDayReviewSchedule";
import {
  QUIET_HOURS_MINUTE_OPTIONS,
  quietHoursMinuteToValue,
  quietHoursValueToMinute,
  normalizeQuietHours,
  type QuietHoursSettings,
} from "../companion/quietHours";
import { requestDriftNotificationPermission } from "../companion/watcherData";
import { openSystemSettingsPane } from "../../lib/api/systemSettingsClient";
import { useSettingsSearch } from "./SettingsSearchContext";
import { SettingsSelect } from "./SettingsSelect";
import { AutomaticCloseSettingsRow } from "./AutomaticCloseSettingsRow";
import { useNativeNotificationAuthorization } from "./useNativeNotificationAuthorization";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import { formatStartOfDayOptionLabel, localeForDisplayLanguage } from "../../lib/formatting";

type NotificationsSettingsSectionProps = {
  readonly driftAlertDelaySeconds: DriftAlertDelaySeconds;
  readonly driftAlertsEnabled: boolean;
  readonly driftAlarmCopy: DriftAlarmCopySettingsValue;
  readonly driftAlarmCopyDefaults: DriftAlarmCopySettingsValue;
  readonly extremeNudgeEnabled: boolean;
  /** The desktop cat is on: the Automatic close consent then shows the cat closing the tab. */
  readonly petEnabled?: boolean;
  readonly hostPlatform?: HostPlatform;
  readonly macosNotificationEnabled: boolean;
  readonly celebrationsEnabled: boolean;
  readonly dayReviewEnabled: boolean;
  readonly dayReviewTimeValue: string;
  readonly quietHours: QuietHoursSettings;
  readonly onDriftAlertDelaySecondsChange: (seconds: DriftAlertDelaySeconds) => void;
  readonly onDriftAlarmCopyOverridesChange: (overrides: DriftAlarmCopyOverrides) => void;
  readonly onDriftAlertsChange: (enabled: boolean) => void;
  readonly onExtremeNudgeChange: (enabled: boolean) => void;
  readonly onMacosNotificationChange: (enabled: boolean) => void;
  readonly onCelebrationsChange: (enabled: boolean) => void;
  readonly onDayReviewEnabledChange: (enabled: boolean) => void;
  readonly onDayReviewTimeChange: (value: string) => void;
  readonly onQuietHoursChange: (settings: QuietHoursSettings) => void;
  /** Injectable for tests; production asks the host OS. */
  readonly requestNotificationPermission?: () => Promise<"granted" | "denied" | "unavailable">;
  /** Injectable for tests; production opens the host's notification settings. */
  readonly openNotificationSettings?: () => Promise<unknown>;
};

function openNotificationSettingsPane() {
  return openSystemSettingsPane("notifications").catch(() => false);
}

export function NotificationsSettingsSection({
  driftAlertDelaySeconds,
  driftAlertsEnabled,
  driftAlarmCopy,
  driftAlarmCopyDefaults,
  extremeNudgeEnabled,
  petEnabled = false,
  hostPlatform = "macos",
  macosNotificationEnabled,
  celebrationsEnabled,
  dayReviewEnabled,
  dayReviewTimeValue,
  quietHours,
  onDriftAlertDelaySecondsChange,
  onDriftAlarmCopyOverridesChange,
  onDriftAlertsChange,
  onExtremeNudgeChange,
  onMacosNotificationChange,
  onCelebrationsChange,
  onDayReviewEnabledChange,
  onDayReviewTimeChange,
  onQuietHoursChange,
  requestNotificationPermission = requestDriftNotificationPermission,
  openNotificationSettings = openNotificationSettingsPane,
}: NotificationsSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { request } = useSettingsSearch();
  const [revealInactiveAlerts, setRevealInactiveAlerts] = useState(false);
  useEffect(() => {
    if (request?.entry.reveal === "notifications-drift") setRevealInactiveAlerts(true);
  }, [request]);
  const locale = localeForDisplayLanguage(effectiveLanguage);
  // Only a host that reports a denial reaches this notice. The desktop
  // notification plugin (2.3.x) reports "granted" on macOS and Windows, so a
  // real OS-level block needs a native permission read before it can show.
  const [notificationPermissionDenied, setNotificationPermissionDenied] = useState(false);
  /* The day review arrives only as a notification; macOS reports when Drifty's are off. */
  const { authorization: notificationAuthorization } = useNativeNotificationAuthorization();
  const dayReviewBlocked = dayReviewEnabled && notificationAuthorization === "denied";

  const driftAlertDelayOptions = DRIFT_ALERT_DELAY_OPTIONS.map((option) => ({
    value: option.value,
    label: localizedDriftAlertDelayLabel(option.value, t),
  }));
  const dayReviewTimeOptions = END_OF_DAY_REVIEW_MINUTE_OPTIONS.map((option) => ({
    value: option.value,
    label: formatStartOfDayOptionLabel(option.minutes, locale),
  }));
  const quietHoursOptions = QUIET_HOURS_MINUTE_OPTIONS.map((option) => ({
    value: option.value,
    label: formatStartOfDayOptionLabel(option.minutes, locale),
  }));
  // Timing and wording only matter while alerts can fire. Keep the values,
  // but read them as inactive so the page shows what is in effect right now.
  const dependentRowClassName = driftAlertsEnabled ? "settings-row" : "settings-row settings-row--disabled";
  /* Same reason the row is greyed: the saved choice is remembered, but while
     alerts are off it is not in effect, so the switch must not read as on.
     Automatic close above shows its effective value for the same reason. */
  const macosNotificationActive = macosNotificationEnabled && driftAlertsEnabled;
  const dayReviewTimeRowClassName = dayReviewEnabled ? "settings-row" : "settings-row settings-row--disabled";
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
  const handleMacosNotificationChange = (enabled: boolean) => {
    onMacosNotificationChange(enabled);
    if (!enabled) {
      setNotificationPermissionDenied(false);
      return;
    }
    // Ask for permission at the moment the switch is turned on, so the
    // The OS prompt arrives in context instead of on the first drift.
    void requestNotificationPermission().then((result) => {
      setNotificationPermissionDenied(result === "denied");
    });
  };
  const updateQuietHours = (patch: Partial<QuietHoursSettings>) => {
    onQuietHoursChange(normalizeQuietHours({ ...quietHours, ...patch }));
  };
  const quietHoursDescription = quietHours.enabled
    ? t("settings.quietHours.enabledDescription", {
      start: formatStartOfDayOptionLabel(quietHours.startMinute, locale),
      end: formatStartOfDayOptionLabel(quietHours.endMinute, locale),
    })
    : t("settings.quietHours.description");
  return (
    <div className="settings-section">
      <div className="settings-block">
        <h3>{t("settings.section.notifications")}</h3>
        <div data-setting-id="settings.notifications.showDriftAlerts" className="settings-row">
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
          petEnabled={petEnabled}
          hostPlatform={hostPlatform}
          availableDescription={t("settings.notifications.extremeOnDescription")}
          prerequisiteDescription={t("settings.notifications.extremeOffDescription")}
          toggleAriaLabel={t("settings.notifications.toggleExtreme")}
        />
        {driftAlertsEnabled || revealInactiveAlerts ? (
          <>
            <div data-setting-id="settings.notifications.timing" className={dependentRowClassName}>
              <div>
                <div className="lbl">{t("settings.notifications.timing")}</div>
                <div className="desc">{t("settings.notifications.timingDescription")}</div>
              </div>
              <div className="ctrl">
                <SettingsSelect
                  ariaLabel={t("settings.notifications.timing")}
                  value={driftAlertDelayValueFromSeconds(driftAlertDelaySeconds)}
                  options={driftAlertDelayOptions}
                  disabled={!driftAlertsEnabled}
                  onChange={(value) => onDriftAlertDelaySecondsChange(driftAlertDelaySecondsFromValue(value))}
                />
              </div>
            </div>
            <div data-setting-id="settings.notifications.macosNotification" className={dependentRowClassName}>
              <div>
                <div className="lbl">{t(hostPlatform === "windows"
                  ? "settings.notifications.windowsNotification"
                  : "settings.notifications.macosNotification")}</div>
                <div className="desc">{t(hostPlatform === "windows"
                  ? "settings.notifications.windowsNotificationDescription"
                  : "settings.notifications.macosNotificationDescription")}</div>
                {notificationPermissionDenied ? (
                  <>
                    <p className="capture-recency capture-recency--error" role="alert">{t(hostPlatform === "windows"
                      ? "settings.notifications.windowsNotificationDenied"
                      : "settings.notifications.macosNotificationDenied")}</p>
                    <button type="button" className="settings-inline-link" onClick={() => void openNotificationSettings()}>
                      {t(hostPlatform === "windows"
                        ? "settings.permissions.openSystemSettingsWindows"
                        : "settings.permissions.openSystemSettings")} <span aria-hidden="true">→</span>
                    </button>
                  </>
                ) : null}
              </div>
              <div className="ctrl">
                <Toggle
                  checked={macosNotificationActive}
                  disabled={!driftAlertsEnabled}
                  onChange={handleMacosNotificationChange}
                  ariaLabel={t(hostPlatform === "windows"
                    ? "settings.notifications.toggleWindowsNotification"
                    : "settings.notifications.toggleMacosNotification")}
                />
              </div>
            </div>
          </>
        ) : null}
        <DriftAlarmCopySettings
          hostPlatform={hostPlatform}
          value={driftAlarmCopy}
          defaults={driftAlarmCopyDefaults}
          onChange={onDriftAlarmCopyOverridesChange}
          disabled={!driftAlertsEnabled}
        />
      </div>

      <div className="settings-block">
        <h3>{t("settings.moments.title")}</h3>
        <div data-setting-id="settings.moments.celebrations" className="settings-row">
          <div>
            <div className="lbl">{t("settings.moments.celebrations")}</div>
            <div className="desc">{t("settings.moments.celebrationsDescription")}</div>
          </div>
          <div className="ctrl">
            <Toggle
              checked={celebrationsEnabled}
              onChange={onCelebrationsChange}
              ariaLabel={t("settings.moments.toggleCelebrations")}
            />
          </div>
        </div>
        <div data-setting-id="settings.moments.dayReview" className="settings-row">
          <div>
            <div className="lbl">{t("settings.moments.dayReview")}</div>
            <div className="desc">{t("settings.moments.dayReviewDescription")}</div>
            {dayReviewBlocked ? (
              <>
                <p className="capture-recency capture-recency--error" role="alert">{t("settings.moments.dayReviewNotificationsOff")}</p>
                <button type="button" className="settings-inline-link" onClick={() => void openNotificationSettings()}>
                  {t("settings.permissions.openSystemSettings")} <span aria-hidden="true">→</span>
                </button>
              </>
            ) : null}
          </div>
          <div className="ctrl">
            <Toggle
              checked={dayReviewEnabled}
              onChange={onDayReviewEnabledChange}
              ariaLabel={t("settings.moments.toggleDayReview")}
            />
          </div>
        </div>
        <div data-setting-id="settings.general.dayReviewTime" className={dayReviewTimeRowClassName}>
          <label>
            <div className="lbl">{t("settings.general.dayReviewTime")}</div>
            <div className="desc">{t("settings.general.dayReviewTimeDescription")}</div>
          </label>
          <div className="ctrl">
            <SettingsSelect
              ariaLabel={t("settings.general.dayReviewTime")}
              value={dayReviewTimeValue}
              options={dayReviewTimeOptions}
              disabled={!dayReviewEnabled}
              onChange={onDayReviewTimeChange}
            />
          </div>
        </div>
      </div>

      <div className="settings-block">
        <h3>{t("settings.quietHours.title")}</h3>
        <div data-setting-id="settings.quietHours.enabled" className="settings-row">
          <div>
            <div className="lbl">{t("settings.quietHours.enabled")}</div>
            <div className="desc">{quietHoursDescription}</div>
          </div>
          <div className="ctrl">
            <Toggle
              checked={quietHours.enabled}
              onChange={(enabled) => updateQuietHours({ enabled })}
              ariaLabel={t("settings.quietHours.toggle")}
            />
          </div>
        </div>
        {quietHours.enabled ? (
          <>
            <div data-setting-id="settings.quietHours.start" className="settings-row">
              <label>
                <div className="lbl">{t("settings.quietHours.start")}</div>
              </label>
              <div className="ctrl">
                <SettingsSelect
                  ariaLabel={t("settings.quietHours.start")}
                  value={quietHoursMinuteToValue(quietHours.startMinute)}
                  options={quietHoursOptions}
                  disabled={!quietHours.enabled}
                  onChange={(value) => updateQuietHours({ startMinute: quietHoursValueToMinute(value, quietHours.startMinute) })}
                />
              </div>
            </div>
            <div data-setting-id="settings.quietHours.end" className="settings-row">
              <label>
                <div className="lbl">{t("settings.quietHours.end")}</div>
              </label>
              <div className="ctrl">
                <SettingsSelect
                  ariaLabel={t("settings.quietHours.end")}
                  value={quietHoursMinuteToValue(quietHours.endMinute)}
                  options={quietHoursOptions}
                  disabled={!quietHours.enabled}
                  onChange={(value) => updateQuietHours({ endMinute: quietHoursValueToMinute(value, quietHours.endMinute) })}
                />
              </div>
            </div>
          </>
        ) : null}
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
