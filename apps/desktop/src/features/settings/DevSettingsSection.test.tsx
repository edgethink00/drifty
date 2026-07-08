// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS,
} from "./settingsStorage";
import { renderProductionDevSettings } from "./DevSettingsSection.testHarness";

const featureSwitches = vi.hoisted(() => ({
  demoDashboardReplayDevToolEnabled: false,
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

describe("DevSettingsSection", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    featureSwitches.demoDashboardReplayDevToolEnabled = false;
  });

  it("opens the onboarding v2.2 preview from the Dev preview block", () => {
    const props = renderProductionDevSettings();

    expect(screen.getByText("Onboarding v2.2 preview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Open preview$/ }));
    expect(props.onOpenOnboardingV22Preview).toHaveBeenCalledTimes(1);
  });

  it("toggles Teams beta from the Dev preview block", () => {
    const props = renderProductionDevSettings();

    expect(screen.getByText("Teams beta")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle Teams beta" }));
    expect(props.onTeamsBetaChange).toHaveBeenCalledWith(true);
  });

  it("keeps core Dev preview controls visible without release-channel feature gates", () => {
    renderProductionDevSettings();

    expect(screen.getByRole("heading", { name: /^Debug logs$/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^AX fallback diagnostics$/ })).toBeTruthy();
    expect(screen.getByText("Force browser history URL fallback")).toBeTruthy();
    expect(screen.getByRole("group", { name: /^Pre-release updates$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Check Latest Build$/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Dev$/ })).toBeTruthy();
    expect(screen.getByText("Onboarding v2.2 preview")).toBeTruthy();
    expect(screen.getByText("Teams beta")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Preview v2\.1$/i })).toBeNull();
    expect(screen.queryByRole("group", { name: "Dashboard demo replay" })).toBeNull();
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

  it("always shows the project classification toggle in the Dev section", () => {
    renderProductionDevSettings();
    expect(screen.getByRole("heading", { name: "Project classification (preview)" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Toggle project classification preview" })).toBeTruthy();
  });

  it("toggles the project classification preview when clicked", () => {
    const props = renderProductionDevSettings();

    fireEvent.click(screen.getByRole("switch", { name: "Toggle project classification preview" }));

    expect(props.onProjectClassificationEnabledChange).toHaveBeenCalledWith(true);
  });
});
