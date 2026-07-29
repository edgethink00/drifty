// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS,
  DEFAULT_ENHANCED_CONTEXT_SETTINGS,
  ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY,
  ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY,
  ENHANCED_CONTEXT_ENABLED_STORAGE_KEY,
  ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY,
  ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS,
  persistEnhancedContextSettings,
  resolveInitialEnhancedContextSettings,
} from "./settingsStorage";
import { renderProductionDevSettings } from "./DevSettingsSection.testHarness";

const featureSwitches = vi.hoisted(() => ({
  demoDashboardReplayDevToolEnabled: false,
}));

const bootShellActions = vi.hoisted(() => ({
  showBootShellPreview: vi.fn(),
}));

vi.mock("../../appFeatureSwitches", () => ({
  AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED: false,
  get DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED() {
    return featureSwitches.demoDashboardReplayDevToolEnabled;
  },
  DEVELOPER_PRE_RELEASE_UPDATES_ENABLED: false,
  DRIFT_ALARM_PANEL_PREVIEWS_ENABLED: false,
  END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED: false,
  REPLAY_ONBOARDING_DEV_TOOL_ENABLED: false,
}));

vi.mock("../loading/bootShell", () => ({
  showBootShellPreview: bootShellActions.showBootShellPreview,
}));

describe("DevSettingsSection", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    featureSwitches.demoDashboardReplayDevToolEnabled = false;
    bootShellActions.showBootShellPreview.mockClear();
  });

  it("shows Sentry smoke controls in production Dev settings", () => {
    renderProductionDevSettings();

    expect(screen.getByRole("group", { name: "Sentry smoke diagnostics" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test renderer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test native" })).toBeTruthy();
  });

  it("locks smoke controls after submission until the operator explicitly resets them", () => {
    renderProductionDevSettings();

    const rendererButton = screen.getByRole("button", { name: "Test renderer" });
    fireEvent.click(rendererButton);

    expect(rendererButton.getAttribute("disabled")).toBe("");
    expect(screen.getByRole("button", { name: "Test native" }).getAttribute("disabled")).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Run another test" }));
    expect(rendererButton.getAttribute("disabled")).toBeNull();
  });

  it("toggles Team preview from the Preview block", () => {
    const props = renderProductionDevSettings();

    expect(screen.getByText("Team preview (beta)")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle Teams beta" }));
    expect(props.onTeamsBetaChange).toHaveBeenCalledWith(true);
  });

  it("keeps core Dev preview controls visible without release-channel feature gates", () => {
    renderProductionDevSettings();

    expect(screen.getByRole("heading", { name: /^Debug logs$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^AX fallback diagnostics/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^AX fallback diagnostics/ }));
    expect(screen.getByText("Force browser history URL fallback")).toBeTruthy();
    expect(screen.getByRole("group", { name: /^Pre-release updates$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Check Latest Build$/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Preview$/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Dev$/ })).toBeTruthy();
    expect(screen.getByText("Team preview (beta)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Preview v2\.1$/i })).toBeNull();
    expect(screen.queryByRole("group", { name: "Dashboard demo replay" })).toBeNull();
  });

  it("previews the real startup loading screen for three seconds", () => {
    renderProductionDevSettings();

    fireEvent.click(screen.getByRole("button", { name: "Preview 3 seconds" }));

    expect(screen.getByText("Startup loading screen")).toBeTruthy();
    expect(bootShellActions.showBootShellPreview).toHaveBeenCalledTimes(1);
  });

  it("shows pre-release update status and disables the check while busy", () => {
    renderProductionDevSettings(75, {
      preReleaseUpdateStatus: "checking" as const,
      preReleaseUpdateMessage: "Checking latest build...",
      preReleaseUpdateBusy: true,
    });

    const checkButton = screen.getByRole("button", { name: /^Checking...$/i });
    if (!(checkButton instanceof HTMLButtonElement)) throw new Error("Expected a button element.");
    expect(checkButton.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/checking latest build/i);
    expect(screen.queryByRole("button", { name: /^Install Latest Build$/i })).toBeNull();
  });

  it("calls the browser history fallback handler when toggled", () => {
    const props = renderProductionDevSettings(80);
    fireEvent.click(screen.getByRole("button", { name: /^AX fallback diagnostics/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Force browser history URL fallback" }));

    expect(props.onForceBrowserHistoryUrlFallbackChange).toHaveBeenCalledWith(true);
  });

  it("does not expose the isolated onboarding v2.1 preview", () => {
    renderProductionDevSettings(80);

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

    expect(screen.getByRole("heading", { name: "Preview" })).toBeTruthy();
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

  it("keeps the project classification diagnostics in the Dev section without an enable toggle", () => {
    renderProductionDevSettings();
    expect(screen.getByRole("heading", { name: "Project classification" })).toBeTruthy();
    // The feature ships default-on; only the diagnostics remain in Dev.
    expect(screen.queryByRole("switch", { name: "Toggle project classification preview" })).toBeNull();
  });

  it("defaults enhanced context Dev settings off and persists only Dev-active values", () => {
    window.localStorage.clear();

    expect(resolveInitialEnhancedContextSettings()).toEqual(DEFAULT_ENHANCED_CONTEXT_SETTINGS);

    const enabledSettings = {
      enabled: true,
      captureLocal: true,
      retryLowConfidence: true,
      debugLogging: true,
      sourceFamilies: {
        document_knowledge: true,
        local_notes_markdown: true,
        work_tracker_dev_platform: true,
        design_dev_tool: true,
        calendar_meeting: true,
        communication_metadata: true,
      },
    };

    expect(persistEnhancedContextSettings(enabledSettings, false)).toEqual(DEFAULT_ENHANCED_CONTEXT_SETTINGS);
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_ENABLED_STORAGE_KEY)).toBe("0");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY)).toBe("0");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY)).toBe("0");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY)).toBe("0");

    expect(persistEnhancedContextSettings(enabledSettings, true)).toEqual(enabledSettings);
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_ENABLED_STORAGE_KEY)).toBe("1");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY)).toBe("1");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY)).toBe("1");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY)).toBe("1");
  });

  it("renders enhanced context controls as off-by-default Dev toggles, collapsed behind a local accordion", () => {
    const props = renderProductionDevSettings();

    expect(screen.getByRole("button", { name: /^Enhanced context \(Dev\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Enhanced context \(Dev\)/ }));

    expect(screen.getByText(/Separate from current Content context title and YouTube metadata/i)).toBeTruthy();
    expect(screen.getByText(/No raw bodies or screenshots/i)).toBeTruthy();
    expect(screen.getByText(/Keep the first AI request unchanged/i)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Enable enhanced context" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Capture enhanced context locally" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Use enhanced context for low-confidence AI retry" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Enhanced context debug logging" }).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("switch", { name: "Enable enhanced context" }));
    fireEvent.click(screen.getByRole("switch", { name: "Capture enhanced context locally" }));
    fireEvent.click(screen.getByRole("switch", { name: "Use enhanced context for low-confidence AI retry" }));
    fireEvent.click(screen.getByRole("switch", { name: "Enhanced context debug logging" }));

    expect(props.onEnhancedContextEnabledChange).toHaveBeenCalledWith(true);
    expect(props.onEnhancedContextCaptureLocalChange).toHaveBeenCalledWith(true);
    expect(props.onEnhancedContextRetryLowConfidenceChange).toHaveBeenCalledWith(true);
    expect(props.onEnhancedContextDebugLoggingChange).toHaveBeenCalledWith(true);

    for (const option of ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS) {
      const sourceSwitch = screen.getByRole("switch", { name: `Enhanced context source: ${option.label}` });
      expect(sourceSwitch.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(sourceSwitch);
      expect(props.onEnhancedContextSourceFamilyChange).toHaveBeenCalledWith(option.family, true);
    }
  });
});
