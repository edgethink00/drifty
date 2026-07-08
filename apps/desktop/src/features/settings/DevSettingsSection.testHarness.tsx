import { render } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { vi } from "vitest";
import { DevSettingsSection } from "./DevSettingsSection";

type DevSettingsSectionTestProps = ComponentProps<typeof DevSettingsSection>;

export function renderProductionDevSettings(
  weekDashboardAxisScalePercent = 75,
  propOverrides: Partial<DevSettingsSectionTestProps> = {},
) {
  const props = {
    dashboardAiUnavailablePreview: null,
    dashboardAiUnavailablePreviewCase: "connect-ai",
    demoDashboardReplaySettings: {
      preRollSeconds: 5,
      durationSeconds: 45,
    },
    endOfDayReviewSettingsRowRef: createRef<HTMLDivElement>(),
    forceBrowserHistoryUrlFallbackEnabled: false,
    forceChromiumAxCaptureEnabled: false,
    forceChromiumAxExtremeNudgeEnabled: false,
    forceFrontmostFallbackCaptureEnabled: false,
    projectPassRuns: [],
    profileRedesignEnabled: false,
    projectClassificationEnabled: false,
    projectClassificationAiReviewEvents: [],
    projectClassificationCorrectionsBusy: false,
    onProfileRedesignEnabledChange: vi.fn(),
    onProjectClassificationEnabledChange: vi.fn(),
    onRevertProjectClassificationCorrection: vi.fn(),
    weekDashboardAxisScalePercent,
    watcherMode: "periodic",
    watcherPeekEnabled: false,
    watcherPeriodicMaxMinutes: 20,
    watcherPeriodicMinMinutes: 5,
    preReleaseUpdateStatus: "idle",
    preReleaseUpdateMessage: null,
    preReleaseUpdateError: null,
    preReleaseUpdateBusy: false,
    canInstallPreReleaseUpdate: false,
    onClearDashboardAiUnavailablePreview: vi.fn(),
    onDashboardAiUnavailablePreviewCaseChange: vi.fn(),
    onDemoDashboardReplayDurationSecondsChange: vi.fn(),
    onDemoDashboardReplayPreRollSecondsChange: vi.fn(),
    onEndOfDayReviewPreview: vi.fn(),
    onForceBrowserHistoryUrlFallbackChange: vi.fn(),
    onForceChromiumAxCaptureChange: vi.fn(),
    onForceChromiumAxExtremeNudgeChange: vi.fn(),
    onForceFrontmostFallbackCaptureChange: vi.fn(),
    onOpenDebugLogs: vi.fn(),
    onOpenOnboardingV22Preview: vi.fn(),
    onCheckLatestBuild: vi.fn(),
    onInstallLatestBuild: vi.fn(),
    onOpenReplayOnboarding: vi.fn(),
    teamsBetaEnabled: false,
    onTeamsBetaChange: vi.fn(),
    onPreviewDashboardAiUnavailableCase: vi.fn(),
    onPreviewDriftAlarm: vi.fn(),
    onReplayDashboardDemo: vi.fn(),
    onResetDemoDashboardReplaySettings: vi.fn(),
    onResetWeekDashboardAxisScalePercent: vi.fn(),
    onShowWatcherPeek: vi.fn(),
    onWeekDashboardAxisScalePercentChange: vi.fn(),
    onWatcherModeChange: vi.fn(),
    onWatcherPeekEnabledChange: vi.fn(),
    onWatcherPeriodicMaxChange: vi.fn(),
    onWatcherPeriodicMinChange: vi.fn(),
    ...propOverrides,
  } satisfies DevSettingsSectionTestProps;

  render(<DevSettingsSection {...props} />);

  return props;
}
