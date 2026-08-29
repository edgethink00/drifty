// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS,
  DEFAULT_ENHANCED_CONTEXT_SETTINGS,
  DEV_MODE_STORAGE_KEY,
  ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY,
  ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY,
  ENHANCED_CONTEXT_ENABLED_STORAGE_KEY,
  ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY,
  ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS,
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

const petModeLabEvents = vi.hoisted(() => ({
  listener: null as ((state: { phase: string; activeAction: string | null; lifeLoopEnabled: boolean }) => void) | null,
  request: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../appFeatureSwitches", () => ({
  AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED: false,
  get DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED() {
    return featureSwitches.demoDashboardReplayDevToolEnabled;
  },
  DEVELOPER_PRE_RELEASE_UPDATES_ENABLED: false,
  END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED: false,
  REPLAY_ONBOARDING_DEV_TOOL_ENABLED: false,
}));

vi.mock("../loading/bootShell", () => ({
  BOOT_SHELL_PREVIEW_DURATION_SECONDS: 7,
  showBootShellPreview: bootShellActions.showBootShellPreview,
}));

vi.mock("../pet-mode/petModeBridge", () => ({
  listenToNativePetModeLabState: vi.fn(async (listener) => {
    petModeLabEvents.listener = listener;
    return vi.fn();
  }),
  requestNativePetModeLabState: petModeLabEvents.request,
}));

describe("DevSettingsSection", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    featureSwitches.demoDashboardReplayDevToolEnabled = false;
    bootShellActions.showBootShellPreview.mockClear();
    petModeLabEvents.listener = null;
    petModeLabEvents.request.mockClear();
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

  it("keeps the detailed Pet Mode Lab in Dev while the pet itself ships elsewhere", () => {
    renderProductionDevSettings();
    expect(screen.getByRole("group", { name: "Pet Mode Lab" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Intervention/ }).getAttribute("disabled")).toBe("");
    expect(screen.getByRole("button", { name: /Walk 20.8 px\/s sample/ }).getAttribute("disabled")).toBe("");

    // The pet is a production feature now: its on/off switch, coat, and size
    // live in Companion & Alerts, so Dev must not offer a second copy.
    expect(screen.queryByRole("switch", { name: /Pet Mode preview/ })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Pet coat" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Pet size" })).toBeNull();

    cleanup();
    const enabledProps = renderProductionDevSettings({ petModeEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: /Intervention/ }));
    expect(enabledProps.onPreviewPetModeIntervention).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Stretch Flow Stretch C/ }));
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("stretch");
    fireEvent.click(screen.getByRole("button", { name: /Music note Manual 760 ms preview/ }));
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("music_note");
    fireEvent.click(screen.getByRole("button", { name: /Angry wake Forced 1.2 s QA/ }));
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("angry_wake");
    fireEvent.click(screen.getByRole("button", { name: /Sit G pose QA/ }));
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("sit");
    fireEvent.click(screen.getByRole("button", { name: /Browser tab X/ }));
    expect(enabledProps.onPreviewPetModeBrowserTabClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Drifty window X/ }));
    expect(enabledProps.onPreviewPetModeDriftyWindowClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Life loop/ }));
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("life_loop");
    fireEvent.click(screen.getByRole("button", { name: /Center drop/ }));
    expect(enabledProps.onPlacePetModeCenter).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Look around/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Play Flow/ })).toBeNull();
  });

  it("shows the real pet phase and prevents overlapping Lab actions", async () => {
    renderProductionDevSettings({ petModeEnabled: true });
    await act(async () => undefined);

    act(() => {
      petModeLabEvents.listener?.({ phase: "tail", activeAction: "tail_flick", lifeLoopEnabled: false });
    });

    expect(screen.getByText("Tail flick", { selector: ".pet-mode-lab__status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tail flick/ }).classList.contains("is-active")).toBe(true);
    expect(screen.getByRole("button", { name: /Tail flick/ }).getAttribute("disabled")).toBe("");
    expect(screen.getByRole("button", { name: /Walk/ }).getAttribute("disabled")).toBe("");
    expect(screen.getByRole("button", { name: /Stop/ }).getAttribute("disabled")).toBeNull();

    act(() => {
      petModeLabEvents.listener?.({ phase: "sit", activeAction: "sit", lifeLoopEnabled: false });
    });

    expect(screen.getByText("Sitting", { selector: ".pet-mode-lab__status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sit G pose QA/ }).classList.contains("is-active")).toBe(true);
  });

  it("keeps explicit cursor hunt previews available while the focused cat is sitting", async () => {
    window.localStorage.setItem("drifty.pet.driftHuntEnabled.v1", "true");
    renderProductionDevSettings({ petModeEnabled: true });
    await act(async () => undefined);

    act(() => {
      petModeLabEvents.listener?.({ phase: "sit", activeAction: null, lifeLoopEnabled: false });
    });

    expect(screen.getByRole("button", { name: /단발 사냥 재생/ }).getAttribute("disabled")).toBeNull();
    expect(screen.getByRole("button", { name: /8초 추격 재생/ }).getAttribute("disabled")).toBeNull();
    expect(screen.getByRole("button", { name: /Music note Manual 760 ms preview/ }).getAttribute("disabled")).toBeNull();
    expect(screen.getByRole("button", { name: /Walk/ }).getAttribute("disabled")).toBe("");

    act(() => {
      petModeLabEvents.listener?.({ phase: "sit", activeAction: "music_note", lifeLoopEnabled: false });
    });
    expect(screen.getByText("Music note", { selector: ".pet-mode-lab__status" })).toBeTruthy();
  });

  it("persists a bounded cursor chase policy from the Pet Mode Lab", () => {
    const props = renderProductionDevSettings({ petModeEnabled: true });

    expect(screen.queryByRole("radio", { name: "몇 초간 추격" })).toBeNull();
    expect(screen.queryByRole("button", { name: /단발 사냥 재생/ })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle drift cursor hunt" }));
    expect(screen.getByText("무저항")).toBeTruthy();
    expect(screen.getByText("6초 물고 이동")).toBeTruthy();
    expect(screen.getByText("약한 저항")).toBeTruthy();
    expect(screen.getByText("3초 물고 이동")).toBeTruthy();
    expect(screen.getByText("강한 저항")).toBeTruthy();
    expect(screen.getByText("2초 물고 이동")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /단발 사냥 재생/ }));
    expect(props.onPreviewPetModeAction).toHaveBeenCalledWith("cursor_hunt_single");
    fireEvent.click(screen.getByRole("button", { name: /8초 추격 재생/ }));
    expect(props.onPreviewPetModeAction).toHaveBeenCalledWith("cursor_hunt_chase");
    fireEvent.click(screen.getByRole("radio", { name: "몇 초간 추격" }));
    fireEvent.click(screen.getByText("추격 세부 설정 · 자유 조정"));
    fireEvent.change(screen.getByRole("slider", { name: "Cursor chase duration" }), { target: { value: "6500" } });
    expect(screen.getByRole("button", { name: /6.5초 추격 재생/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Cursor stalk speed" }), { target: { value: "280" } });
    fireEvent.change(screen.getByRole("slider", { name: "Cursor carry distance" }), { target: { value: "96" } });
    fireEvent.change(screen.getByRole("slider", { name: "Still cursor carry duration" }), { target: { value: "5000" } });
    fireEvent.change(screen.getByRole("slider", { name: "Cursor carry lag" }), { target: { value: "160" } });
    fireEvent.click(screen.getByRole("switch", { name: "Toggle soft cursor chase turns" }));
    expect(screen.getByText("추격 시작 때 주황색 ! 1회")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle cursor hunt alert cue" }));

    expect(window.localStorage.getItem("drifty.pet.driftHuntEnabled.v1")).toBe("true");
    expect(window.localStorage.getItem("drifty.pet.driftHuntMode.v1")).toBe("chase");
    expect(window.localStorage.getItem("drifty.pet.driftHuntChaseDuration.v1")).toBe("6500");
    expect(window.localStorage.getItem("drifty.pet.driftHuntSoftTurns.v1")).toBe("false");
    expect(window.localStorage.getItem("drifty.pet.driftHuntAlertCue.v1")).toBe("false");
    expect(JSON.parse(window.localStorage.getItem("drifty.pet.driftHuntTuning.v1") ?? "{}")).toMatchObject({
      chaseDurationMs: 6500,
      stalkSpeed: 280,
      carryDistance: 96,
      carryStillDurationMs: 5000,
      cursorLagMs: 160,
    });
  });

  it("keeps the floating Companion behind an explicit Dev toggle", () => {
    const props = renderProductionDevSettings({ floatingCompanionDevEnabled: false });

    expect(screen.getByText(/production uses the menu-bar Companion/i)).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Floating" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle floating Companion" }));

    expect(props.onFloatingCompanionDevEnabledChange).toHaveBeenCalledWith(true);
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

  it("previews the real startup loading screen for seven seconds", () => {
    renderProductionDevSettings();

    fireEvent.click(screen.getByRole("button", { name: "Preview 7 seconds" }));

    expect(screen.getByText("Startup loading screen")).toBeTruthy();
    expect(bootShellActions.showBootShellPreview).toHaveBeenCalledTimes(1);
  });

  it("previews production milestones through the active notification surface", () => {
    const props = renderProductionDevSettings();
    fireEvent.click(screen.getByRole("button", { name: "30-day record" }));
    fireEvent.click(screen.getByRole("button", { name: "Weekly final #2" }));
    fireEvent.click(screen.getByRole("button", { name: "Weekly final #1" }));

    expect(props.onPreviewCompanionMilestone).toHaveBeenNthCalledWith(1, "record-30d");
    expect(props.onPreviewCompanionMilestone).toHaveBeenNthCalledWith(2, "weekly-final-rank-2");
    expect(props.onPreviewCompanionMilestone).toHaveBeenNthCalledWith(3, "weekly-final-rank-1");
  });

  it("keeps production placement choices out of the Dev Companion Lab", () => {
    renderProductionDevSettings();

    expect(screen.queryByRole("radiogroup", { name: "Companion policy" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Menu bar display" })).toBeNull();
  });

  it("keeps the Companion Day review as a moment preview without a version picker", () => {
    renderProductionDevSettings();

    expect(screen.getByRole("button", { name: "Day review" })).toBeTruthy();
    expect(screen.queryByText("V3 final")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Full" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "V2" })).toBeNull();
  });

  /* Drift alarms, the break-over card and the day review only ever appeared
     after real drift, so their layout could not be reviewed on demand. */
  it("previews the decision cards through the active notification surface", () => {
    const props = renderProductionDevSettings();
    fireEvent.click(screen.getByRole("button", { name: "Drift alarm" }));
    fireEvent.click(screen.getByRole("button", { name: "Break over" }));
    fireEvent.click(screen.getByRole("button", { name: "Extreme nudge" }));
    fireEvent.click(screen.getByRole("button", { name: "Day review" }));

    expect(props.onPreviewCompanionMoment).toHaveBeenNthCalledWith(1, "drift-alarm");
    expect(props.onPreviewCompanionMoment).toHaveBeenNthCalledWith(2, "break-return");
    expect(props.onPreviewCompanionMoment).toHaveBeenNthCalledWith(3, "extreme-nudge");
    expect(props.onPreviewCompanionDayReview).toHaveBeenCalledTimes(1);
  });

  it("shows pre-release update status and disables the check while busy", () => {
    renderProductionDevSettings({
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
    const props = renderProductionDevSettings();
    fireEvent.click(screen.getByRole("button", { name: /^AX fallback diagnostics/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Force browser history URL fallback" }));

    expect(props.onForceBrowserHistoryUrlFallbackChange).toHaveBeenCalledWith(true);
  });

  it("does not expose the isolated onboarding v2.1 preview", () => {
    renderProductionDevSettings();

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

  it("does not expose the retired Week y-axis scale control", () => {
    renderProductionDevSettings();

    expect(screen.queryByRole("heading", { name: "Dashboard layout" })).toBeNull();
    expect(screen.queryByLabelText("Your Week y-axis scale percent")).toBeNull();
  });

  it("keeps the project classification diagnostics in the Dev section without an enable toggle", () => {
    renderProductionDevSettings();
    expect(screen.getByRole("heading", { name: "Project classification" })).toBeTruthy();
    // The feature ships default-on; only the diagnostics remain in Dev.
    expect(screen.queryByRole("switch", { name: "Toggle project classification preview" })).toBeNull();
  });

  it("locks shipped enhanced context on and keeps only design as a dogfood override", () => {
    window.localStorage.clear();

    expect(resolveInitialEnhancedContextSettings()).toEqual(DEFAULT_ENHANCED_CONTEXT_SETTINGS);
    expect(DEFAULT_ENHANCED_CONTEXT_SETTINGS.enabled).toBe(true);
    // No extraction from this family has ever been observed, so it stays opt-in.
    expect(DEFAULT_ENHANCED_CONTEXT_SETTINGS.sourceFamilies.design_dev_tool).toBe(false);
    expect(DEFAULT_ENHANCED_CONTEXT_SETTINGS.sourceFamilies.ai_conversation).toBe(true);
    expect(DEFAULT_ENHANCED_CONTEXT_SETTINGS.sourceFamilies.developer_workspace).toBe(true);
    expect(DEFAULT_ENHANCED_CONTEXT_SETTINGS.sourceFamilies.document_editor).toBe(true);

    const attemptedOverrides = {
      enabled: false,
      captureLocal: false,
      retryLowConfidence: false,
      debugLogging: true,
      sourceFamilies: {
        document_knowledge: false,
        local_notes_markdown: false,
        work_tracker_dev_platform: false,
        design_dev_tool: true,
        calendar_meeting: false,
        communication_metadata: false,
        ai_conversation: false,
        developer_workspace: false,
        document_editor: false,
      },
    };

    // Production classification behavior is not configurable from Dev settings.
    expect(persistEnhancedContextSettings(attemptedOverrides, false)).toEqual(DEFAULT_ENHANCED_CONTEXT_SETTINGS);
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_ENABLED_STORAGE_KEY)).toBe("1");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY)).toBe("1");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY)).toBe("1");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY)).toBe("0");

    const dogfoodSettings = persistEnhancedContextSettings(attemptedOverrides, true);
    expect(dogfoodSettings).toEqual({
      ...DEFAULT_ENHANCED_CONTEXT_SETTINGS,
      debugLogging: true,
      sourceFamilies: {
        ...DEFAULT_ENHANCED_CONTEXT_SETTINGS.sourceFamilies,
        design_dev_tool: true,
      },
    });
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY)).toBe("1");

    // Legacy Dev opt-outs are migrated to the shipped production policy.
    window.localStorage.setItem(ENHANCED_CONTEXT_ENABLED_STORAGE_KEY, "0");
    window.localStorage.setItem(ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY, "0");
    window.localStorage.setItem(ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY, "0");
    window.localStorage.setItem(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.ai_conversation, "0");
    window.localStorage.setItem(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.developer_workspace, "0");
    window.localStorage.setItem(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.document_editor, "0");
    expect(resolveInitialEnhancedContextSettings()).toEqual(dogfoodSettings);

    // Leaving Dev mode clears dogfood state without touching shipped families.
    expect(persistEnhancedContextSettings(dogfoodSettings, false)).toEqual(DEFAULT_ENHANCED_CONTEXT_SETTINGS);
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY)).toBe("0");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.design_dev_tool)).toBe("0");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.ai_conversation)).toBe("1");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.developer_workspace)).toBe("1");
    expect(window.localStorage.getItem(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.document_editor)).toBe("1");
    expect(resolveInitialEnhancedContextSettings()).toEqual(DEFAULT_ENHANCED_CONTEXT_SETTINGS);
  });

  it("shows production status with only dogfood diagnostics and the design experiment", () => {
    const props = renderProductionDevSettings();

    expect(screen.getByRole("button", { name: /^Enhanced context dogfood/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Enhanced context dogfood/ }));

    expect(screen.getByText("Production classification context")).toBeTruthy();
    expect(screen.getByText(/approved metadata is on by default/i)).toBeTruthy();
    expect(screen.getByText("On", { selector: ".ctrl--value" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Enable enhanced context" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Capture enhanced context locally" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Use enhanced context for low-confidence AI retry" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Enhanced context debug logging" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Experimental design context" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("switch", { name: "AI conversation context" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Developer workspace context" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Document editor context" })).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Enhanced context debug logging" }));
    fireEvent.click(screen.getByRole("switch", { name: "Experimental design context" }));
    expect(props.onEnhancedContextDebugLoggingChange).toHaveBeenCalledWith(true);
    expect(props.onEnhancedContextSourceFamilyChange).toHaveBeenCalledWith("design_dev_tool", true);

    const experimentalFamilies = new Set(["design_dev_tool"]);
    for (const option of ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS.filter((option) => !experimentalFamilies.has(option.family))) {
      expect(screen.queryByRole("switch", { name: option.label })).toBeNull();
    }
  });
});
