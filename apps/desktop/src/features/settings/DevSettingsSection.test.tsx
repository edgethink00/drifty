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
import {
  PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY,
  PET_MODE_DANCE_ON_CLOSE_BETA_STORAGE_KEY,
} from "../pet-mode/petModeData";

const featureSwitches = vi.hoisted(() => ({
  demoDashboardReplayDevToolEnabled: false,
}));

const bootShellActions = vi.hoisted(() => ({
  showBootShellPreview: vi.fn(),
}));

const petModeLabEvents = vi.hoisted(() => ({
  listener: null as ((state: { phase: string; activeAction: string | null; lifeLoopEnabled: boolean; facing?: "left" | "right" }) => void) | null,
  previewFacing: vi.fn().mockResolvedValue(true),
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
  previewNativePetModeFacing: petModeLabEvents.previewFacing,
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
    petModeLabEvents.previewFacing.mockClear();
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

  it("toggles Team preview from Feature flags", () => {
    const props = renderProductionDevSettings({ activeSubsection: "featureFlags" });

    expect(screen.getByText("Team preview (beta)")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle Teams beta" }));
    expect(props.onTeamsBetaChange).toHaveBeenCalledWith(true);
  });

  it("does not duplicate the app language preference in Dev settings", () => {
    renderProductionDevSettings();

    expect(screen.queryByRole("switch", { name: "Toggle Korean localization preview" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
  });

  it("keeps the detailed Pet Mode Lab in Dev while the pet itself ships elsewhere", () => {
    renderProductionDevSettings({ activeSubsection: "petCompanion" });
    expect(screen.getByRole("group", { name: "Pet Mode Lab" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Intervention/ }).getAttribute("disabled")).toBe("");
    expect(screen.getByRole("button", { name: /Walk 20.8 px\/s sample/ }).getAttribute("disabled")).toBe("");

    // The pet is a production feature now: its on/off switch, coat, and size
    // live in Companion & Alerts, so Dev must not offer a second copy.
    expect(screen.queryByRole("switch", { name: /Pet Mode preview/ })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Pet coat" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Pet size" })).toBeNull();

    cleanup();
    const enabledProps = renderProductionDevSettings({ activeSubsection: "petCompanion", petModeEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: /Intervention/ }));
    expect(enabledProps.onPreviewPetModeIntervention).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Stretch Flow Stretch C/ }));
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("stretch");
    const musicNoteButton = screen.getByRole("button", { name: /Music note Manual 760 ms preview/ });
    const stretchWithNoteButton = screen.getByRole("button", { name: /Stretch \+ note Guaranteed combination/ });
    const tailWithNoteButton = screen.getByRole("button", { name: /Tail \+ note Guaranteed combination/ });
    const sleepAngryButton = screen.getByRole("button", { name: /Sleep → angry Guaranteed wake reaction/ });
    expect(musicNoteButton.getAttribute("disabled")).toBeNull();
    expect(stretchWithNoteButton.getAttribute("disabled")).toBeNull();
    expect(tailWithNoteButton.getAttribute("disabled")).toBeNull();
    expect(sleepAngryButton.getAttribute("disabled")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Toggle expressive pet interactions" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Toggle drop and life rhythm preview" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Toggle shake-to-floor drop" })).toBeNull();
    const naturalOddsToggle = screen.getByRole("switch", { name: "Toggle guaranteed expressive outcomes" });
    expect(naturalOddsToggle.getAttribute("disabled")).toBeNull();
    expect(naturalOddsToggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(musicNoteButton);
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("music_note");
    fireEvent.click(stretchWithNoteButton);
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("stretch_with_note");
    fireEvent.click(tailWithNoteButton);
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("tail_flick_with_note");
    fireEvent.click(sleepAngryButton);
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("sleep_angry_wake");
    const danceButton = screen.getByRole("button", { name: /Dance 4-beat hip sway/ });
    fireEvent.click(danceButton);
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("dance");
    const danceOnCloseToggle = screen.getByRole("switch", { name: "Toggle Dance on close beta" });
    expect(danceOnCloseToggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(danceOnCloseToggle);
    expect(window.localStorage.getItem(PET_MODE_DANCE_ON_CLOSE_BETA_STORAGE_KEY)).toBe("1");
    const guaranteedOutcomesToggle = screen.getByRole("switch", { name: "Toggle guaranteed expressive outcomes" });
    expect(screen.getByText("Natural odds")).toBeTruthy();
    fireEvent.click(guaranteedOutcomesToggle);
    expect(screen.getByText("Always trigger")).toBeTruthy();
    expect(window.localStorage.getItem(PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY)).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: /Sit G pose QA/ }));
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("sit");
    fireEvent.click(screen.getByRole("button", { name: /Browser tab X/ }));
    expect(enabledProps.onPreviewPetModeBrowserTabClose).toHaveBeenCalledTimes(1);
    const browserXShortcut = screen.getByRole("switch", { name: "Toggle Browser X session shortcut" });
    expect(screen.getByText("Browser X shortcut off")).toBeTruthy();
    expect(screen.getByText("⌃⌥X · exact observed tab only · resets on app quit")).toBeTruthy();
    fireEvent.click(browserXShortcut);
    expect(enabledProps.onPetModeBrowserXShortcutEnabledChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: /Drifty window X/ }));
    expect(enabledProps.onPreviewPetModeDriftyWindowClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Life loop/ }));
    expect(enabledProps.onPreviewPetModeAction).toHaveBeenCalledWith("life_loop");
    fireEvent.click(screen.getByRole("button", { name: /Center drop/ }));
    expect(enabledProps.onPlacePetModeCenter).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Look around/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Play Flow/ })).toBeNull();
  });

  it("keeps the fast-run beta opt-in in Dev and dependent on the pet", () => {
    const offProps = renderProductionDevSettings({
      activeSubsection: "petCompanion",
      petModeEnabled: false,
      petModeRunBetaEnabled: false,
    });
    const disabledToggle = screen.getByRole("switch", { name: "Toggle the beta fast-run animation" });
    expect(disabledToggle.getAttribute("aria-checked")).toBe("false");
    expect(disabledToggle.hasAttribute("disabled")).toBe(true);
    fireEvent.click(disabledToggle);
    expect(offProps.onPetModeRunBetaEnabledChange).not.toHaveBeenCalled();

    cleanup();
    const onProps = renderProductionDevSettings({
      activeSubsection: "petCompanion",
      petModeEnabled: true,
      petModeRunBetaEnabled: false,
    });
    fireEvent.click(screen.getByRole("switch", { name: "Toggle the beta fast-run animation" }));
    expect(onProps.onPetModeRunBetaEnabledChange).toHaveBeenCalledWith(true);
  });

  it("shows the real pet phase and prevents overlapping Lab actions", async () => {
    renderProductionDevSettings({ activeSubsection: "petCompanion", petModeEnabled: true });
    await act(async () => undefined);

    act(() => {
      petModeLabEvents.listener?.({ phase: "tail", activeAction: "tail_flick", lifeLoopEnabled: false });
    });

    expect(screen.getByText("Tail flick", { selector: ".pet-mode-lab__status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tail flick/ }).classList.contains("is-active")).toBe(true);
    expect(screen.getByRole("button", { name: /Tail flick/ }).getAttribute("disabled")).toBe("");
    expect(screen.getByRole("button", { name: /Walk/ }).getAttribute("disabled")).toBe("");
    expect(screen.getByRole("button", { name: /Browser tab X/ }).getAttribute("disabled")).toBeNull();
    expect(screen.getByRole("button", { name: /Drifty window X/ }).getAttribute("disabled")).toBeNull();
    expect(screen.getByRole("button", { name: /Stop/ }).getAttribute("disabled")).toBeNull();

    act(() => {
      petModeLabEvents.listener?.({ phase: "sit", activeAction: "sit", lifeLoopEnabled: false });
    });

    expect(screen.getByText("Sitting", { selector: ".pet-mode-lab__status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sit G pose QA/ }).classList.contains("is-active")).toBe(true);
    expect(screen.getByRole("button", { name: /Browser tab X/ }).getAttribute("disabled")).toBeNull();

    act(() => {
      petModeLabEvents.listener?.({ phase: "sleep", activeAction: "sleep", lifeLoopEnabled: false });
    });
    expect(screen.getByRole("button", { name: /Browser tab X/ }).getAttribute("disabled")).toBeNull();

    act(() => {
      petModeLabEvents.listener?.({ phase: "run", activeAction: "intervention", lifeLoopEnabled: false });
    });
    expect(screen.getByRole("button", { name: /Browser tab X/ }).getAttribute("disabled")).toBe("");
  });

  it("previews left and right facing only while the pet is resting", async () => {
    renderProductionDevSettings({ activeSubsection: "petCompanion", petModeEnabled: true });
    await act(async () => undefined);

    const facingToggle = screen.getByRole("switch", { name: "Face pet right" });
    expect(facingToggle.getAttribute("disabled")).toBe("");

    act(() => {
      petModeLabEvents.listener?.({ phase: "idle", activeAction: null, lifeLoopEnabled: false, facing: "left" });
    });
    expect(screen.getByText("Facing left")).toBeTruthy();
    expect(facingToggle.getAttribute("disabled")).toBeNull();
    expect(facingToggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(facingToggle);
    expect(petModeLabEvents.previewFacing).toHaveBeenLastCalledWith("right");

    act(() => {
      petModeLabEvents.listener?.({ phase: "idle", activeAction: null, lifeLoopEnabled: false, facing: "right" });
    });
    expect(screen.getByText("Facing right")).toBeTruthy();
    fireEvent.click(facingToggle);
    expect(petModeLabEvents.previewFacing).toHaveBeenLastCalledWith("left");

    act(() => {
      petModeLabEvents.listener?.({ phase: "walk", activeAction: "walk", lifeLoopEnabled: false, facing: "left" });
    });
    expect(facingToggle.getAttribute("disabled")).toBe("");
  });

  it("keeps explicit cursor hunt previews available while the focused cat is sitting", async () => {
    window.localStorage.setItem("drifty.pet.driftHuntEnabled.v1", "true");
    renderProductionDevSettings({ activeSubsection: "petCompanion", petModeEnabled: true });
    await act(async () => undefined);

    act(() => {
      petModeLabEvents.listener?.({ phase: "sit", activeAction: null, lifeLoopEnabled: false });
    });

    expect(screen.getByRole("button", { name: /단발 사냥 재생/ }).getAttribute("disabled")).toBeNull();
    expect(screen.getByRole("button", { name: /전체 사냥 재생 · 여유 2초/ }).getAttribute("disabled")).toBeNull();
    expect(screen.getByRole("button", { name: /Music note Manual 760 ms preview/ }).getAttribute("disabled")).toBeNull();
    expect(screen.getByRole("button", { name: /Walk/ }).getAttribute("disabled")).toBe("");

    act(() => {
      petModeLabEvents.listener?.({ phase: "sit", activeAction: "music_note", lifeLoopEnabled: false });
    });
    expect(screen.getByText("Music note", { selector: ".pet-mode-lab__status" })).toBeTruthy();
  });

  it("keeps the sleeping-drift previews clickable when the cat is already asleep", async () => {
    const props = renderProductionDevSettings({
      activeSubsection: "petCompanion",
      petModeEnabled: true,
    });
    await act(async () => undefined);

    act(() => {
      petModeLabEvents.listener?.({ phase: "sleep", activeAction: null, lifeLoopEnabled: false });
    });

    const notice = screen.getByRole("button", { name: /잠든 감지 재생/ });
    const complete = screen.getByRole("button", { name: /잠든 딴짓 전체 재생/ });
    expect(notice.getAttribute("disabled")).toBeNull();
    expect(complete.getAttribute("disabled")).toBeNull();

    fireEvent.click(complete);
    expect(props.onPreviewPetModeAction).toHaveBeenCalledWith("sleep_drift_full_preview");
  });

  it("keeps the Cursor control switch appearance synchronized with its OFF and ON labels", () => {
    renderProductionDevSettings({
      activeSubsection: "petCompanion",
      petModeEnabled: true,
    });

    const toggle = screen.getByRole("switch", { name: "Toggle drift cursor hunt" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.classList.contains("on")).toBe(false);
    expect(screen.getByText("Off by default")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.classList.contains("on")).toBe(true);
    expect(screen.getByText("Enabled for QA")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.classList.contains("on")).toBe(false);
    expect(screen.getByText("Off by default")).toBeTruthy();
  });

  it("lets Dev calibrate the floor-home stay band without changing the shipped default", () => {
    const onPetModeFloorHomePtChange = vi.fn();
    renderProductionDevSettings({
      activeSubsection: "petCompanion",
      petModeEnabled: true,
      petModeFloorHomePt: 20,
      onPetModeFloorHomePtChange,
    });

    const slider = screen.getByRole("slider", { name: "Floor home stay band" });
    expect(slider.getAttribute("min")).toBe("0");
    expect(slider.getAttribute("max")).toBe("65");
    expect((slider as HTMLInputElement).value).toBe("20");
    fireEvent.change(slider, { target: { value: "12" } });
    expect(onPetModeFloorHomePtChange).toHaveBeenCalledWith(12);
  });

  it("persists a bounded cursor chase policy from the Pet Mode Lab", () => {
    const props = renderProductionDevSettings({ activeSubsection: "petCompanion", petModeEnabled: true });

    expect(screen.getByText("Drift reaction")).toBeTruthy();
    expect(screen.getByText("Production")).toBeTruthy();
    expect(screen.getByText("10초 눈치챔 · 24초 기상 · 커서 이동 없음")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {
      name: /잠든 감지 재생.*주황 빠직 \+ 찡그림.*딴짓 중 계속 유지/,
    }));
    expect(props.onPreviewPetModeAction).toHaveBeenCalledWith("sleep_drift_notice");
    fireEvent.click(screen.getByRole("button", {
      name: /잠든 딴짓 전체 재생.*감지부터 빨간 !까지 압축.*실제 커서 이동 없음/,
    }));
    expect(props.onPreviewPetModeAction).toHaveBeenCalledWith("sleep_drift_full_preview");

    expect(screen.getByText("Cursor control")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "도착 후 추가 추격" })).toBeNull();
    expect(screen.queryByRole("button", { name: /단발 사냥 재생/ })).toBeNull();
    expect(screen.getByText("딴짓 반응 연출만 유지 · 실제 커서 접근 없음")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle drift cursor hunt" }));
    expect(screen.getByText("무저항")).toBeTruthy();
    expect(screen.getByText("6초 물고 이동")).toBeTruthy();
    expect(screen.getByText("약한 저항")).toBeTruthy();
    expect(screen.getByText("2초 물고 이동")).toBeTruthy();
    expect(screen.getByText("강한 저항")).toBeTruthy();
    expect(screen.getByText("1초 물고 이동")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /단발 사냥 재생/ }));
    expect(props.onPreviewPetModeAction).toHaveBeenCalledWith("cursor_hunt_single");
    const chasePreview = screen.getByRole("button", {
      name: /전체 사냥 재생 · 여유 2초.*예상 도착 시간에 이 여유를 더해/,
    });
    fireEvent.click(chasePreview);
    expect(props.onPreviewPetModeAction).toHaveBeenCalledWith("cursor_hunt_chase");
    fireEvent.click(screen.getByRole("radio", { name: "도착 후 추가 추격" }));
    fireEvent.click(screen.getByText("추격 세부 설정 · 자유 조정"));
    expect(screen.getByText("거리로 계산한 예상 도착 시간에 더해지는 시간 · 멀수록 제한도 함께 늘어납니다")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Cursor chase duration" }), { target: { value: "6500" } });
    expect(screen.getByRole("button", { name: /전체 사냥 재생 · 여유 6.5초/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Cursor stalk speed" }), { target: { value: "280" } });
    fireEvent.change(screen.getByRole("slider", { name: "Cursor carry distance" }), { target: { value: "96" } });
    fireEvent.change(screen.getByRole("slider", { name: "Still cursor carry duration" }), { target: { value: "5000" } });
    fireEvent.change(screen.getByRole("slider", { name: "Cursor carry lag" }), { target: { value: "160" } });
    fireEvent.click(screen.getByRole("switch", { name: "Toggle soft cursor chase turns" }));
    expect(screen.getByText("추격 시작 때 빨간 ! 1회")).toBeTruthy();
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
    const props = renderProductionDevSettings({
      activeSubsection: "petCompanion",
      floatingCompanionDevEnabled: false,
    });

    expect(screen.getByText(/production uses the menu-bar Companion/i)).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Floating" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle floating Companion" }));

    expect(props.onFloatingCompanionDevEnabledChange).toHaveBeenCalledWith(true);
  });

  it("renders only the active Dev subsection", () => {
    renderProductionDevSettings();

    const diagnosticsHeading = screen.getByRole("heading", { name: "Diagnostics" });
    expect(diagnosticsHeading).toBeTruthy();
    expect(diagnosticsHeading.closest(".dev-settings-page-header")?.querySelector("p")).toBeNull();
    expect(screen.getByRole("heading", { name: /^Debug logs$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^AX fallback diagnostics/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^AX fallback diagnostics/ }));
    expect(screen.getByText("Force browser history URL fallback")).toBeTruthy();
    expect(screen.getByRole("group", { name: /^Pre-release updates$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Check Latest Build$/i })).toBeTruthy();
    expect(screen.queryByText("Team preview (beta)")).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Flow previews$/ })).toBeNull();
    expect(screen.queryByRole("group", { name: "Dashboard demo replay" })).toBeNull();

    cleanup();
    renderProductionDevSettings({ activeSubsection: "featureFlags" });
    expect(screen.getByRole("heading", { name: "Feature flags" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Product preview flags" })).toBeTruthy();
    expect(screen.getByText("Team preview (beta)")).toBeTruthy();
    expect(screen.getByText("Your Agents (beta)")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Debug logs$/ })).toBeNull();
  });

  it("previews the real startup loading screen for seven seconds", () => {
    renderProductionDevSettings({ activeSubsection: "uiFlows" });

    fireEvent.click(screen.getByRole("button", { name: "Preview 7 seconds" }));

    expect(screen.getByText("Startup loading screen")).toBeTruthy();
    expect(bootShellActions.showBootShellPreview).toHaveBeenCalledTimes(1);
  });

  it("previews production milestones through the active notification surface", () => {
    const props = renderProductionDevSettings({ activeSubsection: "petCompanion" });
    fireEvent.click(screen.getByRole("button", { name: "30-day record" }));
    fireEvent.click(screen.getByRole("button", { name: "Weekly final #2" }));
    fireEvent.click(screen.getByRole("button", { name: "Weekly final #1" }));

    expect(props.onPreviewCompanionMilestone).toHaveBeenNthCalledWith(1, "record-30d");
    expect(props.onPreviewCompanionMilestone).toHaveBeenNthCalledWith(2, "weekly-final-rank-2");
    expect(props.onPreviewCompanionMilestone).toHaveBeenNthCalledWith(3, "weekly-final-rank-1");
  });

  it("keeps production placement choices out of the Dev Companion Lab", () => {
    renderProductionDevSettings({ activeSubsection: "petCompanion" });

    expect(screen.queryByRole("radiogroup", { name: "Companion policy" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Menu bar display" })).toBeNull();
  });

  it("keeps the Companion Day review as a moment preview without a version picker", () => {
    renderProductionDevSettings({ activeSubsection: "petCompanion" });

    expect(screen.getByRole("button", { name: "Day review" })).toBeTruthy();
    expect(screen.queryByText("V3 final")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Full" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "V2" })).toBeNull();
  });

  /* Drift alerts, the break-over card and the day review only ever appeared
     after real drift, so their layout could not be reviewed on demand. */
  it("previews the decision cards through the active notification surface", () => {
    const props = renderProductionDevSettings({ activeSubsection: "petCompanion" });
    fireEvent.click(screen.getByRole("button", { name: "Drift alert" }));
    fireEvent.click(screen.getByRole("button", { name: "Break over" }));
    fireEvent.click(screen.getByRole("button", { name: "Automatic close" }));
    fireEvent.click(screen.getByRole("button", { name: "Day review" }));

    expect(props.onPreviewCompanionMoment).toHaveBeenNthCalledWith(1, "drift-alarm");
    expect(props.onPreviewCompanionMoment).toHaveBeenNthCalledWith(2, "break-return");
    expect(props.onPreviewCompanionMoment).toHaveBeenNthCalledWith(3, "extreme-nudge");
    expect(props.onPreviewCompanionDayReview).toHaveBeenCalledTimes(1);
  });

  it("uses the production Automatic close name in AX diagnostics", () => {
    renderProductionDevSettings();
    fireEvent.click(screen.getByRole("button", { name: /^AX fallback diagnostics/ }));

    expect(screen.getByText("Force Chromium AX automatic close")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Force Chromium Accessibility automatic close" })).toBeTruthy();
    expect(screen.queryByText(/Extreme nudge/)).toBeNull();
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
    renderProductionDevSettings({ activeSubsection: "uiFlows" });

    expect(screen.queryByText(/^Onboarding v2\.1 preview$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Preview v2\.1$/i })).toBeNull();
  });

  it("shows dashboard demo replay controls and calls replay handlers when the feature switch is enabled", () => {
    featureSwitches.demoDashboardReplayDevToolEnabled = true;

    const props = renderProductionDevSettings({ activeSubsection: "uiFlows" });
    fireEvent.click(screen.getByRole("button", { name: "Replay Your Day" }));
    fireEvent.click(screen.getByRole("button", { name: "Replay Your Week" }));
    const preRollInput = screen.getByLabelText("Demo replay pre-roll seconds");
    const durationInput = screen.getByLabelText("Demo replay duration seconds");
    fireEvent.change(preRollInput, { target: { value: "7" } });
    fireEvent.change(durationInput, { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset defaults" }));

    expect(screen.getByRole("heading", { name: "Flow previews" })).toBeTruthy();
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
    renderProductionDevSettings({ activeSubsection: "aiCapture" });
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
    const props = renderProductionDevSettings({ activeSubsection: "aiCapture" });

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
