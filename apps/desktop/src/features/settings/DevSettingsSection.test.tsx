// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevSettingsSection } from "./DevSettingsSection";

const featureSwitches = vi.hoisted(() => ({
  onboardingV2PreviewEnabled: false,
}));

vi.mock("../../appFeatureSwitches", () => ({
  AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED: false,
  DEVELOPER_PRE_RELEASE_UPDATES_ENABLED: false,
  DRIFT_ALARM_PANEL_PREVIEWS_ENABLED: false,
  END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED: false,
  get ONBOARDING_V2_PREVIEW_ENABLED() {
    return featureSwitches.onboardingV2PreviewEnabled;
  },
  REPLAY_ONBOARDING_DEV_TOOL_ENABLED: false,
  WATCHER_PEEK_PROTOTYPE_ENABLED: false,
}));

type DevSettingsSectionProps = ComponentProps<typeof DevSettingsSection>;

function renderProductionDevSettings() {
  const props = {
    dashboardAiUnavailablePreview: null,
    dashboardAiUnavailablePreviewCase: "connect-ai",
    endOfDayReviewSettingsRowRef: createRef<HTMLDivElement>(),
    forceBrowserHistoryUrlFallbackEnabled: false,
    forceChromiumAxCaptureEnabled: false,
    forceChromiumAxExtremeNudgeEnabled: false,
    forceFrontmostFallbackCaptureEnabled: false,
    watcherMode: "periodic",
    watcherPeekEnabled: false,
    watcherPeriodicMaxMinutes: 20,
    watcherPeriodicMinMinutes: 5,
    onClearDashboardAiUnavailablePreview: vi.fn(),
    onDashboardAiUnavailablePreviewCaseChange: vi.fn(),
    onEndOfDayReviewPreview: vi.fn(),
    onForceBrowserHistoryUrlFallbackChange: vi.fn(),
    onForceChromiumAxCaptureChange: vi.fn(),
    onForceChromiumAxExtremeNudgeChange: vi.fn(),
    onForceFrontmostFallbackCaptureChange: vi.fn(),
    onOpenDebugLogs: vi.fn(),
    onOpenOnboardingV2Preview: vi.fn(),
    onOpenReplayOnboarding: vi.fn(),
    onPreviewDashboardAiUnavailableCase: vi.fn(),
    onPreviewDriftAlarm: vi.fn(),
    onShowWatcherPeek: vi.fn(),
    onWatcherModeChange: vi.fn(),
    onWatcherPeekEnabledChange: vi.fn(),
    onWatcherPeriodicMaxChange: vi.fn(),
    onWatcherPeriodicMinChange: vi.fn(),
  } satisfies DevSettingsSectionProps;

  render(<DevSettingsSection {...props} />);
}

describe("DevSettingsSection", () => {
  beforeEach(() => {
    featureSwitches.onboardingV2PreviewEnabled = false;
  });

  it("does not leave an empty Dev preview block in production diagnostics", () => {
    renderProductionDevSettings();

    expect(screen.getByRole("heading", { name: /^Debug logs$/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^AX fallback diagnostics$/ })).toBeTruthy();
    expect(screen.getByText("Force browser history URL fallback")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Dev$/ })).toBeNull();
    expect(screen.queryByRole("group", { name: /^Pre-release update$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Preview v2$/i })).toBeNull();
  });

  it("calls the browser history fallback handler when toggled", () => {
    const props = {
      dashboardAiUnavailablePreview: null,
      dashboardAiUnavailablePreviewCase: "connect-ai",
      endOfDayReviewSettingsRowRef: createRef<HTMLDivElement>(),
      forceBrowserHistoryUrlFallbackEnabled: false,
      forceChromiumAxCaptureEnabled: false,
      forceChromiumAxExtremeNudgeEnabled: false,
      forceFrontmostFallbackCaptureEnabled: false,
      watcherMode: "periodic",
      watcherPeekEnabled: false,
      watcherPeriodicMaxMinutes: 20,
      watcherPeriodicMinMinutes: 5,
      onClearDashboardAiUnavailablePreview: vi.fn(),
      onDashboardAiUnavailablePreviewCaseChange: vi.fn(),
      onEndOfDayReviewPreview: vi.fn(),
      onForceBrowserHistoryUrlFallbackChange: vi.fn(),
      onForceChromiumAxCaptureChange: vi.fn(),
      onForceChromiumAxExtremeNudgeChange: vi.fn(),
      onForceFrontmostFallbackCaptureChange: vi.fn(),
      onOpenDebugLogs: vi.fn(),
      onOpenOnboardingV2Preview: vi.fn(),
      onOpenReplayOnboarding: vi.fn(),
      onPreviewDashboardAiUnavailableCase: vi.fn(),
      onPreviewDriftAlarm: vi.fn(),
      onShowWatcherPeek: vi.fn(),
      onWatcherModeChange: vi.fn(),
      onWatcherPeekEnabledChange: vi.fn(),
      onWatcherPeriodicMaxChange: vi.fn(),
      onWatcherPeriodicMinChange: vi.fn(),
    } satisfies DevSettingsSectionProps;

    render(<DevSettingsSection {...props} />);
    fireEvent.click(screen.getByRole("switch", { name: "Force browser history URL fallback" }));

    expect(props.onForceBrowserHistoryUrlFallbackChange).toHaveBeenCalledWith(true);
  });

  it("opens the isolated onboarding v2 preview when the dev flag is enabled", () => {
    featureSwitches.onboardingV2PreviewEnabled = true;
    const props = {
      dashboardAiUnavailablePreview: null,
      dashboardAiUnavailablePreviewCase: "connect-ai",
      endOfDayReviewSettingsRowRef: createRef<HTMLDivElement>(),
      forceBrowserHistoryUrlFallbackEnabled: false,
      forceChromiumAxCaptureEnabled: false,
      forceChromiumAxExtremeNudgeEnabled: false,
      forceFrontmostFallbackCaptureEnabled: false,
      watcherMode: "periodic",
      watcherPeekEnabled: false,
      watcherPeriodicMaxMinutes: 20,
      watcherPeriodicMinMinutes: 5,
      onClearDashboardAiUnavailablePreview: vi.fn(),
      onDashboardAiUnavailablePreviewCaseChange: vi.fn(),
      onEndOfDayReviewPreview: vi.fn(),
      onForceBrowserHistoryUrlFallbackChange: vi.fn(),
      onForceChromiumAxCaptureChange: vi.fn(),
      onForceChromiumAxExtremeNudgeChange: vi.fn(),
      onForceFrontmostFallbackCaptureChange: vi.fn(),
      onOpenDebugLogs: vi.fn(),
      onOpenOnboardingV2Preview: vi.fn(),
      onOpenReplayOnboarding: vi.fn(),
      onPreviewDashboardAiUnavailableCase: vi.fn(),
      onPreviewDriftAlarm: vi.fn(),
      onShowWatcherPeek: vi.fn(),
      onWatcherModeChange: vi.fn(),
      onWatcherPeekEnabledChange: vi.fn(),
      onWatcherPeriodicMaxChange: vi.fn(),
      onWatcherPeriodicMinChange: vi.fn(),
    } satisfies DevSettingsSectionProps;

    render(<DevSettingsSection {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^Preview v2$/i }));

    expect(props.onOpenOnboardingV2Preview).toHaveBeenCalledTimes(1);
  });
});
