import type { ChangeEvent, RefObject } from "react";
import { Toggle } from "../../components/Toggle";
import { AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED, DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED } from "../../appFeatureSwitches";
import { DASHBOARD_AI_UNAVAILABLE_PREVIEW_OPTIONS, type DashboardAiUnavailablePreviewCase, type DashboardAiUnavailablePreviewState } from "../dashboard/dashboardAiUnavailablePreview";
import { WATCHER_PEEK_SETTINGS_VISIBLE, type WatcherMode } from "../companion/watcherData";
import { formatDayLabel } from "../../lib/formatting";
import { type DemoDashboardReplayKind, DashboardDemoReplayControls } from "./DashboardDemoReplayControls";
import { DevPreviewControls, type DriftAlarmPreviewOption } from "./DevPreviewControls";
import type { AiReviewEvent, ProjectPassRun } from "@drifty/domain";
import type { DemoDashboardReplaySettings } from "./settingsStorage";
import type { PreReleaseUpdateStatus } from "../updates/useDeveloperPreReleaseUpdateController";
import { PreReleaseUpdatesSettingsRow } from "./PreReleaseUpdatesSettingsRow";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";
import { DevSettingsDashboardLayoutBlock } from "./DevSettingsDashboardLayoutBlock";
import { DevSettingsDeviceSyncBlock } from "./DevSettingsDeviceSyncBlock";
import { DevSettingsAxFallbackCard, DevSettingsDebugLogsBlock } from "./DevSettingsDiagnosticsBlock";
import { DevSettingsEnhancedContextBlock } from "./DevSettingsEnhancedContextBlock";
import { DevSettingsProjectClassificationBlock } from "./DevSettingsProjectClassificationBlock";
import { DevSettingsWebAccountBlock } from "./DevSettingsWebAccountBlock";
import type { EnhancedContextSettings, EnhancedContextSourceFamily } from "./settingsStorage";
import { useLocalization } from "../localization/LocalizationContext";
import { SentrySmokeDiagnostics } from "./SentrySmokeDiagnostics";

type DevSettingsSectionProps = {
  readonly dashboardAiUnavailablePreview: DashboardAiUnavailablePreviewState | null;
  readonly dashboardAiUnavailablePreviewCase: DashboardAiUnavailablePreviewCase;
  readonly demoDashboardReplaySettings?: DemoDashboardReplaySettings;
  readonly endOfDayReviewSettingsRowRef: RefObject<HTMLDivElement>;
  readonly enhancedContextSettings: EnhancedContextSettings;
  readonly forceBrowserHistoryUrlFallbackEnabled: boolean;
  readonly forceChromiumAxCaptureEnabled: boolean;
  readonly forceChromiumAxExtremeNudgeEnabled: boolean;
  readonly forceFrontmostFallbackCaptureEnabled: boolean;
  readonly deviceSyncPreviewEnabled: boolean;
  readonly webAccountPreviewEnabled: boolean;
  readonly projectClassificationAiReviewEvents: readonly AiReviewEvent[];
  readonly projectClassificationCorrectionsBusy: boolean;
  readonly projectPassRuns: readonly ProjectPassRun[];
  readonly weekDashboardAxisScalePercent: number;
  readonly watcherMode: WatcherMode;
  readonly watcherPeekEnabled: boolean;
  readonly watcherPeriodicMaxMinutes: number;
  readonly watcherPeriodicMinMinutes: number;
  readonly preReleaseUpdateStatus: PreReleaseUpdateStatus;
  readonly preReleaseUpdateMessage: string | null;
  readonly preReleaseUpdateError: string | null;
  readonly preReleaseUpdateBusy: boolean;
  readonly canInstallPreReleaseUpdate: boolean;
  readonly onClearDashboardAiUnavailablePreview: () => void;
  readonly onDashboardAiUnavailablePreviewCaseChange: (previewCase: DashboardAiUnavailablePreviewCase) => void;
  readonly onDemoDashboardReplayDurationSecondsChange?: (value: number) => void;
  readonly onDemoDashboardReplayPreRollSecondsChange?: (value: number) => void;
  readonly onEndOfDayReviewPreview: () => void;
  readonly onEnhancedContextCaptureLocalChange: (enabled: boolean) => void;
  readonly onEnhancedContextDebugLoggingChange: (enabled: boolean) => void;
  readonly onEnhancedContextEnabledChange: (enabled: boolean) => void;
  readonly onEnhancedContextRetryLowConfidenceChange: (enabled: boolean) => void;
  readonly onEnhancedContextSourceFamilyChange: (family: EnhancedContextSourceFamily, enabled: boolean) => void;
  readonly onForceBrowserHistoryUrlFallbackChange: (enabled: boolean) => void;
  readonly onForceChromiumAxCaptureChange: (enabled: boolean) => void;
  readonly onForceChromiumAxExtremeNudgeChange: (enabled: boolean) => void;
  readonly onForceFrontmostFallbackCaptureChange: (enabled: boolean) => void;
  readonly onDeviceSyncPreviewEnabledChange: (enabled: boolean) => void;
  readonly onWebAccountPreviewEnabledChange: (enabled: boolean) => void;
  readonly onRevertProjectClassificationCorrection: (id: number) => void;
  readonly onOpenDebugLogs: () => void;
  readonly onOpenReplayOnboarding: () => void;
  readonly onCheckLatestBuild: () => void;
  readonly onInstallLatestBuild: () => void;
  readonly teamsBetaEnabled: boolean;
  readonly profileBetaEnabled: boolean;
  readonly onTeamsBetaChange: (enabled: boolean) => void;
  readonly onProfileBetaChange: (enabled: boolean) => void;
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
  enhancedContextSettings,
  forceBrowserHistoryUrlFallbackEnabled,
  forceChromiumAxCaptureEnabled,
  forceChromiumAxExtremeNudgeEnabled,
  forceFrontmostFallbackCaptureEnabled,
  deviceSyncPreviewEnabled,
  webAccountPreviewEnabled,
  projectClassificationAiReviewEvents,
  projectClassificationCorrectionsBusy,
  projectPassRuns,
  weekDashboardAxisScalePercent,
  watcherMode,
  watcherPeekEnabled,
  watcherPeriodicMaxMinutes,
  watcherPeriodicMinMinutes,
  preReleaseUpdateStatus,
  preReleaseUpdateMessage,
  preReleaseUpdateError,
  preReleaseUpdateBusy,
  canInstallPreReleaseUpdate,
  onClearDashboardAiUnavailablePreview,
  onDashboardAiUnavailablePreviewCaseChange,
  onDemoDashboardReplayDurationSecondsChange,
  onDemoDashboardReplayPreRollSecondsChange,
  onEndOfDayReviewPreview,
  onEnhancedContextCaptureLocalChange,
  onEnhancedContextDebugLoggingChange,
  onEnhancedContextEnabledChange,
  onEnhancedContextRetryLowConfidenceChange,
  onEnhancedContextSourceFamilyChange,
  onForceBrowserHistoryUrlFallbackChange,
  onForceChromiumAxCaptureChange,
  onForceChromiumAxExtremeNudgeChange,
  onForceFrontmostFallbackCaptureChange,
  onDeviceSyncPreviewEnabledChange,
  onWebAccountPreviewEnabledChange,
  onRevertProjectClassificationCorrection,
  onOpenDebugLogs,
  onOpenReplayOnboarding,
  onCheckLatestBuild,
  onInstallLatestBuild,
  teamsBetaEnabled,
  profileBetaEnabled,
  onTeamsBetaChange,
  onProfileBetaChange,
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
  const showWatcherPeekSettings = WATCHER_PEEK_SETTINGS_VISIBLE;
  const { koreanPreviewEnabled, setKoreanPreviewEnabled, t } = useLocalization();

  return (
    <div className="settings-section">
      <DevSettingsDebugLogsBlock onOpenDebugLogs={onOpenDebugLogs} />
      <SentrySmokeDiagnostics />
      <div className="settings-block settings-block--dev-preview">
        <h3>Pre-release updates</h3>
        <PreReleaseUpdatesSettingsRow
          status={preReleaseUpdateStatus}
          message={preReleaseUpdateMessage}
          error={preReleaseUpdateError}
          busy={preReleaseUpdateBusy}
          canInstallPreReleaseUpdate={canInstallPreReleaseUpdate}
          onCheckLatestBuild={onCheckLatestBuild}
          onInstallLatestBuild={onInstallLatestBuild}
        />
      </div>

      {/* Preview feature toggles, grouped in one block */}
      <div className="settings-block settings-block--dev-preview">
        <h3>{t("settings.dev.preview")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.dev.koreanPreviewLabel")}</div>
            <div className="desc">{t("settings.dev.koreanPreviewDescription")}</div>
          </div>
          <div className="ctrl">
            <Toggle
              checked={koreanPreviewEnabled}
              onChange={setKoreanPreviewEnabled}
              ariaLabel={t("settings.dev.koreanPreviewToggle")}
            />
          </div>
        </div>
        <DevSettingsDeviceSyncBlock
          deviceSyncPreviewEnabled={deviceSyncPreviewEnabled}
          onDeviceSyncPreviewEnabledChange={onDeviceSyncPreviewEnabledChange}
        />
        <DevSettingsWebAccountBlock
          webAccountPreviewEnabled={webAccountPreviewEnabled}
          onWebAccountPreviewEnabledChange={onWebAccountPreviewEnabledChange}
        />
        <div className="settings-row">
          <div>
            <div className="lbl">Team preview (beta)</div>
            <div className="desc">Show the Team section in the sidebar for the internal aggregate team focus surface. Dev-mode opt-in.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={teamsBetaEnabled} onChange={onTeamsBetaChange} ariaLabel="Toggle Teams beta" />
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">Profile (beta)</div>
            <div className="desc">Show the public Profile tab in the Social section. Dev-mode opt-in; the leaderboard stays available either way.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={profileBetaEnabled} onChange={onProfileBetaChange} ariaLabel="Toggle Profile beta" />
          </div>
        </div>
      </div>
      <SettingsCollapsibleCard title="Enhanced context (Dev)">
        <DevSettingsEnhancedContextBlock settings={enhancedContextSettings} onCaptureLocalChange={onEnhancedContextCaptureLocalChange} onDebugLoggingChange={onEnhancedContextDebugLoggingChange} onEnabledChange={onEnhancedContextEnabledChange} onRetryLowConfidenceChange={onEnhancedContextRetryLowConfidenceChange} onSourceFamilyChange={onEnhancedContextSourceFamilyChange} />
      </SettingsCollapsibleCard>
      <DevSettingsProjectClassificationBlock
        projectClassificationAiReviewEvents={projectClassificationAiReviewEvents}
        projectClassificationCorrectionsBusy={projectClassificationCorrectionsBusy}
        projectPassRuns={projectPassRuns}
        onRevertProjectClassificationCorrection={onRevertProjectClassificationCorrection}
      />

      {/* Dev-only tools and previews, all merged under one Dev block at the end */}
      <DevSettingsDashboardLayoutBlock
        weekDashboardAxisScalePercent={weekDashboardAxisScalePercent}
        onResetWeekDashboardAxisScalePercent={onResetWeekDashboardAxisScalePercent}
        onWeekDashboardAxisScalePercentChange={onWeekDashboardAxisScalePercentChange}
      />
      <DevSettingsAxFallbackCard
        forceBrowserHistoryUrlFallbackEnabled={forceBrowserHistoryUrlFallbackEnabled}
        forceChromiumAxCaptureEnabled={forceChromiumAxCaptureEnabled}
        forceChromiumAxExtremeNudgeEnabled={forceChromiumAxExtremeNudgeEnabled}
        forceFrontmostFallbackCaptureEnabled={forceFrontmostFallbackCaptureEnabled}
        onForceBrowserHistoryUrlFallbackChange={onForceBrowserHistoryUrlFallbackChange}
        onForceChromiumAxCaptureChange={onForceChromiumAxCaptureChange}
        onForceChromiumAxExtremeNudgeChange={onForceChromiumAxExtremeNudgeChange}
        onForceFrontmostFallbackCaptureChange={onForceFrontmostFallbackCaptureChange}
      />
      <div className="settings-block settings-block--dev-preview">
        <h3>Dev</h3>
        {DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED ? (
          <DashboardDemoReplayControls
            settings={demoDashboardReplaySettings}
            onDurationSecondsChange={onDemoDashboardReplayDurationSecondsChange}
            onPreRollSecondsChange={onDemoDashboardReplayPreRollSecondsChange}
            onReplay={onReplayDashboardDemo}
            onReset={onResetDemoDashboardReplaySettings}
          />
        ) : null}
        {AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED ? (
          <div className="settings-row settings-row--fallback settings-row--ai-preview" role="group" aria-label="AI unavailable preview case">
            <div>
              <div className="lbl">AI unavailable preview</div>
              <div className="desc">
                Apply a selected AI unavailable case to the dashboard three days ago. {dashboardAiUnavailablePreview ? `Active on ${formatDayLabel(dashboardAiUnavailablePreview.appliedDay)}.` : "Dev-mode preview tool."}
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
        ) : null}
        <DevPreviewControls
          endOfDayReviewSettingsRowRef={endOfDayReviewSettingsRowRef}
          showWatcherPeekSettings={showWatcherPeekSettings}
          watcherMode={watcherMode}
          watcherPeekEnabled={watcherPeekEnabled}
          watcherPeriodicMaxMinutes={watcherPeriodicMaxMinutes}
          watcherPeriodicMinMinutes={watcherPeriodicMinMinutes}
          onEndOfDayReviewPreview={onEndOfDayReviewPreview}
          onOpenReplayOnboarding={onOpenReplayOnboarding}
          onPreviewDriftAlarm={onPreviewDriftAlarm}
          onShowWatcherPeek={onShowWatcherPeek}
          onWatcherModeChange={onWatcherModeChange}
          onWatcherPeekEnabledChange={onWatcherPeekEnabledChange}
          onWatcherPeriodicMaxChange={onWatcherPeriodicMaxChange}
          onWatcherPeriodicMinChange={onWatcherPeriodicMinChange}
        />
      </div>
    </div>
  );
}
