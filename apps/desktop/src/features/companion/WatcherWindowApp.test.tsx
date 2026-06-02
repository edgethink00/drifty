// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WatcherWindowApp } from "./WatcherWindowApp";
import type { WatcherPeekEvent } from "./WatcherPeek";

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
  showHandler: null as ((event: WatcherPeekEvent) => void) | null,
}));

vi.mock("./watcherBridge", () => ({
  dismissNativeWatcherPeek: bridge.dismissNativeWatcherPeek,
  listenToNativeWatcherShow: bridge.listenToNativeWatcherShow,
  respondNativeWatcherPeek: bridge.respondNativeWatcherPeek,
  setNativeWatcherInteractive: bridge.setNativeWatcherInteractive,
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

describe("WatcherWindowApp", () => {
  afterEach(() => {
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
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherPeekEvent) => void) => {
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

  it("keeps focused encouragement non-interactive", async () => {
    vi.useFakeTimers();
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherPeekEvent) => void) => {
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
});
