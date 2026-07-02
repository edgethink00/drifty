import type { ChangeEvent, RefObject } from "react";
import { Toggle } from "../../components/Toggle";
import { AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED, DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED, DRIFT_ALARM_PANEL_PREVIEWS_ENABLED, END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED, ONBOARDING_V2_2_PREVIEW_ENABLED, REPLAY_ONBOARDING_DEV_TOOL_ENABLED, WATCHER_PEEK_PROTOTYPE_ENABLED } from "../../appFeatureSwitches";
import { DASHBOARD_AI_UNAVAILABLE_PREVIEW_OPTIONS, type DashboardAiUnavailablePreviewCase, type DashboardAiUnavailablePreviewState } from "../dashboard/dashboardAiUnavailablePreview";
import { WATCHER_PEEK_SETTINGS_VISIBLE, type WatcherMode } from "../companion/watcherData";
import { formatDayLabel } from "../../lib/formatting";
import { type DemoDashboardReplayKind, DashboardDemoReplayControls } from "./DashboardDemoReplayControls";
import { DevPreviewControls, type DriftAlarmPreviewOption } from "./DevPreviewControls";
import { WeekDashboardAxisScaleControl } from "./WeekDashboardAxisScaleControl";
import type { DemoDashboardReplaySettings } from "./settingsStorage";

type DevSettingsSectionProps = {
  readonly dashboardAiUnavailablePreview: DashboardAiUnavailablePreviewState | null;
  readonly dashboardAiUnavailablePreviewCase: DashboardAiUnavailablePreviewCase;
  readonly demoDashboardReplaySettings?: DemoDashboardReplaySettings;
  readonly endOfDayReviewSettingsRowRef: RefObject<HTMLDivElement>;
  readonly forceBrowserHistoryUrlFallbackEnabled: boolean;
  readonly forceChromiumAxCaptureEnabled: boolean;
  readonly forceChromiumAxExtremeNudgeEnabled: boolean;
  readonly forceFrontmostFallbackCaptureEnabled: boolean;
  readonly logoAnimationPreviewEnabled: boolean;
  readonly weekDashboardAxisScalePercent: number;
  readonly watcherMode: WatcherMode;
  readonly watcherPeekEnabled: boolean;
  readonly watcherPeriodicMaxMinutes: number;
  readonly watcherPeriodicMinMinutes: number;
  readonly onClearDashboardAiUnavailablePreview: () => void;
  readonly onDashboardAiUnavailablePreviewCaseChange: (previewCase: DashboardAiUnavailablePreviewCase) => void;
  readonly onDemoDashboardReplayDurationSecondsChange?: (value: number) => void;
  readonly onDemoDashboardReplayPreRollSecondsChange?: (value: number) => void;
  readonly onEndOfDayReviewPreview: () => void;
  readonly onOpenOnboardingV22Preview: () => void;
  readonly onForceBrowserHistoryUrlFallbackChange: (enabled: boolean) => void;
  readonly onForceChromiumAxCaptureChange: (enabled: boolean) => void;
  readonly onForceChromiumAxExtremeNudgeChange: (enabled: boolean) => void;
  readonly onForceFrontmostFallbackCaptureChange: (enabled: boolean) => void;
  readonly onLogoAnimationPreviewChange: (enabled: boolean) => void;
  readonly onOpenDebugLogs: () => void;
  readonly onOpenReplayOnboarding: () => void;
  readonly onPreviewDashboardAiUnavailableCase: () => void;
  readonly onPreviewDriftAlarm: (option: DriftAlarmPreviewOption) => void;
  readonly onReplayDashboardDemo?: (kind: DemoDashboardReplayKind) => void;
  readonly onResetDemoDashboardReplaySettings?: () => void;
  readonly onResetWeekDashboardAxisScalePercent: () => void;
  readonly onShowWatcherPeek: (force?: boolean) => void;
  readonly onWeekDashboardAxisScalePercentChange: (scalePercent: number) => void;
  readonly onWatcherModeChange: (mode: WatcherMode) => void;
  readonly onWatcherPeekEnabledChange: (enabled: boolean) => void;
  readonly onWatcherPeriodicMaxChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onWatcherPeriodicMinChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function DevSettingsSection({
  dashboardAiUnavailablePreview,
  dashboardAiUnavailablePreviewCase,
  demoDashboardReplaySettings,
  endOfDayReviewSettingsRowRef,
  forceBrowserHistoryUrlFallbackEnabled,
  forceChromiumAxCaptureEnabled,
  forceChromiumAxExtremeNudgeEnabled,
  forceFrontmostFallbackCaptureEnabled,
  logoAnimationPreviewEnabled,
  weekDashboardAxisScalePercent,
  watcherMode,
  watcherPeekEnabled,
  watcherPeriodicMaxMinutes,
  watcherPeriodicMinMinutes,
  onClearDashboardAiUnavailablePreview,
  onDashboardAiUnavailablePreviewCaseChange,
  onDemoDashboardReplayDurationSecondsChange,
  onDemoDashboardReplayPreRollSecondsChange,
  onEndOfDayReviewPreview,
  onOpenOnboardingV22Preview,
  onForceBrowserHistoryUrlFallbackChange,
  onForceChromiumAxCaptureChange,
  onForceChromiumAxExtremeNudgeChange,
  onForceFrontmostFallbackCaptureChange,
  onLogoAnimationPreviewChange,
  onOpenDebugLogs,
  onOpenReplayOnboarding,
  onPreviewDashboardAiUnavailableCase,
  onPreviewDriftAlarm,
  onReplayDashboardDemo,
  onResetDemoDashboardReplaySettings,
  onResetWeekDashboardAxisScalePercent,
  onShowWatcherPeek,
  onWeekDashboardAxisScalePercentChange,
  onWatcherModeChange,
  onWatcherPeekEnabledChange,
  onWatcherPeriodicMaxChange,
  onWatcherPeriodicMinChange,
}: DevSettingsSectionProps) {
  const showWatcherPeekSettings = WATCHER_PEEK_SETTINGS_VISIBLE && WATCHER_PEEK_PROTOTYPE_ENABLED;
  const showDevPreviewBlock =
    REPLAY_ONBOARDING_DEV_TOOL_ENABLED ||
    ONBOARDING_V2_2_PREVIEW_ENABLED ||
    END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED ||
    DRIFT_ALARM_PANEL_PREVIEWS_ENABLED ||
    showWatcherPeekSettings;

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
      <div className="settings-block settings-block--dev-preview">
        <h3>Motion preview</h3>
        <div className="settings-row settings-row--fallback">
          <div>
            <div className="lbl">Logo animation preview</div>
            <div className="desc">Loop the capture flip on the sidebar logo for motion review.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={logoAnimationPreviewEnabled} onChange={onLogoAnimationPreviewChange} ariaLabel="Toggle logo animation preview" />
          </div>
        </div>
      </div>
      <div className="settings-block settings-block--dev-preview">
        <h3>Dashboard layout</h3>
        <div className="settings-row settings-row--fallback settings-row--week-axis-scale">
          <div>
            <div className="lbl">Your Week y-axis scale</div>
            <div className="desc">Adjust the Week calendar vertical hour scale for layout review.</div>
          </div>
          <div className="ctrl settings-row__actions">
            <WeekDashboardAxisScaleControl
              scalePercent={weekDashboardAxisScalePercent}
              onResetScalePercent={onResetWeekDashboardAxisScalePercent}
              onScalePercentChange={onWeekDashboardAxisScalePercentChange}
            />
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
            <div className="lbl">Force browser history URL fallback</div>
            <div className="desc">Skip AppleScript and AX site capture so tracker samples test title-to-history URL matching only.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={forceBrowserHistoryUrlFallbackEnabled} onChange={onForceBrowserHistoryUrlFallbackChange} ariaLabel="Force browser history URL fallback" />
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
      {showDevPreviewBlock ? (
        <DevPreviewControls
          endOfDayReviewSettingsRowRef={endOfDayReviewSettingsRowRef}
          showWatcherPeekSettings={showWatcherPeekSettings}
          watcherMode={watcherMode}
          watcherPeekEnabled={watcherPeekEnabled}
          watcherPeriodicMaxMinutes={watcherPeriodicMaxMinutes}
          watcherPeriodicMinMinutes={watcherPeriodicMinMinutes}
          onEndOfDayReviewPreview={onEndOfDayReviewPreview}
          onOpenOnboardingV22Preview={onOpenOnboardingV22Preview}
          onOpenReplayOnboarding={onOpenReplayOnboarding}
          onPreviewDriftAlarm={onPreviewDriftAlarm}
          onShowWatcherPeek={onShowWatcherPeek}
          onWatcherModeChange={onWatcherModeChange}
          onWatcherPeekEnabledChange={onWatcherPeekEnabledChange}
          onWatcherPeriodicMaxChange={onWatcherPeriodicMaxChange}
          onWatcherPeriodicMinChange={onWatcherPeriodicMinChange}
        />
      ) : null}
      {DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED ? (
        <div className="settings-block settings-block--dev-preview">
          <h3>Dashboard replay</h3>
          <DashboardDemoReplayControls
            settings={demoDashboardReplaySettings}
            onDurationSecondsChange={onDemoDashboardReplayDurationSecondsChange}
            onPreRollSecondsChange={onDemoDashboardReplayPreRollSecondsChange}
            onReplay={onReplayDashboardDemo}
            onReset={onResetDemoDashboardReplaySettings}
          />
        </div>
      ) : null}
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
