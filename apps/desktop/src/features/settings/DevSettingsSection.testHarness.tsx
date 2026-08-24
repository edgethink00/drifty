import { render } from "@testing-library/react";
import { type ComponentProps } from "react";
import { vi } from "vitest";
import { DevSettingsSection } from "./DevSettingsSection";
import { DEFAULT_ENHANCED_CONTEXT_SETTINGS } from "./settingsStorage";

type DevSettingsSectionTestProps = ComponentProps<typeof DevSettingsSection>;

export function renderProductionDevSettings(
  propOverrides: Partial<DevSettingsSectionTestProps> = {},
) {
  const props = {
    dashboardAiUnavailablePreview: null,
    dashboardAiUnavailablePreviewCase: "connect-ai",
    sidebarCtaPreviewCase: null,
    demoDashboardReplaySettings: {
      preRollSeconds: 5,
      durationSeconds: 45,
    },
    enhancedContextSettings: DEFAULT_ENHANCED_CONTEXT_SETTINGS,
    forceBrowserHistoryUrlFallbackEnabled: false,
    forceChromiumAxCaptureEnabled: false,
    forceChromiumAxExtremeNudgeEnabled: false,
    forceFrontmostFallbackCaptureEnabled: false,
    projectPassRuns: [],
    deviceSyncPreviewEnabled: false,
    webAccountPreviewEnabled: false,
    projectClassificationAiReviewEvents: [],
    projectClassificationCorrectionsBusy: false,
    petModeEnabled: false,
    petModeLabPointerStatus: null,
    petModeLabInputBounds: null,
    onDeviceSyncPreviewEnabledChange: vi.fn(),
    onWebAccountPreviewEnabledChange: vi.fn(),
    onRevertProjectClassificationCorrection: vi.fn(),
    floatingCompanionDevEnabled: false,
    onFloatingCompanionDevEnabledChange: vi.fn(),
    onPreviewCompanionMilestone: vi.fn(),
    onPreviewCompanionMoment: vi.fn(),
    onPreviewCompanionDayReview: vi.fn(),
    preReleaseUpdateStatus: "idle",
    preReleaseUpdateMessage: null,
    preReleaseUpdateError: null,
    preReleaseUpdateBusy: false,
    canInstallPreReleaseUpdate: false,
    onClearDashboardAiUnavailablePreview: vi.fn(),
    onDashboardAiUnavailablePreviewCaseChange: vi.fn(),
    onSidebarCtaPreviewCaseChange: vi.fn(),
    onDemoDashboardReplayDurationSecondsChange: vi.fn(),
    onDemoDashboardReplayPreRollSecondsChange: vi.fn(),
    onEnhancedContextDebugLoggingChange: vi.fn(),
    onEnhancedContextSourceFamilyChange: vi.fn(),
    onForceBrowserHistoryUrlFallbackChange: vi.fn(),
    onForceChromiumAxCaptureChange: vi.fn(),
    onForceChromiumAxExtremeNudgeChange: vi.fn(),
    onForceFrontmostFallbackCaptureChange: vi.fn(),
    onOpenDebugLogs: vi.fn(),
    onCheckLatestBuild: vi.fn(),
    onInstallLatestBuild: vi.fn(),
    onOpenReplayOnboarding: vi.fn(),
    onPreviewPetModeIntervention: vi.fn(),
    onRehearsePetModeIntercept: vi.fn(),
    onPreviewPetModeBrowserTabClose: vi.fn(),
    onPreviewPetModeDriftyWindowClose: vi.fn(),
    onPlacePetModeCenter: vi.fn(),
    onPreviewPetModeAction: vi.fn(),
    teamsBetaEnabled: false,
    profileBetaEnabled: false,
    agentsBetaEnabled: false,
    onTeamsBetaChange: vi.fn(),
    onProfileBetaChange: vi.fn(),
    onAgentsBetaChange: vi.fn(),
    legacyShellBlurPreviewEnabled: false,
    onLegacyShellBlurPreviewEnabledChange: vi.fn(),
    onPreviewDashboardAiUnavailableCase: vi.fn(),
    onReplayDashboardDemo: vi.fn(),
    onResetDemoDashboardReplaySettings: vi.fn(),
    ...propOverrides,
  } satisfies DevSettingsSectionTestProps;

  render(<DevSettingsSection {...props} />);

  return props;
}
