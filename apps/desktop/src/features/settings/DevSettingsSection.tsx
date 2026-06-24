import type { ChangeEvent, RefObject } from "react";
import { Toggle } from "../../components/Toggle";
import { AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED, DEVELOPER_PRE_RELEASE_UPDATES_ENABLED, DRIFT_ALARM_PANEL_PREVIEWS_ENABLED, END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED, REPLAY_ONBOARDING_DEV_TOOL_ENABLED, WATCHER_PEEK_PROTOTYPE_ENABLED } from "../../appFeatureSwitches";
import { DASHBOARD_AI_UNAVAILABLE_PREVIEW_OPTIONS, type DashboardAiUnavailablePreviewCase, type DashboardAiUnavailablePreviewState } from "../dashboard/dashboardAiUnavailablePreview";
import { DRIFT_ALARM_PREVIEW_OPTIONS } from "../companion/driftAlarmData";
import { DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES, WATCHER_PEEK_SETTINGS_VISIBLE, WATCHER_PERIODIC_MAX_LIMIT_MINUTES, WATCHER_PERIODIC_MIN_LIMIT_MINUTES, type WatcherMode } from "../companion/watcherData";
import { DeveloperPreReleaseUpdateRow } from "../updates/DeveloperPreReleaseUpdateRow";
import { formatDayLabel } from "../../lib/formatting";

type DriftAlarmPreviewOption = typeof DRIFT_ALARM_PREVIEW_OPTIONS[number];

type DevSettingsSectionProps = {
  readonly dashboardAiUnavailablePreview: DashboardAiUnavailablePreviewState | null;
  readonly dashboardAiUnavailablePreviewCase: DashboardAiUnavailablePreviewCase;
  readonly endOfDayReviewSettingsRowRef: RefObject<HTMLDivElement>;
  readonly forceChromiumAxCaptureEnabled: boolean;
  readonly forceChromiumAxExtremeNudgeEnabled: boolean;
  readonly forceFrontmostFallbackCaptureEnabled: boolean;
  readonly watcherMode: WatcherMode;
  readonly watcherPeekEnabled: boolean;
  readonly watcherPeriodicMaxMinutes: number;
  readonly watcherPeriodicMinMinutes: number;
  readonly onClearDashboardAiUnavailablePreview: () => void;
  readonly onDashboardAiUnavailablePreviewCaseChange: (previewCase: DashboardAiUnavailablePreviewCase) => void;
  readonly onEndOfDayReviewPreview: () => void;
  readonly onForceChromiumAxCaptureChange: (enabled: boolean) => void;
  readonly onForceChromiumAxExtremeNudgeChange: (enabled: boolean) => void;
  readonly onForceFrontmostFallbackCaptureChange: (enabled: boolean) => void;
  readonly onOpenDebugLogs: () => void;
  readonly onOpenReplayOnboarding: () => void;
  readonly onPreviewDashboardAiUnavailableCase: () => void;
  readonly onPreviewDriftAlarm: (option: DriftAlarmPreviewOption) => void;
  readonly onShowWatcherPeek: (force?: boolean) => void;
  readonly onWatcherModeChange: (mode: WatcherMode) => void;
  readonly onWatcherPeekEnabledChange: (enabled: boolean) => void;
  readonly onWatcherPeriodicMaxChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onWatcherPeriodicMinChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function DevSettingsSection({
  dashboardAiUnavailablePreview,
  dashboardAiUnavailablePreviewCase,
  endOfDayReviewSettingsRowRef,
  forceChromiumAxCaptureEnabled,
  forceChromiumAxExtremeNudgeEnabled,
  forceFrontmostFallbackCaptureEnabled,
  watcherMode,
  watcherPeekEnabled,
  watcherPeriodicMaxMinutes,
  watcherPeriodicMinMinutes,
  onClearDashboardAiUnavailablePreview,
  onDashboardAiUnavailablePreviewCaseChange,
  onEndOfDayReviewPreview,
  onForceChromiumAxCaptureChange,
  onForceChromiumAxExtremeNudgeChange,
  onForceFrontmostFallbackCaptureChange,
  onOpenDebugLogs,
  onOpenReplayOnboarding,
  onPreviewDashboardAiUnavailableCase,
  onPreviewDriftAlarm,
  onShowWatcherPeek,
  onWatcherModeChange,
  onWatcherPeekEnabledChange,
  onWatcherPeriodicMaxChange,
  onWatcherPeriodicMinChange,
}: DevSettingsSectionProps) {
  return (
    <div className="settings-section">
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
      <div className="settings-block">
        <h3>AX fallback diagnostics</h3>
        <div className="settings-row settings-row--fallback">
          <div>
            <div className="lbl">Force Chromium AX site capture</div>
            <div className="desc">Skip Chromium tab AppleScript reads and capture the front URL through the Accessibility address bar path.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={forceChromiumAxCaptureEnabled} onChange={onForceChromiumAxCaptureChange} ariaLabel="Force Chromium Accessibility site capture" />
          </div>
        </div>
        <div className="settings-row settings-row--fallback">
          <div>
            <div className="lbl">Force frontmost fallback tracking</div>
            <div className="desc">Skip System Events frontmost app capture so tracker samples must identify the app through the lsappinfo fallback.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={forceFrontmostFallbackCaptureEnabled} onChange={onForceFrontmostFallbackCaptureChange} ariaLabel="Force frontmost fallback tracking" />
          </div>
        </div>
        <div className="settings-row settings-row--fallback">
          <div>
            <div className="lbl">Force Chromium AX extreme nudge</div>
            <div className="desc">Skip Chromium tab AppleScript close paths so Extreme nudge must use the Accessibility fallback.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={forceChromiumAxExtremeNudgeEnabled} onChange={onForceChromiumAxExtremeNudgeChange} ariaLabel="Force Chromium Accessibility extreme nudge" />
          </div>
        </div>
      </div>
      <div className="settings-block settings-block--dev-preview">
        <h3>Dev</h3>
        {DEVELOPER_PRE_RELEASE_UPDATES_ENABLED ? <DeveloperPreReleaseUpdateRow /> : null}
        {REPLAY_ONBOARDING_DEV_TOOL_ENABLED ? (
          <div className="settings-row">
            <div>
              <div className="lbl">Replay onboarding</div>
              <div className="desc">Open the setup flow again without clearing saved onboarding state.</div>
            </div>
            <div className="ctrl">
              <button type="button" className="settings-btn" onClick={onOpenReplayOnboarding}>Open onboarding</button>
            </div>
          </div>
        ) : null}
        {END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED ? (
          <div className="settings-row" role="group" aria-label="End-of-day review" ref={endOfDayReviewSettingsRowRef} tabIndex={-1}>
            <div>
              <div className="lbl">End-of-day review</div>
              <div className="desc">Dev-only local summary after 6:00 PM, or preview it now.</div>
            </div>
            <div className="ctrl"><button type="button" className="settings-btn" onClick={onEndOfDayReviewPreview}>Preview</button></div>
          </div>
        ) : null}
        {DRIFT_ALARM_PANEL_PREVIEWS_ENABLED ? (
          <div className="settings-row">
            <div>
              <div className="lbl">Drift alarm previews</div>
              <div className="desc">Open sample alarm panels without waiting for tracker drift. Dev builds only.</div>
            </div>
            <div className="ctrl settings-row__actions">
              {DRIFT_ALARM_PREVIEW_OPTIONS.map((option) => (
                <button key={option.id} type="button" className="settings-btn" onClick={() => onPreviewDriftAlarm(option)}>{option.label}</button>
              ))}
            </div>
          </div>
        ) : null}
        {WATCHER_PEEK_SETTINGS_VISIBLE && WATCHER_PEEK_PROTOTYPE_ENABLED ? (
          <>
            <div className="settings-row" role="group" aria-label="Peek watcher prototype">
              <div>
                <div className="lbl">Peek watcher prototype</div>
                <div className="desc">Opt-in experiment for a quiet watcher overlay. Choose a regular cadence or drift-only nudges.</div>
              </div>
              <div className="ctrl settings-row__actions">
                <button type="button" className="settings-btn" onClick={() => onShowWatcherPeek(true)}>Preview</button>
                <Toggle checked={watcherPeekEnabled} onChange={onWatcherPeekEnabledChange} ariaLabel="Toggle peek watcher prototype" />
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="lbl">Watcher mode</div>
                <div className="desc">Choose regular check-ins or a quieter mode that only speaks when drift continues.</div>
              </div>
              <div className="ctrl">
                <div className="settings-mode-switch" role="radiogroup" aria-label="Watcher mode">
                  <button type="button" className={`settings-mode-option${watcherMode === "periodic" ? " is-active" : ""}`} role="radio" aria-checked={watcherMode === "periodic"} onClick={() => onWatcherModeChange("periodic")}>
                    <span>Periodic</span>
                    <small>Every few minutes</small>
                  </button>
                  <button type="button" className={`settings-mode-option${watcherMode === "drift_only" ? " is-active" : ""}`} role="radio" aria-checked={watcherMode === "drift_only"} onClick={() => onWatcherModeChange("drift_only")}>
                    <span>Drift only</span>
                    <small>Quiet during focus</small>
                  </button>
                </div>
              </div>
            </div>
            {watcherMode === "periodic" ? (
              <div className="settings-row">
                <div>
                  <div className="lbl">Periodic cadence</div>
                  <div className="desc">Show the watcher at a random interval inside this range. Default is {DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES.min}-{DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES.max} minutes.</div>
                </div>
                <div className="ctrl settings-row__actions">
                  <input className="settings-input settings-input--compact" type="number" min={WATCHER_PERIODIC_MIN_LIMIT_MINUTES} max={WATCHER_PERIODIC_MAX_LIMIT_MINUTES} value={watcherPeriodicMinMinutes} onChange={onWatcherPeriodicMinChange} aria-label="Minimum watcher interval minutes" />
                  <span className="settings-inline-unit">to</span>
                  <input className="settings-input settings-input--compact" type="number" min={watcherPeriodicMinMinutes} max={WATCHER_PERIODIC_MAX_LIMIT_MINUTES} value={watcherPeriodicMaxMinutes} onChange={onWatcherPeriodicMaxChange} aria-label="Maximum watcher interval minutes" />
                  <span className="settings-inline-unit">min</span>
                </div>
              </div>
            ) : (
              <div className="settings-row">
                <div>
                  <div className="lbl">Drift-only cadence</div>
                  <div className="desc">No focus messages. First nudge appears 10 seconds after drift is detected, then 5 minutes, 30 minutes, 1 hour, and 2 hours if it continues.</div>
                </div>
                <div className="ctrl"><span className="chip">10s · 5m · 30m · 1h · 2h</span></div>
              </div>
            )}
          </>
        ) : null}
      </div>
      {AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED ? (
        <div className="settings-block settings-block--dev-preview">
          <h3>AI unavailable preview</h3>
          <div className="settings-row settings-row--fallback settings-row--ai-preview" role="group" aria-label="AI unavailable preview case">
            <div>
              <div className="lbl">AI unavailable preview</div>
              <div className="desc">
                Apply a selected AI unavailable case to the dashboard three days ago. {dashboardAiUnavailablePreview ? `Active on ${formatDayLabel(dashboardAiUnavailablePreview.appliedDay)}.` : "Dev builds only."}
              </div>
            </div>
            <div className="ctrl settings-row__actions">
              <div className="settings-mode-switch settings-mode-switch--quad" role="radiogroup" aria-label="AI unavailable preview cases">
                {DASHBOARD_AI_UNAVAILABLE_PREVIEW_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`settings-mode-option${dashboardAiUnavailablePreviewCase === option.id ? " is-active" : ""}`}
                    role="radio"
                    aria-checked={dashboardAiUnavailablePreviewCase === option.id}
                    onClick={() => onDashboardAiUnavailablePreviewCaseChange(option.id)}
                  >
                    <span>{option.label}</span>
                    <small>{option.detail}</small>
                  </button>
                ))}
              </div>
              <button type="button" className="settings-btn settings-btn--primary" onClick={onPreviewDashboardAiUnavailableCase}>Preview 3 days ago</button>
              {dashboardAiUnavailablePreview ? <button type="button" className="settings-btn" onClick={onClearDashboardAiUnavailablePreview}>Clear preview</button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
