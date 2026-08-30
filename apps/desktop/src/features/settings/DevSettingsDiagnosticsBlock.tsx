import { Toggle } from "../../components/Toggle";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";

type DevSettingsDebugLogsBlockProps = {
  readonly onOpenDebugLogs: () => void;
};

export function DevSettingsDebugLogsBlock({ onOpenDebugLogs }: DevSettingsDebugLogsBlockProps) {
  return (
    <div className="settings-block">
      <h3>Debug logs</h3>
      <div className="settings-row">
        <div>
          <div className="lbl">Debug logs</div>
          <div className="desc">Preview a local JSON bundle with safe app status and setting values.</div>
        </div>
        <div className="ctrl">
          <button type="button" className="settings-btn" onClick={onOpenDebugLogs}>View debug logs</button>
        </div>
      </div>
    </div>
  );
}

type DevSettingsAxFallbackCardProps = {
  readonly forceBrowserHistoryUrlFallbackEnabled: boolean;
  readonly forceChromiumAxCaptureEnabled: boolean;
  readonly forceChromiumAxExtremeNudgeEnabled: boolean;
  readonly forceFrontmostFallbackCaptureEnabled: boolean;
  readonly onForceBrowserHistoryUrlFallbackChange: (enabled: boolean) => void;
  readonly onForceChromiumAxCaptureChange: (enabled: boolean) => void;
  readonly onForceChromiumAxExtremeNudgeChange: (enabled: boolean) => void;
  readonly onForceFrontmostFallbackCaptureChange: (enabled: boolean) => void;
};

export function DevSettingsAxFallbackCard({
  forceBrowserHistoryUrlFallbackEnabled,
  forceChromiumAxCaptureEnabled,
  forceChromiumAxExtremeNudgeEnabled,
  forceFrontmostFallbackCaptureEnabled,
  onForceBrowserHistoryUrlFallbackChange,
  onForceChromiumAxCaptureChange,
  onForceChromiumAxExtremeNudgeChange,
  onForceFrontmostFallbackCaptureChange,
}: DevSettingsAxFallbackCardProps) {
  return (
    <SettingsCollapsibleCard title="AX fallback diagnostics">
      <div className="settings-row">
        <div>
          <div className="lbl">Force Chromium AX site capture</div>
          <div className="desc">Skip Chromium tab AppleScript reads and capture the front URL through the Accessibility address bar path.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={forceChromiumAxCaptureEnabled} onChange={onForceChromiumAxCaptureChange} ariaLabel="Force Chromium Accessibility site capture" />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl">Force frontmost fallback tracking</div>
          <div className="desc">Skip System Events frontmost app capture so tracker samples must identify the app through the lsappinfo fallback.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={forceFrontmostFallbackCaptureEnabled} onChange={onForceFrontmostFallbackCaptureChange} ariaLabel="Force frontmost fallback tracking" />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl">Force browser history URL fallback</div>
          <div className="desc">Skip AppleScript and AX site capture so tracker samples test title-to-history URL matching only.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={forceBrowserHistoryUrlFallbackEnabled} onChange={onForceBrowserHistoryUrlFallbackChange} ariaLabel="Force browser history URL fallback" />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl">Force Chromium AX automatic close</div>
          <div className="desc">Skip Chromium tab AppleScript close paths so Automatic close must use the Accessibility fallback.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={forceChromiumAxExtremeNudgeEnabled} onChange={onForceChromiumAxExtremeNudgeChange} ariaLabel="Force Chromium Accessibility automatic close" />
        </div>
      </div>
    </SettingsCollapsibleCard>
  );
}
