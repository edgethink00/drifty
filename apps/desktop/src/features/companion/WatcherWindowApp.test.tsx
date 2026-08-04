// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WatcherWindowApp } from "./WatcherWindowApp";
import type { WatcherPeekEvent } from "./WatcherPeek";
import type { CompanionPillWindowEvent } from "./watcherBridge";

function buildEvent(overrides: Partial<WatcherPeekEvent>): WatcherPeekEvent {
  return {
    id: 1,
    productivity: "neutral",
    category: "unknown",
    contextLabel: "your current workspace",
    durationLabel: "a moment",
    durationSeconds: 0,
    slotIndex: 0,
    focusSessionKind: "settled",
    driftPattern: "first",
    driftReminderElapsedSeconds: null,
    recentWatcherResponse: null,
    minutesSinceLastWatcher: null,
    focusSecondsToday: 0,
    currentHourFocusSeconds: 0,
    ...overrides,
  };
}

const bridge = vi.hoisted(() => ({
  dismissNativeWatcherPeek: vi.fn().mockResolvedValue(undefined),
  hideNativeWatcherPeek: vi.fn().mockResolvedValue(undefined),
  listenToNativeWatcherShow: vi.fn().mockResolvedValue(vi.fn()),
  respondNativeWatcherPeek: vi.fn().mockResolvedValue(undefined),
  setNativeWatcherInteractive: vi.fn().mockResolvedValue(undefined),
  triggerNativeEndOfDayReviewAction: vi.fn().mockResolvedValue(undefined),
  triggerNativeExtremeNudgeAction: vi.fn().mockResolvedValue(undefined),
  showHandler: null as ((event: CompanionPillWindowEvent) => void) | null,
}));

vi.mock("./watcherBridge", () => ({
  dismissNativeWatcherPeek: bridge.dismissNativeWatcherPeek,
  hideNativeWatcherPeek: bridge.hideNativeWatcherPeek,
  listenToNativeWatcherShow: bridge.listenToNativeWatcherShow,
  respondNativeWatcherPeek: bridge.respondNativeWatcherPeek,
  setNativeWatcherInteractive: bridge.setNativeWatcherInteractive,
  triggerNativeEndOfDayReviewAction: bridge.triggerNativeEndOfDayReviewAction,
  triggerNativeExtremeNudgeAction: bridge.triggerNativeExtremeNudgeAction,
}));

const neutralEvent = buildEvent({
  id: 1,
  productivity: "neutral",
  contextLabel: "your current workspace",
  durationLabel: "a moment",
  slotIndex: 0,
});

const focusEvent = buildEvent({
  id: 2,
  productivity: "focus",
  category: "workspace",
  contextLabel: "a focus block",
  durationLabel: "42m",
  slotIndex: 1,
  focusSessionKind: "deep",
});

const passiveDriftEvent = buildEvent({
  id: 3,
  productivity: "drift",
  category: "entertainment",
  contextLabel: "Videos",
  durationLabel: "12m",
  durationSeconds: 12 * 60,
  driftPattern: "first",
});

const milestoneEvent = {
  kind: "milestone" as const,
  id: "daily-rank-3",
  milestoneKind: "rank" as const,
  tier: 3 as const,
  title: "#3 in focus today",
  subtitle: "You entered today's top three",
  destination: "leaderboard" as const,
  statSeconds: 4 * 3600 + 48 * 60,
  statLabel: "today",
};

describe("WatcherWindowApp", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    bridge.showHandler = null;
    window.localStorage.clear();
    delete document.documentElement.dataset.surface;
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  it("initializes watcher surface theme without the main App", () => {
    window.localStorage.setItem("drifty.theme", "light");

    render(<WatcherWindowApp />);

    expect(document.documentElement.dataset.surface).toBe("watcher");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("renders native watcher events passively", async () => {
    vi.useFakeTimers();
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: CompanionPillWindowEvent) => void) => {
      bridge.showHandler = handler;
      return vi.fn();
    });

    render(<WatcherWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.(neutralEvent);
    });

    const watcher = screen.getByLabelText("Drifty watcher check-in");
    expect(watcher.getAttribute("data-phase")).toBe("peeking");

    act(() => {
      vi.advanceTimersByTime(2_400);
    });

    expect(watcher.getAttribute("data-phase")).toBe("speaking");
    expect(watcher.querySelector("button")).toBeNull();
    expect(bridge.setNativeWatcherInteractive).toHaveBeenLastCalledWith(false);
    expect(bridge.respondNativeWatcherPeek).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("keeps passive drift reminders non-interactive", async () => {
    vi.useFakeTimers();
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: CompanionPillWindowEvent) => void) => {
      bridge.showHandler = handler;
      return vi.fn();
    });

    render(<WatcherWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.(passiveDriftEvent);
    });

    const watcher = screen.getByLabelText("Drifty watcher check-in");

    act(() => {
      vi.advanceTimersByTime(2_300);
    });

    expect(watcher.getAttribute("data-phase")).toBe("speaking");
    expect(watcher.querySelector("button")).toBeNull();
    expect(bridge.setNativeWatcherInteractive).toHaveBeenLastCalledWith(false);
    vi.useRealTimers();
  });

  it("keeps focused encouragement non-interactive", async () => {
    vi.useFakeTimers();
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: CompanionPillWindowEvent) => void) => {
      bridge.showHandler = handler;
      return vi.fn();
    });

    render(<WatcherWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.(focusEvent);
    });

    const watcher = screen.getByLabelText("Drifty watcher check-in");

    act(() => {
      vi.advanceTimersByTime(2_200);
    });

    expect(watcher.getAttribute("data-phase")).toBe("speaking");
    expect(watcher.querySelector("button")).toBeNull();
    expect(bridge.setNativeWatcherInteractive).toHaveBeenLastCalledWith(false);
    vi.useRealTimers();
  });

  it("renders milestone alerts when the resident Companion is off", async () => {
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: CompanionPillWindowEvent) => void) => {
      bridge.showHandler = handler;
      return vi.fn();
    });

    const { container } = render(<WatcherWindowApp />);
    await act(async () => undefined);
    act(() => bridge.showHandler?.(milestoneEvent));

    expect(container.querySelector(".companion-pill-surface")?.getAttribute("data-state")).toBe("milestone");
    expect(screen.getByText("#3 in focus today")).toBeTruthy();
    expect(screen.getByText("4:48")).toBeTruthy();
    expect(bridge.setNativeWatcherInteractive).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Open leaderboard" }));
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith("openLeaderboard");
  });

});
