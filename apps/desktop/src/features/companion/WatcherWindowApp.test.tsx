// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WatcherWindowApp } from "./WatcherWindowApp";
import type { EndOfDayReviewEvent } from "./EndOfDayReview";
import type { WatcherPeekEvent } from "./WatcherPeek";
import type { WatcherWindowEvent } from "./watcherBridge";

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
  listenToNativeWatcherShow: vi.fn().mockResolvedValue(vi.fn()),
  respondNativeWatcherPeek: vi.fn().mockResolvedValue(undefined),
  setNativeWatcherInteractive: vi.fn().mockResolvedValue(undefined),
  triggerNativeEndOfDayReviewAction: vi.fn().mockResolvedValue(undefined),
  showHandler: null as ((event: WatcherWindowEvent) => void) | null,
}));

vi.mock("./watcherBridge", () => ({
  dismissNativeWatcherPeek: bridge.dismissNativeWatcherPeek,
  listenToNativeWatcherShow: bridge.listenToNativeWatcherShow,
  respondNativeWatcherPeek: bridge.respondNativeWatcherPeek,
  setNativeWatcherInteractive: bridge.setNativeWatcherInteractive,
  triggerNativeEndOfDayReviewAction: bridge.triggerNativeEndOfDayReviewAction,
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

const endOfDayReviewEvent: EndOfDayReviewEvent = {
  kind: "endOfDayReview",
  placement: "top-right",
  day: "2026-05-20",
  generatedAt: "2026-05-20T18:05:00.000Z",
  trackedLabel: "2h 15m tracked",
  focusLabel: "1h 40m focus",
  driftLabel: "35m drift",
  totalSeconds: 8_100,
  focusSeconds: 6_000,
  driftSeconds: 2_100,
  topSource: {
    appName: "Code",
    sourceLabel: "Code",
    durationSeconds: 6_000,
  },
};

const passiveDriftEvent = buildEvent({
  id: 3,
  productivity: "drift",
  category: "entertainment",
  contextLabel: "Videos",
  durationLabel: "12m",
  durationSeconds: 12 * 60,
  driftPattern: "first",
});

describe("WatcherWindowApp", () => {
  afterEach(() => {
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
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherWindowEvent) => void) => {
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
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherWindowEvent) => void) => {
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
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherWindowEvent) => void) => {
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

  it("renders native end-of-day review events", async () => {
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherWindowEvent) => void) => {
      bridge.showHandler = handler;
      return vi.fn();
    });

    render(<WatcherWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.(endOfDayReviewEvent);
    });

    const review = screen.getByLabelText("Drifty end-of-day review");
    expect(review).toBeTruthy();
    expect(screen.queryByLabelText("Drifty watcher check-in")).toBeNull();
    expect(screen.queryByText("2h 15m tracked")).toBeNull();
    expect(screen.queryByText("Top app")).toBeNull();
    expect(screen.getByLabelText("Focus breakdown detail")).toBeTruthy();
    expect(screen.getByLabelText("Neutral breakdown detail")).toBeTruthy();
    expect(bridge.setNativeWatcherInteractive).toHaveBeenLastCalledWith(true);
  });

  it("sends typed native actions from end-of-day review buttons", async () => {
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherWindowEvent) => void) => {
      bridge.showHandler = handler;
      return vi.fn();
    });

    render(<WatcherWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.(endOfDayReviewEvent);
    });

    screen.getByRole("button", { name: /open dashboard/i }).click();
    screen.getByRole("button", { name: /view details/i }).click();
    screen.getByRole("button", { name: /review settings/i }).click();

    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenNthCalledWith(1, "openDashboard");
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenNthCalledWith(2, "viewDetails");
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenNthCalledWith(3, "openNotificationSettings");
  });

  it("dismisses the native end-of-day review from the close button", async () => {
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherWindowEvent) => void) => {
      bridge.showHandler = handler;
      return vi.fn();
    });

    render(<WatcherWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.(endOfDayReviewEvent);
    });

    act(() => {
      screen.getByRole("button", { name: "Close end-of-day review" }).click();
    });

    expect(bridge.dismissNativeWatcherPeek).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Drifty end-of-day review")).toBeNull();
  });
});
