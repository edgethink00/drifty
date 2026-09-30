// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionWindowApp } from "./CompanionWindowApp";
import { trackerClient } from "../../lib/api/trackerClient";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";
import { buildCompanionDriftAlarmPreview, buildCompanionExtremeNudgePreview } from "./companionPillPreview";
import { readCompanionEngagementMetrics } from "./companionEngagementMetrics";
import { DRIFT_ALARM_CORRECTION_FEEDBACK_DURATION_MS } from "./driftAlarmEvent";
import type { WatcherPeekEvent } from "./watcherPeekTypes";
import type { CompanionPillWindowEvent, NativeCompanionPointerEvent } from "./watcherBridge";

const bridge = vi.hoisted(() => ({
  clearHandler: null as ((momentKey?: string | null) => void) | null,
  enteredHandler: null as ((event: NativeCompanionPointerEvent) => void) | null,
  exitedHandler: null as ((event: NativeCompanionPointerEvent) => void) | null,
  movedHandler: null as ((event: NativeCompanionPointerEvent) => void) | null,
  transitionHandler: null as ((event: import("./watcherBridge").NativeCompanionTransitionEvent) => void) | null,
  showHandler: null as ((event: CompanionPillWindowEvent) => void) | null,
  snapshotHandler: null as ((event: WatcherPeekEvent) => void) | null,
  dismissNativeCompanionMoment: vi.fn().mockResolvedValue(undefined),
  isNativeCompanionCursorOverCapsule: vi.fn().mockResolvedValue(false),
  setNativeCompanionPillState: vi.fn().mockResolvedValue({ prepared: false, menuAnchorX: null }),
  presentPreparedNativeCompanionMoment: vi.fn().mockResolvedValue(undefined),
  notifyNativeEndOfDayReviewDisplayed: vi.fn().mockResolvedValue(undefined),
  setNativeCompanionClickThrough: vi.fn().mockResolvedValue(undefined),
  triggerNativeEndOfDayReviewAction: vi.fn().mockResolvedValue(undefined),
  triggerNativeCompanionVisibilityAction: vi.fn().mockResolvedValue(undefined),
  triggerNativeExtremeNudgeAction: vi.fn().mockResolvedValue(undefined),
}));

const nativeMenu = vi.hoisted(() => ({
  open: vi.fn().mockResolvedValue(true),
}));

const informationalSuppression = vi.hoisted(() => ({
  suppressed: false,
  refresh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./companionPillNativeMenu", () => ({
  openNativeCompanionPillMenu: nativeMenu.open,
}));

vi.mock("./informationalMomentSuppression", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./informationalMomentSuppression")>();
  return {
    ...actual,
    isInformationalMomentSuppressedNow: () => informationalSuppression.suppressed,
    refreshInformationalMomentSuppression: informationalSuppression.refresh,
  };
});

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: {
    getStatus: vi.fn().mockResolvedValue({ running: true }),
    start: vi.fn().mockResolvedValue({ running: true }),
    stop: vi.fn().mockResolvedValue({ running: false }),
  },
}));

vi.mock("./watcherBridge", () => ({
  dismissNativeCompanionMoment: bridge.dismissNativeCompanionMoment,
  isTauriRuntime: () => true,
  isNativeCompanionCursorOverCapsule: bridge.isNativeCompanionCursorOverCapsule,
  listenToNativeCompanionPillClear: vi.fn(async (handler: (momentKey?: string | null) => void) => {
    bridge.clearHandler = handler;
    return vi.fn();
  }),
  listenToNativeCompanionPillSnapshot: vi.fn(async (handler: (event: WatcherPeekEvent) => void) => {
    bridge.snapshotHandler = handler;
    return vi.fn();
  }),
  listenToNativeCompanionTransition: vi.fn(async (
    handler: (event: import("./watcherBridge").NativeCompanionTransitionEvent) => void,
  ) => {
    bridge.transitionHandler = handler;
    return vi.fn();
  }),
  listenToNativeCompanionPointerEntered: vi.fn(async (handler: (event: NativeCompanionPointerEvent) => void) => {
    bridge.enteredHandler = handler;
    return vi.fn();
  }),
  listenToNativeCompanionPointerExited: vi.fn(async (handler: (event: NativeCompanionPointerEvent) => void) => {
    bridge.exitedHandler = handler;
    return vi.fn();
  }),
  listenToNativeCompanionPointerMoved: vi.fn(async (handler: (event: NativeCompanionPointerEvent) => void) => {
    bridge.movedHandler = handler;
    return vi.fn();
  }),
  listenToNativeWatcherShow: vi.fn(async (handler: (event: CompanionPillWindowEvent) => void) => {
    bridge.showHandler = handler;
    return vi.fn();
  }),
  setNativeCompanionPillState: bridge.setNativeCompanionPillState,
  presentPreparedNativeCompanionMoment: bridge.presentPreparedNativeCompanionMoment,
  setNativeCompanionClickThrough: bridge.setNativeCompanionClickThrough,
  triggerNativeEndOfDayReviewAction: bridge.triggerNativeEndOfDayReviewAction,
  notifyNativeEndOfDayReviewDisplayed: bridge.notifyNativeEndOfDayReviewDisplayed,
  triggerNativeCompanionVisibilityAction: bridge.triggerNativeCompanionVisibilityAction,
  triggerNativeExtremeNudgeAction: bridge.triggerNativeExtremeNudgeAction,
}));

const focusSnapshot: WatcherPeekEvent = {
  id: 1,
  productivity: "focus",
  category: "workspace",
  contextLabel: "VS Code",
  durationLabel: "8m",
  durationSeconds: 480,
  slotIndex: 0,
  focusSessionKind: "settled",
  driftPattern: "first",
  driftReminderElapsedSeconds: null,
  recentWatcherResponse: null,
  minutesSinceLastWatcher: null,
  focusSecondsToday: 9_660,
  currentHourFocusSeconds: 480,
};

const reviewMoment: EndOfDayReviewEvent = {
  kind: "endOfDayReview",
  day: "2026-08-03",
  // Fresh build time: moments older than the staleness window are consumed
  // silently, so fixtures must read as "just fired".
  generatedAt: new Date().toISOString(),
  trackedLabel: "6h tracked",
  focusLabel: "4h focus",
  driftLabel: "1h drift",
  totalSeconds: 21_600,
  focusSeconds: 14_400,
  driftSeconds: 3_600,
  topSource: null,
};

const pendingReviewMoment: EndOfDayReviewEvent = {
  ...reviewMoment,
  assessment: {
    state: "pending",
    route: "local",
    reason: "provider_disconnected",
    recoveryAction: "retry",
    pendingSeconds: reviewMoment.totalSeconds,
  },
  unclassifiedSeconds: reviewMoment.totalSeconds,
};

const focusMilestone = {
  kind: "milestone" as const,
  id: "day1h",
  milestoneKind: "total" as const,
  tier: 1 as const,
  title: "1 hour of focus today",
  subtitle: "The day has real work in it now",
  destination: "dashboard" as const,
  statSeconds: 3_600,
};

describe("CompanionWindowApp", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    bridge.clearHandler = null;
    bridge.enteredHandler = null;
    bridge.exitedHandler = null;
    bridge.movedHandler = null;
    bridge.transitionHandler = null;
    bridge.showHandler = null;
    bridge.snapshotHandler = null;
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    bridge.setNativeCompanionPillState.mockResolvedValue({ prepared: false, menuAnchorX: null });
    bridge.notifyNativeEndOfDayReviewDisplayed.mockResolvedValue(undefined);
    informationalSuppression.suppressed = false;
    informationalSuppression.refresh.mockResolvedValue(undefined);
    /* `clearAllMocks` drops mock implementations as well as call history, so
       the cursor poll would answer `undefined` instead of "not over the
       capsule" and hover assertions would pass for the wrong reason. */
    bridge.isNativeCompanionCursorOverCapsule.mockResolvedValue(false);
    delete document.documentElement.dataset.surface;
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  it("resumes a paused tracker only from the companion's explicit control", async () => {
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);
    act(() => bridge.snapshotHandler?.({ ...focusSnapshot, trackingPaused: true }));
    vi.mocked(trackerClient.getStatus).mockResolvedValueOnce({
      running: false,
      trackingPaused: true,
      accessibilityGranted: true,
      lastEventAt: null,
      databasePath: null,
      trackerMode: "stopped",
      message: null,
    });

    const resumeButton = container.querySelector<HTMLButtonElement>('[data-act="toggleTracking"]');
    expect(resumeButton).not.toBeNull();
    fireEvent.click(resumeButton as HTMLButtonElement);

    await waitFor(() => expect(trackerClient.start).toHaveBeenCalledExactlyOnceWith({ resumePaused: true }));
  });

  it("ignores an earlier watcher's clear 100ms into a fresh alarm", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);
    await act(async () => bridge.showHandler?.(focusSnapshot));
    act(() => vi.advanceTimersByTime(29_900));
    const alarm = buildCompanionDriftAlarmPreview("drift-alarm");
    await act(async () => bridge.showHandler?.({ kind: "companionDriftAlarm", alarm }));
    act(() => vi.advanceTimersByTime(100));
    act(() => bridge.clearHandler?.(`watcherPeek:${focusSnapshot.id}`));
    expect(container.querySelector(".pill")?.getAttribute("data-state")).toBe("drift");
    act(() => bridge.clearHandler?.(`driftAlarm:${alarm.id}`));
    expect(container.querySelector(".pill")?.getAttribute("data-state")).toBe("collapsed");
  });

  it("drops an expired drift before requesting native geometry or presentation", async () => {
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);
    bridge.setNativeCompanionPillState.mockClear();
    const alarm = { ...buildCompanionDriftAlarmPreview("drift-alarm"), generatedAt: new Date(Date.now() - 11 * 60_000).toISOString() };
    await act(async () => bridge.showHandler?.({ kind: "companionDriftAlarm", alarm, __companionPresentation: "menuBar" }));
    expect(container.querySelector(".pill")?.getAttribute("data-state")).toBe("collapsed");
    expect(bridge.setNativeCompanionPillState).not.toHaveBeenCalled();
    expect(bridge.presentPreparedNativeCompanionMoment).not.toHaveBeenCalled();
  });

  it("skips expired queued moments and continues to a fresh queued card", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);
    await act(async () => bridge.showHandler?.(focusMilestone));
    const expiring = { ...focusMilestone, id: "expires-in-queue", generatedAt: new Date().toISOString() };
    await act(async () => bridge.showHandler?.(expiring));
    // Wall time advances through sleep while JS timers remain suspended.
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await act(async () => bridge.showHandler?.({ ...focusMilestone, id: "fresh-after-wake", title: "Fresh after wake" }));
    act(() => bridge.clearHandler?.(`milestone:${focusMilestone.id}`));
    await act(async () => vi.advanceTimersByTime(701));
    expect(container.textContent).toContain("Fresh after wake");
    expect(container.querySelector(".pill")?.getAttribute("data-state")).toBe("milestone");
  });

  it("does not resurrect queued information after a whole-surface clear", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);
    await act(async () => bridge.showHandler?.(focusMilestone));
    await act(async () => bridge.showHandler?.({ ...focusMilestone, id: "queued" }));
    act(() => bridge.clearHandler?.(null));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(container.querySelector(".pill")?.getAttribute("data-state")).toBe("collapsed");
  });

  it("does not present a card which expires during native preparation", async () => {
    vi.useFakeTimers();
    let resolvePreparation: ((result: { prepared: boolean; menuAnchorX: number; presentationId: number }) => void) | undefined;
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);
    bridge.setNativeCompanionPillState.mockImplementationOnce(() => new Promise((resolve) => { resolvePreparation = resolve; }));
    const alarm = buildCompanionDriftAlarmPreview("drift-alarm");
    await act(async () => bridge.showHandler?.({ kind: "companionDriftAlarm", alarm, __companionPresentation: "menuBar" }));
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await act(async () => resolvePreparation?.({ prepared: true, menuAnchorX: 100, presentationId: 1 }));
    await act(async () => vi.advanceTimersByTime(200));
    expect(bridge.presentPreparedNativeCompanionMoment).not.toHaveBeenCalled();
    expect(container.querySelector(".pill")?.getAttribute("data-state")).toBe("collapsed");
  });

  it("does not attach an old preparation result to a new card of the same kind", async () => {
    vi.useFakeTimers();
    let resolveOld: ((result: { prepared: boolean; menuAnchorX: number; presentationId: number }) => void) | undefined;
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);
    bridge.setNativeCompanionPillState.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const alarm = buildCompanionDriftAlarmPreview("drift-alarm");
    await act(async () => bridge.showHandler?.({ kind: "companionDriftAlarm", alarm, __companionPresentation: "menuBar" }));
    await act(async () => bridge.clearHandler?.(`driftAlarm:${alarm.id}`));
    const replacement = { ...alarm, id: "replacement" };
    bridge.setNativeCompanionPillState.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => bridge.showHandler?.({ kind: "companionDriftAlarm", alarm: replacement, __companionPresentation: "menuBar" }));
    await act(async () => resolveOld?.({ prepared: true, menuAnchorX: 123, presentationId: 1 }));
    await act(async () => vi.advanceTimersByTime(200));
    expect(bridge.presentPreparedNativeCompanionMoment).not.toHaveBeenCalled();
    expect(container.querySelector(".pill")?.getAttribute("data-direct-entry")).toBe("pending");
  });

  it("boots as its own transparent companion surface and receives snapshots", async () => {
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    expect(document.documentElement.dataset.surface).toBe("companion");
    expect(container.querySelector(".pill")?.getAttribute("data-state")).toBe("collapsed");

    act(() => bridge.snapshotHandler?.(focusSnapshot));
    expect(container.textContent).toContain("2:41");
    expect(container.textContent).toContain("focused");
  });

  it("keeps the compact controls resident without native hover state changes", async () => {
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);
    const pill = container.querySelector<HTMLElement>(".pill");

    expect(pill?.dataset.state).toBe("collapsed");
    expect(container.querySelectorAll(".view--collapsed .icon-btn")).toHaveLength(2);
    expect(bridge.setNativeCompanionPillState).not.toHaveBeenCalledWith("peek");
    expect(bridge.setNativeCompanionPillState).toHaveBeenLastCalledWith("collapsed", undefined, undefined);
  });

  it("keeps native cursor polling single-flight while a query is pending", async () => {
    vi.useFakeTimers();
    let resolveFirstQuery!: (overCapsule: boolean) => void;
    const firstQuery = new Promise<boolean>((resolve) => {
      resolveFirstQuery = resolve;
    });
    bridge.isNativeCompanionCursorOverCapsule.mockReturnValueOnce(firstQuery);

    render(<CompanionWindowApp />);
    await act(async () => undefined);
    expect(bridge.isNativeCompanionCursorOverCapsule).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(320));
    expect(bridge.isNativeCompanionCursorOverCapsule).toHaveBeenCalledTimes(1);

    await act(async () => resolveFirstQuery(false));
    act(() => vi.advanceTimersByTime(32));
    expect(bridge.isNativeCompanionCursorOverCapsule).toHaveBeenCalledTimes(2);
  });

  it("opens a native menu whose actions use the existing app routes", async () => {
    const { getByRole } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    fireEvent.click(getByRole("button", { name: "Open Companion menu" }));
    await act(async () => undefined);

    expect(nativeMenu.open).toHaveBeenCalledOnce();
    const actions = nativeMenu.open.mock.calls[0]?.[0];
    actions.onOpenSettings();
    actions.onHideForOneHour();
    actions.onTurnOffCompanion();

    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith("openSettings", undefined);
    expect(bridge.triggerNativeCompanionVisibilityAction).toHaveBeenNthCalledWith(1, "hideOneHour");
    expect(bridge.triggerNativeCompanionVisibilityAction).toHaveBeenNthCalledWith(2, "turnOff");
  });

  it("routes the pending Day Review recovery action to AI setup", async () => {
    vi.useFakeTimers();
    let resolveAcknowledgement: (() => void) | undefined;
    bridge.notifyNativeEndOfDayReviewDisplayed.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveAcknowledgement = resolve; }),
    );
    const { getByRole } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.(pendingReviewMoment));
    act(() => bridge.transitionHandler?.({ state: "eodPending", phase: "started", anchor: "center" }));
    act(() => vi.advanceTimersByTime(180));

    fireEvent.click(getByRole("button", { name: "AI settings" }));
    expect(bridge.notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-03", "2026-08-03");
    expect(bridge.triggerNativeEndOfDayReviewAction).not.toHaveBeenCalled();

    await act(async () => {
      resolveAcknowledgement?.();
      await Promise.resolve();
    });

    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith("openAiSettings", expect.any(String));
  });

  it("renders production milestone preview payloads with their celebration tier", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.({
      kind: "milestone",
      id: "preview-rank-1",
      milestoneKind: "rank",
      tier: 3,
      title: "#1 in focus last week",
      subtitle: "You reached the top of today's leaderboard",
      destination: "leaderboard",
    }));

    act(() => bridge.transitionHandler?.({
      state: "milestone",
      phase: "started",
      anchor: "center",
    }));
    act(() => vi.advanceTimersByTime(180));

    const pill = container.querySelector<HTMLElement>(".pill");
    expect(pill?.dataset.state).toBe("milestone");
    expect(pill?.dataset.tier).toBe("3");
    expect(pill?.dataset.mileKind).toBe("rank");
    expect(container.querySelector(".mile__action")?.textContent).toContain("View rank");
    /* Confetti scales with the tier: 6 sparks for a routine win, 16 for a
       record, 26 for a rare one, matching the prototype's celebration. */
    expect(container.querySelectorAll(".sparks i")).toHaveLength(26);
    expect(container.textContent).toContain("#1 in focus last week");

    /* The stylesheet reveals the kind glyph through `[data-kind-icon]`, so a
       missing marker renders an empty mark even though the SVG is present. */
    expect(container.querySelector('.mile__kind svg[data-kind-icon="rank"]')).not.toBeNull();

    const milestone = container.querySelector<HTMLElement>(".view--milestone");
    expect(milestone?.dataset.auto).toBe("running");
    expect(milestone?.style.getPropertyValue("--auto-duration")).toBe("6000ms");
    expect(milestone?.querySelector(".card__close-ring")).not.toBeNull();

    /* Hover is reported by the capsule-accurate native poll, so the pause
       follows the visible card rather than the panel's transparent gutter. */
    bridge.isNativeCompanionCursorOverCapsule.mockResolvedValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(64);
    });
    expect(milestone?.dataset.auto).toBe("paused");

    bridge.isNativeCompanionCursorOverCapsule.mockResolvedValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(64);
    });
    expect(milestone?.dataset.auto).toBe("running");

    fireEvent.click(container.querySelector(".mile__action")!);
    expect(bridge.triggerNativeEndOfDayReviewAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(160));
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith("openLeaderboard", expect.any(String));
  });

  /* The panel is much larger than the capsule it draws: the card floats inside
     a transparent gutter of 88pt to each side and 64pt above and below. AppKit's
     tracking area covers that whole rectangle, so treating its events as hover
     froze the countdown while the pointer was merely beside the card — and the
     capsule-accurate poll, which only writes when its own answer changes, never
     cleared a pause it had not set. */
  it("keeps the countdown running while the pointer is in the gutter beside the card", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.(focusMilestone));
    act(() => bridge.transitionHandler?.({ state: "milestone", phase: "started", anchor: "center" }));
    act(() => vi.advanceTimersByTime(180));

    const milestone = container.querySelector<HTMLElement>(".view--milestone");
    expect(milestone?.dataset.auto).toBe("running");

    /* The cursor is inside the panel but not over the capsule, so the native
       tracking area reports movement while the poll keeps answering false. */
    act(() => bridge.enteredHandler?.({ screenX: 20, screenY: 20 }));
    act(() => bridge.movedHandler?.({ screenX: 24, screenY: 26 }));
    expect(milestone?.dataset.auto).toBe("running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(96);
    });
    expect(milestone?.dataset.auto).toBe("running");

    /* Nothing latched, so the card still expires on its own budget without
       needing the pointer to leave the window first. The dismissal runs after
       the card's visual exit, exactly as a manual dismissal does. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    act(() => vi.advanceTimersByTime(160));
    expect(bridge.dismissNativeCompanionMoment).toHaveBeenCalledWith("milestone", expect.any(String));
  });

  /* The latch is not momentary: once the pointer has been over the capsule and
     then slides out into the gutter, AppKit keeps reporting movement over the
     panel while the poll has already settled on "not over the capsule". The
     poll writes only on a change, so it cannot undo what those events set. */
  it("resumes the countdown when the pointer slides off the card into the gutter", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.(focusMilestone));
    act(() => bridge.transitionHandler?.({ state: "milestone", phase: "started", anchor: "center" }));
    act(() => vi.advanceTimersByTime(180));
    const milestone = container.querySelector<HTMLElement>(".view--milestone");

    bridge.isNativeCompanionCursorOverCapsule.mockResolvedValue(true);
    act(() => bridge.enteredHandler?.({ screenX: 200, screenY: 90 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(64);
    });
    expect(milestone?.dataset.auto).toBe("paused");

    /* The pointer slides off the capsule but stays inside the panel, so the
       tracking area keeps delivering movement. */
    bridge.isNativeCompanionCursorOverCapsule.mockResolvedValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(64);
    });
    act(() => bridge.movedHandler?.({ screenX: 20, screenY: 20 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });

    expect(milestone?.dataset.auto).toBe("running");
  });

  it("opens View day from a one-hour focus milestone", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.(focusMilestone));
    act(() => bridge.transitionHandler?.({ state: "milestone", phase: "started", anchor: "center" }));
    act(() => vi.advanceTimersByTime(180));

    expect(container.textContent).toContain("1 hour of focus today");
    expect(container.querySelector(".mile__action")?.textContent).toContain("View day");
    fireEvent.click(container.querySelector(".mile__action")!);
    expect(bridge.triggerNativeEndOfDayReviewAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(160));
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith("openDashboard", expect.any(String));
  });

  it("reveals a hidden menu-bar moment only after its final card is committed", async () => {
    let resolveNativePresentation: (() => void) | undefined;
    const animationFrames: FrameRequestCallback[] = [];
    bridge.presentPreparedNativeCompanionMoment.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveNativePresentation = resolve;
    }));
    const animationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    bridge.setNativeCompanionPillState.mockImplementation(async (state: string) => ({
      prepared: state === "milestone",
      menuAnchorX: state === "milestone" ? 294 : null,
    }));
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.({
      ...focusMilestone,
      __companionPresentation: "menuBar",
    }));
    const pill = container.querySelector<HTMLElement>(".pill");
    expect(pill?.dataset.directEntry).toBe("pending");
    expect(pill?.style.getPropertyValue("--menu-anchor-x")).toBe("");
    await act(async () => undefined);

    expect(pill?.dataset.state).toBe("milestone");
    expect(pill?.dataset.transition).toBeUndefined();
    expect(pill?.dataset.directEntry).toBe("pending");
    expect(pill?.style.getPropertyValue("--menu-anchor-x")).toBe("294px");
    expect(container.querySelector(".view--collapsed")?.classList.contains("is-active")).toBe(false);
    expect(container.querySelector(".view--milestone")?.classList.contains("is-active")).toBe(true);
    expect(bridge.presentPreparedNativeCompanionMoment).not.toHaveBeenCalled();

    act(() => animationFrames.shift()?.(0));
    expect(bridge.presentPreparedNativeCompanionMoment).not.toHaveBeenCalled();
    act(() => animationFrames.shift()?.(16));
    expect(bridge.presentPreparedNativeCompanionMoment).toHaveBeenCalledOnce();

    await act(async () => resolveNativePresentation?.());
    expect(pill?.dataset.directEntry).toBe("pending");
    act(() => animationFrames.shift()?.(32));
    expect(pill?.dataset.directEntry).toBe("true");

    act(() => bridge.clearHandler?.());
    await act(async () => undefined);
    expect(pill?.dataset.directEntry).toBeUndefined();

    act(() => bridge.showHandler?.({
      ...focusMilestone,
      __companionPresentation: "menuBar",
    }));
    await act(async () => undefined);
    expect(pill?.dataset.directEntry).toBe("pending");
    animationFrameSpy.mockRestore();
  });

  it("releases a presented drift card when animation frames stop arriving", async () => {
    vi.useFakeTimers();
    let resolveNativePresentation: (() => void) | undefined;
    bridge.presentPreparedNativeCompanionMoment.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveNativePresentation = resolve;
    }));
    bridge.setNativeCompanionPillState.mockImplementation(async (state: string) => ({
      prepared: state === "drift",
      menuAnchorX: state === "drift" ? 294 : null,
    }));
    // Model a live bridge and timers with no rendering frames. Native visibility
    // alone must not leave the card in its nearly invisible pending CSS pose.
    const animationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    try {
      const { container, getByTitle } = render(<CompanionWindowApp />);
      await act(async () => undefined);
      await act(async () => bridge.showHandler?.({
        kind: "companionDriftAlarm",
        alarm: buildCompanionDriftAlarmPreview("drift-alarm"),
        __companionPresentation: "menuBar",
      }));
      const pill = container.querySelector<HTMLElement>(".pill");
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(bridge.presentPreparedNativeCompanionMoment).toHaveBeenCalledOnce();
      expect(pill?.dataset.directEntry).toBe("pending");

      await act(async () => resolveNativePresentation?.());
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(pill?.dataset.directEntry).toBe("true");
      expect(pill?.dataset.state).toBe("drift");
      fireEvent.click(getByTitle("Dismiss"));
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(bridge.dismissNativeCompanionMoment).toHaveBeenCalledOnce();
    } finally {
      animationFrameSpy.mockRestore();
    }
  });

  it.each(["before", "after"] as const)("does not release a replacement card cleared %s native show completion", async (clearWhen) => {
    vi.useFakeTimers();
    let resolveFirstPresentation: (() => void) | undefined;
    const animationFrames: FrameRequestCallback[] = [];
    bridge.presentPreparedNativeCompanionMoment
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirstPresentation = resolve; }))
      .mockImplementationOnce(() => new Promise<void>(() => undefined));
    bridge.setNativeCompanionPillState.mockImplementation(async (state: string) => ({
      prepared: state === "drift",
      menuAnchorX: state === "drift" ? 294 : null,
    }));
    const animationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    try {
      const { container } = render(<CompanionWindowApp />);
      await act(async () => undefined);
      const payload: CompanionPillWindowEvent = {
        kind: "companionDriftAlarm",
        alarm: buildCompanionDriftAlarmPreview("drift-alarm"),
        __companionPresentation: "menuBar",
      };
      await act(async () => bridge.showHandler?.(payload));
      await act(async () => vi.advanceTimersByTimeAsync(50));
      expect(bridge.presentPreparedNativeCompanionMoment).toHaveBeenCalledOnce();
      if (clearWhen === "after") await act(async () => resolveFirstPresentation?.());
      await act(async () => bridge.clearHandler?.());
      await act(async () => bridge.showHandler?.(payload));
      if (clearWhen === "before") await act(async () => resolveFirstPresentation?.());
      // Even a late callback from the old attempt must not unlock a new card
      // with the same identity before its own native show has completed.
      await act(async () => { animationFrames.splice(0).forEach((frame) => frame(0)); });
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(bridge.presentPreparedNativeCompanionMoment).toHaveBeenCalledTimes(2);
      expect(container.querySelector<HTMLElement>(".pill")?.dataset.directEntry).toBe("pending");
    } finally {
      animationFrameSpy.mockRestore();
    }
  });

  it("keeps a drift card pending when native presentation fails", async () => {
    vi.useFakeTimers();
    bridge.presentPreparedNativeCompanionMoment.mockRejectedValueOnce(new Error("native show failed"));
    bridge.setNativeCompanionPillState.mockResolvedValue({ prepared: true, menuAnchorX: 294 });
    const animationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    try {
      const { container } = render(<CompanionWindowApp />);
      await act(async () => undefined);
      await act(async () => bridge.showHandler?.({
        kind: "companionDriftAlarm",
        alarm: buildCompanionDriftAlarmPreview("drift-alarm"),
        __companionPresentation: "menuBar",
      }));
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(bridge.presentPreparedNativeCompanionMoment).toHaveBeenCalledOnce();
      expect(container.querySelector<HTMLElement>(".pill")?.dataset.directEntry).toBe("pending");
    } finally {
      animationFrameSpy.mockRestore();
    }
  });

  it("queues distinct milestones instead of replacing the celebration on screen", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.({
        kind: "milestone",
        id: "day1h",
        milestoneKind: "total",
        tier: 1,
        title: "1 hour of focus today",
        subtitle: "The day has real work in it now",
        destination: "dashboard",
        statSeconds: 3_600,
      });
      bridge.showHandler?.({
        kind: "milestone",
        id: "day3h",
        milestoneKind: "total",
        tier: 1,
        title: "3 hours of focus today",
        subtitle: "A solid day by any measure",
        destination: "dashboard",
        statSeconds: 10_800,
      });
    });

    expect(container.textContent).toContain("1 hour of focus today");
    expect(container.textContent).not.toContain("3 hours of focus today");

    const dismiss = container.querySelector<HTMLButtonElement>(".view--milestone .card__close");
    expect(dismiss).not.toBeNull();
    fireEvent.click(dismiss!);

    act(() => vi.advanceTimersByTime(859));
    expect(container.textContent).not.toContain("3 hours of focus today");

    act(() => vi.advanceTimersByTime(1));
    expect(container.textContent).toContain("3 hours of focus today");
  });

  it("lets an extreme nudge preempt and permanently discard an active milestone", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.(focusMilestone));
    expect(container.textContent).toContain("1 hour of focus today");
    act(() => bridge.showHandler?.(buildCompanionExtremeNudgePreview()));

    expect(container.textContent).toContain("Closed YouTube for you.");
    expect(container.textContent).not.toContain("1 hour of focus today");
    expect(readCompanionEngagementMetrics()).toMatchObject({
      milestone_shown: 1,
      extreme_nudge_shown: 1,
      moment_preempted: 1,
    });

    fireEvent.click(container.querySelector(".view--nudge .card__close")!);
    act(() => vi.advanceTimersByTime(1_000));
    expect(container.textContent).not.toContain("1 hour of focus today");
  });

  it("replaces Not a drift with one learning acknowledgement", async () => {
    vi.useFakeTimers();
    const { container, getByRole } = render(<CompanionWindowApp />);
    await act(async () => undefined);
    const nudge = buildCompanionExtremeNudgePreview();

    await act(async () => {
      bridge.showHandler?.(nudge);
      await Promise.resolve();
    });
    await act(async () => {
      bridge.transitionHandler?.({ state: "nudge", phase: "started", anchor: "center" });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Not a drift" }));
      await Promise.resolve();
    });
    expect(bridge.triggerNativeExtremeNudgeAction).toHaveBeenCalledWith({ type: "manual_correction" }, expect.any(String));
    expect(container.textContent).toContain("Learning signal added");
    expect(container.textContent).toContain("Similar decisions will now weigh this as not drift.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIFT_ALARM_CORRECTION_FEEDBACK_DURATION_MS + 160);
    });
    expect(bridge.dismissNativeCompanionMoment).toHaveBeenCalledWith("notDriftFeedback", expect.any(String));
  });

  it("keeps the development drift preview interactive through acknowledgement dismissal", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/?driftyCompanionPreview=drift-alarm");
    const { container, getByRole } = render(
      <StrictMode>
        <CompanionWindowApp />
      </StrictMode>,
    );
    await act(async () => undefined);

    await act(async () => {
      bridge.transitionHandler?.({ state: "drift", phase: "completed", anchor: "center" });
      await Promise.resolve();
    });
    fireEvent.pointerEnter(container.querySelector(".view--drift")!);
    fireEvent.click(getByRole("button", { name: "Not a drift" }));
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("Learning signal added");
    expect(container.textContent).toContain("Similar decisions will now weigh this as not drift.");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIFT_ALARM_CORRECTION_FEEDBACK_DURATION_MS + 160);
    });
    expect(bridge.dismissNativeCompanionMoment).toHaveBeenCalledWith("notDriftFeedback", expect.any(String));
  });

  it("lets an extreme nudge preempt and permanently discard an active day review", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.(reviewMoment));
    expect(container.textContent).toContain("Day review");
    act(() => bridge.showHandler?.(buildCompanionExtremeNudgePreview()));

    expect(container.textContent).toContain("Closed YouTube for you.");
    expect(container.textContent).not.toContain("Day review");

    fireEvent.click(container.querySelector(".view--nudge .card__close")!);
    act(() => vi.advanceTimersByTime(1_000));
    expect(container.textContent).not.toContain("Day review");
  });

  it("keeps day review and milestone non-preemptive", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.(reviewMoment);
      bridge.showHandler?.(focusMilestone);
    });

    expect(container.textContent).toContain("Day review");
    expect(container.textContent).not.toContain("1 hour of focus today");

    fireEvent.click(container.querySelector(".view--eod .card__close")!);
    await act(async () => vi.advanceTimersByTimeAsync(860));
    expect(container.textContent).toContain("1 hour of focus today");
  });

  it("never queues a second day review behind the one being shown", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.(reviewMoment);
      bridge.showHandler?.({
        ...reviewMoment,
        day: "2026-08-04",
        generatedAt: new Date(Date.now() + 1).toISOString(),
        trackedLabel: "7h tracked",
        totalSeconds: 7 * 3_600,
        focusSeconds: 5 * 3_600,
      });
    });

    expect(container.textContent).toContain("6:00 tracked");
    expect(container.textContent).not.toContain("7:00 tracked");
    await act(async () => {
      fireEvent.click(container.querySelector(".view--eod .card__close")!);
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(bridge.dismissNativeCompanionMoment).toHaveBeenCalledWith("endOfDayReview", expect.any(String));
    expect(container.textContent).not.toContain("7:00 tracked");
  });

  it("never defers a second day review behind an active review during fullscreen", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.(reviewMoment));
    informationalSuppression.suppressed = true;
    act(() => bridge.showHandler?.({
      ...reviewMoment,
      day: "2026-08-04",
      generatedAt: new Date(Date.now() + 1).toISOString(),
      trackedLabel: "7h tracked",
      totalSeconds: 7 * 3_600,
      focusSeconds: 5 * 3_600,
    }));

    await act(async () => {
      fireEvent.click(container.querySelector(".view--eod .card__close")!);
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    informationalSuppression.suppressed = false;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));

    expect(container.textContent).not.toContain("7:00 tracked");
    expect(container.querySelector(".pill")?.getAttribute("data-state")).toBe("collapsed");
  });

  it("expires a fullscreen-deferred catch-up at today's review deadline", async () => {
    vi.useFakeTimers();
    const generatedAt = Date.now();
    informationalSuppression.suppressed = true;
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.({
      ...reviewMoment,
      generatedAt: new Date(generatedAt).toISOString(),
      expiresAt: new Date(generatedAt + 30_000).toISOString(),
    }));
    expect(container.textContent).not.toContain("Day review");

    await act(async () => vi.advanceTimersByTimeAsync(31_000));
    informationalSuppression.suppressed = false;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));

    expect(container.textContent).not.toContain("Day review");
    expect(container.querySelector(".pill")?.getAttribute("data-state")).toBe("collapsed");
  });

  it("waits for the day-review display acknowledgement before an explicit close", async () => {
    vi.useFakeTimers();
    let resolveAcknowledgement: (() => void) | undefined;
    bridge.notifyNativeEndOfDayReviewDisplayed.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveAcknowledgement = resolve; }),
    );
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);
    act(() => bridge.showHandler?.(reviewMoment));

    fireEvent.click(container.querySelector(".view--eod .card__close")!);
    await act(async () => vi.advanceTimersByTimeAsync(400));

    expect(bridge.notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-03", "2026-08-03");
    expect(bridge.dismissNativeCompanionMoment).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Day review");

    await act(async () => {
      resolveAcknowledgement?.();
      await Promise.resolve();
    });

    expect(bridge.dismissNativeCompanionMoment).toHaveBeenCalledWith("endOfDayReview", expect.any(String));
  });
});
