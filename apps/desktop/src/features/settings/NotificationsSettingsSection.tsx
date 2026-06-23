import { Toggle } from "../../components/Toggle";
import { DRIFT_ALERT_DELAY_OPTIONS, driftAlertDelaySecondsFromValue, driftAlertDelayValueFromSeconds, type DriftAlertDelaySeconds } from "../companion/driftAlarmData";
import type { DriftAlarmCopySettingsValue } from "../companion/driftAlarmCopy";
import { DriftAlarmCopySettings } from "../companion/DriftAlarmCopySettings";
import { SettingsSelect } from "./SettingsSelect";

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
  return (
    <div className="settings-section">
      <div className="settings-block">
        <h3>Notifications</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">Drift alerts</div>
            <div className="desc">Show a drift alarm when current activity is classified as drift.</div>
          </div>
          <div className="ctrl">
            <Toggle
              checked={driftAlertsEnabled}
              onChange={(enabled) => {
                onDriftAlertsChange(enabled);
                if (!enabled) onExtremeNudgeChange(false);
              }}
              ariaLabel="Toggle drift alerts"
            />
          </div>
        </div>
        <div className={`settings-row${driftAlertsEnabled ? "" : " settings-row--disabled"}`}>
          <div>
            <div className="lbl settings-label-with-badge">Extreme nudge <span className="settings-beta-badge">Beta</span></div>
            <div className="desc">
              {driftAlertsEnabled
                ? "Beta feature: close the drift browser tab or quit the drift app instead of showing the alarm."
                : "Turn on Drift alerts before enabling Extreme nudge."}
            </div>
          </div>
          <div className="ctrl">
            <Toggle
              checked={driftAlertsEnabled && extremeNudgeEnabled}
              disabled={!driftAlertsEnabled}
              onChange={onExtremeNudgeChange}
              ariaLabel="Toggle extreme nudge"
            />
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">Drift alert timing</div>
          </div>
          <div className="ctrl">
            <SettingsSelect
              ariaLabel="Drift alert timing"
              value={driftAlertDelayValueFromSeconds(driftAlertDelaySeconds)}
              options={DRIFT_ALERT_DELAY_OPTIONS}
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
