// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionWindowApp } from "./CompanionWindowApp";
import type { EndOfDayReviewEvent } from "./EndOfDayReview";
import { buildCompanionExtremeNudgePreview, buildCompanionReentryPreview } from "./companionPillPreview";
import { readCompanionEngagementMetrics } from "./companionEngagementMetrics";
import type { WatcherPeekEvent } from "./WatcherPeek";
import type { CompanionPillWindowEvent, NativeCompanionPointerEvent } from "./watcherBridge";

const bridge = vi.hoisted(() => ({
  clearHandler: null as (() => void) | null,
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
  setNativeCompanionClickThrough: vi.fn().mockResolvedValue(undefined),
  triggerNativeEndOfDayReviewAction: vi.fn().mockResolvedValue(undefined),
  triggerNativeCompanionVisibilityAction: vi.fn().mockResolvedValue(undefined),
  triggerNativeExtremeNudgeAction: vi.fn().mockResolvedValue(undefined),
}));

const nativeMenu = vi.hoisted(() => ({
  open: vi.fn().mockResolvedValue(true),
}));

vi.mock("./companionPillNativeMenu", () => ({
  openNativeCompanionPillMenu: nativeMenu.open,
}));

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
  listenToNativeCompanionPillClear: vi.fn(async (handler: () => void) => {
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
  generatedAt: "2026-08-03T18:00:00.000Z",
  trackedLabel: "6h tracked",
  focusLabel: "4h focus",
  driftLabel: "1h drift",
  totalSeconds: 21_600,
  focusSeconds: 14_400,
  driftSeconds: 3_600,
  topSource: null,
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
    bridge.setNativeCompanionPillState.mockResolvedValue({ prepared: false, menuAnchorX: null });
    delete document.documentElement.dataset.surface;
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
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
    expect(bridge.setNativeCompanionPillState).toHaveBeenLastCalledWith("collapsed");
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

    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith("openSettings");
    expect(bridge.triggerNativeCompanionVisibilityAction).toHaveBeenNthCalledWith(1, "hideOneHour");
    expect(bridge.triggerNativeCompanionVisibilityAction).toHaveBeenNthCalledWith(2, "turnOff");
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
      title: "#1 in focus today",
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
    expect(container.textContent).toContain("#1 in focus today");

    /* The stylesheet reveals the kind glyph through `[data-kind-icon]`, so a
       missing marker renders an empty mark even though the SVG is present. */
    expect(container.querySelector('.mile__kind svg[data-kind-icon="rank"]')).not.toBeNull();

    const milestone = container.querySelector<HTMLElement>(".view--milestone");
    expect(milestone?.dataset.auto).toBe("running");
    expect(milestone?.style.getPropertyValue("--auto-duration")).toBe("6000ms");
    expect(milestone?.querySelector(".card__close-ring")).not.toBeNull();

    act(() => bridge.enteredHandler?.({ screenX: 100, screenY: 100 }));
    expect(milestone?.dataset.auto).toBe("paused");
    act(() => bridge.exitedHandler?.({ screenX: 500, screenY: 100 }));
    expect(milestone?.dataset.auto).toBe("running");

    fireEvent.click(container.querySelector(".mile__action")!);
    expect(bridge.triggerNativeEndOfDayReviewAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(160));
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith("openLeaderboard");
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

  it("presents a re-entry as low-priority context and records the local aggregate", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.(buildCompanionReentryPreview(123)));
    act(() => bridge.transitionHandler?.({ state: "reentry", phase: "started", anchor: "center" }));
    act(() => vi.advanceTimersByTime(180));

    expect(container.querySelector<HTMLElement>(".pill")?.dataset.state).toBe("reentry");
    expect(container.textContent).toContain("Back after 8h 12m");
    expect(readCompanionEngagementMetrics()).toMatchObject({ reentry_shown: 1 });

    fireEvent.click(container.querySelector<HTMLButtonElement>(".reentry__action")!);
    act(() => vi.advanceTimersByTime(160));
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith(
      "openActivityDay",
      buildCompanionReentryPreview(123).lastActiveAt,
    );
    expect(readCompanionEngagementMetrics()).toMatchObject({ reentry_opened: 1 });

    act(() => bridge.showHandler?.(buildCompanionExtremeNudgePreview(456)));
    expect(container.textContent).toContain("Closed YouTube for you.");
    expect(container.textContent).not.toContain("Back after 8h 12m");
  });

  it("lets an extreme nudge preempt and permanently discard an active milestone", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.(focusMilestone));
    expect(container.textContent).toContain("1 hour of focus today");
    act(() => bridge.showHandler?.(buildCompanionExtremeNudgePreview(123)));

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

  it("lets an extreme nudge preempt and permanently discard an active day review", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompanionWindowApp />);
    await act(async () => undefined);

    act(() => bridge.showHandler?.(reviewMoment));
    expect(container.textContent).toContain("Day review");
    act(() => bridge.showHandler?.(buildCompanionExtremeNudgePreview(456)));

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
    act(() => vi.advanceTimersByTime(860));
    expect(container.textContent).toContain("1 hour of focus today");
  });
});
