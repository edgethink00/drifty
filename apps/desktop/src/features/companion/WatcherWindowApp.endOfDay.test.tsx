// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";
import { WatcherWindowApp } from "./WatcherWindowApp";
import type { WatcherWindowEvent } from "./watcherBridge";

const bridge = vi.hoisted(() => ({
  dismissNativeWatcherPeek: vi.fn().mockResolvedValue(undefined),
  hideNativeWatcherPeek: vi.fn().mockResolvedValue(undefined),
  listenToNativeWatcherShow: vi.fn().mockResolvedValue(vi.fn()),
  respondNativeWatcherPeek: vi.fn().mockResolvedValue(undefined),
  setNativeWatcherInteractive: vi.fn().mockResolvedValue(undefined),
  triggerNativeEndOfDayReviewAction: vi.fn().mockResolvedValue(undefined),
  triggerNativeExtremeNudgeAction: vi.fn().mockResolvedValue(undefined),
  showHandler: null as ((event: WatcherWindowEvent) => void) | null,
}));

vi.mock("./watcherBridge", () => ({
  dismissNativeWatcherPeek: bridge.dismissNativeWatcherPeek,
  hideNativeWatcherPeek: bridge.hideNativeWatcherPeek,
  listenToNativeWatcherShow: bridge.listenToNativeWatcherShow,
  respondNativeWatcherPeek: bridge.respondNativeWatcherPeek,
  setNativeWatcherInteractive: bridge.setNativeWatcherInteractive,
  triggerNativeEndOfDayReviewAction: bridge.triggerNativeEndOfDayReviewAction,
  notifyNativeEndOfDayReviewDisplayed: vi.fn().mockResolvedValue(undefined),
  triggerNativeExtremeNudgeAction: bridge.triggerNativeExtremeNudgeAction,
}));

const endOfDayReviewEvent: EndOfDayReviewEvent = {
  kind: "endOfDayReview",
  placement: "top-right",
  day: "2026-05-20",
  // Fresh build time: moments older than the staleness window are consumed
  // silently, so fixtures must read as "just fired".
  generatedAt: new Date().toISOString(),
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

describe("WatcherWindowApp Day Review isolation", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    bridge.showHandler = null;
    window.localStorage.clear();
    delete document.documentElement.dataset.surface;
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  it("ignores a legacy-routed Day Review payload", async () => {
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherWindowEvent) => void) => {
      bridge.showHandler = handler;
      return vi.fn();
    });

    render(<WatcherWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.(endOfDayReviewEvent);
    });

    expect(screen.queryByLabelText("Drifty end-of-day review")).toBeNull();
    expect(screen.queryByText("Summary - Today")).toBeNull();
    expect(screen.queryByLabelText("Drifty watcher check-in")).toBeNull();
    expect(bridge.setNativeWatcherInteractive).not.toHaveBeenCalledWith(true);
    expect(bridge.triggerNativeEndOfDayReviewAction).not.toHaveBeenCalled();
  });
});
