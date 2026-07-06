// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevSettingsSection } from "./DevSettingsSection";
import {
  DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS,
} from "./settingsStorage";

const featureSwitches = vi.hoisted(() => ({
  demoDashboardReplayDevToolEnabled: false,
  onboardingV22PreviewEnabled: false,
  teamsBetaEnabled: false,
}));

vi.mock("../../appFeatureSwitches", () => ({
  AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED: false,
  get DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED() {
    return featureSwitches.demoDashboardReplayDevToolEnabled;
  },
  DEVELOPER_PRE_RELEASE_UPDATES_ENABLED: false,
  DRIFT_ALARM_PANEL_PREVIEWS_ENABLED: false,
  END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED: false,
  get ONBOARDING_V2_2_PREVIEW_ENABLED() {
    return featureSwitches.onboardingV22PreviewEnabled;
  },
  REPLAY_ONBOARDING_DEV_TOOL_ENABLED: false,
  get TEAMS_BETA_ENABLED() {
    return featureSwitches.teamsBetaEnabled;
  },
  WATCHER_PEEK_PROTOTYPE_ENABLED: false,
}));

function renderProductionDevSettings(weekDashboardAxisScalePercent = 75) {
  const props = {
    dashboardAiUnavailablePreview: null,
    dashboardAiUnavailablePreviewCase: "connect-ai" as const,
    demoDashboardReplaySettings: {
      preRollSeconds: 5,
      durationSeconds: 45,
    },
    endOfDayReviewSettingsRowRef: createRef<HTMLDivElement>(),
    forceBrowserHistoryUrlFallbackEnabled: false,
    forceChromiumAxCaptureEnabled: false,
    forceChromiumAxExtremeNudgeEnabled: false,
    forceFrontmostFallbackCaptureEnabled: false,
    weekDashboardAxisScalePercent,
    watcherMode: "periodic" as const,
    watcherPeekEnabled: false,
    watcherPeriodicMaxMinutes: 20,
    watcherPeriodicMinMinutes: 5,
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
  };

  render(<DevSettingsSection {...props} />);

  return props;
}

describe("DevSettingsSection", () => {
  beforeEach(() => {
    featureSwitches.demoDashboardReplayDevToolEnabled = false;
    featureSwitches.onboardingV22PreviewEnabled = false;
    featureSwitches.teamsBetaEnabled = false;
  });

  it("opens the onboarding v2.2 preview when the dev tool is enabled", () => {
    featureSwitches.onboardingV22PreviewEnabled = true;

    const props = renderProductionDevSettings();

    expect(screen.getByText("Onboarding v2.2 preview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Open preview$/ }));
    expect(props.onOpenOnboardingV22Preview).toHaveBeenCalledTimes(1);
  });

  it("toggles Teams beta from the Dev preview block when the internal flag is enabled", () => {
    featureSwitches.teamsBetaEnabled = true;

    const props = renderProductionDevSettings();

    expect(screen.getByText("Teams beta")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle Teams beta" }));
    expect(props.onTeamsBetaChange).toHaveBeenCalledWith(true);
  });

  it("does not leave an empty Dev preview block in production diagnostics", () => {
    renderProductionDevSettings();

    expect(screen.getByRole("heading", { name: /^Debug logs$/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^AX fallback diagnostics$/ })).toBeTruthy();
    expect(screen.getByText("Force browser history URL fallback")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Dev$/ })).toBeNull();
    expect(screen.queryByRole("group", { name: /^Pre-release update$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Preview v2\.1$/i })).toBeNull();
    expect(screen.queryByRole("group", { name: "Dashboard demo replay" })).toBeNull();
  });

  it("calls the browser history fallback handler when toggled", () => {
    const props = {
      dashboardAiUnavailablePreview: null,
      dashboardAiUnavailablePreviewCase: "connect-ai" as const,
      endOfDayReviewSettingsRowRef: createRef<HTMLDivElement>(),
      forceBrowserHistoryUrlFallbackEnabled: false,
      forceChromiumAxCaptureEnabled: false,
      forceChromiumAxExtremeNudgeEnabled: false,
      forceFrontmostFallbackCaptureEnabled: false,
      weekDashboardAxisScalePercent: 80,
      watcherMode: "periodic" as const,
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
      onOpenOnboardingV22Preview: vi.fn(),
      onOpenReplayOnboarding: vi.fn(),
      teamsBetaEnabled: false,
      onTeamsBetaChange: vi.fn(),
      onPreviewDashboardAiUnavailableCase: vi.fn(),
      onPreviewDriftAlarm: vi.fn(),
      onResetWeekDashboardAxisScalePercent: vi.fn(),
      onShowWatcherPeek: vi.fn(),
      onWeekDashboardAxisScalePercentChange: vi.fn(),
      onWatcherModeChange: vi.fn(),
      onWatcherPeekEnabledChange: vi.fn(),
      onWatcherPeriodicMaxChange: vi.fn(),
      onWatcherPeriodicMinChange: vi.fn(),
    };

    render(<DevSettingsSection {...props} />);
    fireEvent.click(screen.getByRole("switch", { name: "Force browser history URL fallback" }));

    expect(props.onForceBrowserHistoryUrlFallbackChange).toHaveBeenCalledWith(true);
  });

  it("does not expose the isolated onboarding v2.1 preview", () => {
    const props = {
      dashboardAiUnavailablePreview: null,
      dashboardAiUnavailablePreviewCase: "connect-ai" as const,
      endOfDayReviewSettingsRowRef: createRef<HTMLDivElement>(),
      forceBrowserHistoryUrlFallbackEnabled: false,
      forceChromiumAxCaptureEnabled: false,
      forceChromiumAxExtremeNudgeEnabled: false,
      forceFrontmostFallbackCaptureEnabled: false,
      weekDashboardAxisScalePercent: 80,
      watcherMode: "periodic" as const,
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
      onOpenOnboardingV22Preview: vi.fn(),
      onOpenReplayOnboarding: vi.fn(),
      teamsBetaEnabled: false,
      onTeamsBetaChange: vi.fn(),
      onPreviewDashboardAiUnavailableCase: vi.fn(),
      onPreviewDriftAlarm: vi.fn(),
      onResetWeekDashboardAxisScalePercent: vi.fn(),
      onShowWatcherPeek: vi.fn(),
      onWeekDashboardAxisScalePercentChange: vi.fn(),
      onWatcherModeChange: vi.fn(),
      onWatcherPeekEnabledChange: vi.fn(),
      onWatcherPeriodicMaxChange: vi.fn(),
      onWatcherPeriodicMinChange: vi.fn(),
    };

    render(<DevSettingsSection {...props} />);

    expect(screen.queryByText(/^Onboarding v2\.1 preview$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Preview v2\.1$/i })).toBeNull();
  });

  it("shows dashboard demo replay controls and calls replay handlers when the feature switch is enabled", () => {
    featureSwitches.demoDashboardReplayDevToolEnabled = true;

    const props = renderProductionDevSettings();
    fireEvent.click(screen.getByRole("button", { name: "Replay Your Day" }));
    fireEvent.click(screen.getByRole("button", { name: "Replay Your Week" }));
    const preRollInput = screen.getByLabelText("Demo replay pre-roll seconds");
    const durationInput = screen.getByLabelText("Demo replay duration seconds");
    fireEvent.change(preRollInput, { target: { value: "7" } });
    fireEvent.change(durationInput, { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset defaults" }));

    expect(screen.getByRole("heading", { name: "Dashboard replay" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Dashboard demo replay" })).toBeTruthy();
    expect(preRollInput.getAttribute("min")).toBe(String(DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS));
    expect(preRollInput.getAttribute("max")).toBe(String(DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS));
    expect(preRollInput.getAttribute("step")).toBe("1");
    expect(durationInput.getAttribute("min")).toBe(String(DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS));
    expect(durationInput.getAttribute("max")).toBe(String(DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS));
    expect(durationInput.getAttribute("step")).toBe("1");
    expect(props.onReplayDashboardDemo).toHaveBeenNthCalledWith(1, "day");
    expect(props.onReplayDashboardDemo).toHaveBeenNthCalledWith(2, "week");
    expect(props.onDemoDashboardReplayPreRollSecondsChange).toHaveBeenCalledWith(7);
    expect(props.onDemoDashboardReplayDurationSecondsChange).toHaveBeenCalledWith(60);
    expect(props.onResetDemoDashboardReplaySettings).toHaveBeenCalledTimes(1);
  });

  it("shows the Your Week y-axis scale slider relative to the compressed default", () => {
    const props = renderProductionDevSettings();
    const scaleInput = screen.getByLabelText("Your Week y-axis scale percent");

    fireEvent.change(scaleInput, { target: { value: "120" } });

    expect(screen.getByRole("heading", { name: "Dashboard layout" })).toBeTruthy();
    expect(screen.getByText("Your Week y-axis scale")).toBeTruthy();
    expect(screen.getByLabelText("Current Your Week y-axis scale").textContent).toBe("100%");
    expect(scaleInput.getAttribute("min")).toBe("60");
    expect(scaleInput.getAttribute("max")).toBe("140");
    expect(scaleInput.getAttribute("step")).toBe("1");
    expect(scaleInput.getAttribute("value")).toBe("100");
    expect(screen.getByRole("button", { name: "Reset" }).getAttribute("disabled")).toBe("");
    expect(props.onWeekDashboardAxisScalePercentChange).toHaveBeenCalledWith(90);
  });
});
