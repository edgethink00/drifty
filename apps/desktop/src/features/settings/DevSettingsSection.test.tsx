// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { DevSettingsSection } from "./DevSettingsSection";

vi.mock("../../appFeatureSwitches", () => ({
  AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED: false,
  DEVELOPER_PRE_RELEASE_UPDATES_ENABLED: false,
  DRIFT_ALARM_PANEL_PREVIEWS_ENABLED: false,
  END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED: false,
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
  it("does not leave an empty Dev preview block in production diagnostics", () => {
    renderProductionDevSettings();

    expect(screen.getByRole("heading", { name: /^Debug logs$/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^AX fallback diagnostics$/ })).toBeTruthy();
    expect(screen.getByText("Force browser history URL fallback")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Dev$/ })).toBeNull();
    expect(screen.queryByRole("group", { name: /^Pre-release update$/i })).toBeNull();
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
});
