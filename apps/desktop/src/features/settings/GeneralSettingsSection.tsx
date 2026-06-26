import { Toggle } from "../../components/Toggle";
import { SettingsSelect } from "./SettingsSelect";
import { SettingsBuildInfoRow } from "./SettingsBuildInfoRow";
import { StartupSettingsRow } from "./StartupSettingsRow";
import type { StartOfWeek } from "./settingsStorage";
import {
  START_OF_DAY_OPTIONS,
  START_OF_WEEK_OPTIONS,
} from "./settingsStorage";

type GeneralSettingsSectionProps = {
  readonly devModeEnabled: boolean;
  readonly isDevSettingsEnabled: boolean;
  readonly startOfDayValue: string;
  readonly startOfWeek: StartOfWeek;
  readonly updaterChecking: boolean;
  readonly updaterError: string | null;
  readonly updaterInstalling: boolean;
  readonly updaterMessage: string | null;
  readonly onCheckForUpdates: () => void;
  readonly onRequestAccessibility: () => void;
  readonly onStartOfDayChange: (value: string) => void;
  readonly onStartOfWeekChange: (value: StartOfWeek) => void;
  readonly onDevModeChange: (enabled: boolean) => void;
};

export function GeneralSettingsSection({
  devModeEnabled,
  isDevSettingsEnabled,
  startOfDayValue,
  startOfWeek,
  updaterChecking,
  updaterError,
  updaterInstalling,
  updaterMessage,
  onCheckForUpdates,
  onRequestAccessibility,
  onStartOfDayChange,
  onStartOfWeekChange,
  onDevModeChange,
}: GeneralSettingsSectionProps) {
  return (
    <div className="settings-section settings-section--general">
      <div className="settings-block"><h3>General</h3>
        <div className="settings-row"><label><div className="lbl">Start of day</div><div className="desc">Treat days as starting on this hour. Default is 4:00 AM.</div></label><div className="ctrl"><SettingsSelect ariaLabel="Start of day" value={startOfDayValue} options={START_OF_DAY_OPTIONS} onChange={onStartOfDayChange} /></div></div>
        <div className="settings-row"><label><div className="lbl">Start of week</div><div className="desc">Choose the first day shown for weekly views.</div></label><div className="ctrl"><SettingsSelect ariaLabel="Start of week" value={startOfWeek} options={START_OF_WEEK_OPTIONS} onChange={onStartOfWeekChange} /></div></div>
      </div>
      <div className="settings-block"><h3>Startup</h3>
        <StartupSettingsRow />
      </div>
      <div className="settings-block"><h3>Updates</h3>
        <div className="settings-row"><div><div className="lbl">Automatic update checks</div><div className="desc">Drifty checks for signed updates shortly after launch. General releases stay in the titlebar first; urgent releases can prompt immediately.</div></div><div className="ctrl ctrl--value">Always on</div></div>
        <div className="settings-row"><div><div className="lbl">Manual update check</div><div className="desc">Drifty checks GitHub Releases for signed update metadata before showing an available download.</div>{updaterMessage ? <p className="capture-recency" role="status">{updaterMessage}</p> : null}{updaterError ? <p className="capture-recency capture-recency--error" role="status">{updaterError}</p> : null}</div><div className="ctrl"><button type="button" className="settings-btn" onClick={onCheckForUpdates} disabled={updaterChecking || updaterInstalling}>{updaterChecking ? "Checking..." : "Check for Updates"}</button></div></div>
      </div>
      <div className="settings-block"><h3>Permissions</h3>
        <div className="settings-row"><div><div className="lbl">Accessibility</div><div className="desc">Grant Accessibility permission so Drifty can read window titles for better activity context.</div></div><div className="ctrl"><button type="button" className="settings-btn" onClick={onRequestAccessibility}>Grant Accessibility access</button></div></div>
      </div>
      {isDevSettingsEnabled ? (
        <div className="settings-block"><h3>Debugging</h3>
          <div className="settings-row"><div><div className="lbl">Dev mode</div><div className="desc">Show local diagnostics controls for this build.</div></div><div className="ctrl"><Toggle checked={devModeEnabled} onChange={onDevModeChange} ariaLabel="Toggle Dev mode" /></div></div>
          <SettingsBuildInfoRow />
        </div>
      ) : null}
    </div>
  );
}
