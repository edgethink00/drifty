// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WatcherWindowApp } from "./WatcherWindowApp";
import type { ExtremeNudgeToastEvent } from "./extremeNudgeData";
import { EXTREME_NUDGE_TOAST_VISIBLE_MS } from "./extremeNudgeTiming";
import type { WatcherWindowEvent } from "./watcherBridge";

const bridge = vi.hoisted(() => ({
  hideNativeWatcherPeek: vi.fn().mockResolvedValue(undefined),
  listenToNativeWatcherShow: vi.fn().mockResolvedValue(vi.fn()),
  setNativeWatcherInteractive: vi.fn().mockResolvedValue(undefined),
  triggerNativeEndOfDayReviewAction: vi.fn().mockResolvedValue(undefined),
  triggerNativeExtremeNudgeAction: vi.fn().mockResolvedValue(undefined),
  showHandler: null as ((event: WatcherWindowEvent) => void) | null,
}));

vi.mock("./watcherBridge", () => ({
  hideNativeWatcherPeek: bridge.hideNativeWatcherPeek,
  listenToNativeWatcherShow: bridge.listenToNativeWatcherShow,
  setNativeWatcherInteractive: bridge.setNativeWatcherInteractive,
  triggerNativeEndOfDayReviewAction: bridge.triggerNativeEndOfDayReviewAction,
  notifyNativeEndOfDayReviewDisplayed: vi.fn().mockResolvedValue(undefined),
  triggerNativeExtremeNudgeAction: bridge.triggerNativeExtremeNudgeAction,
}));

const extremeNudgeToastEvent: ExtremeNudgeToastEvent = {
  kind: "extremeNudgeToast",
  placement: "top-right",
  id: "extreme-toast-1",
  generatedAt: new Date().toISOString(),
  title: "Removed youtube.com",
  closedLabel: "youtube.com",
  focusLabel: "docs.drifty.so",
  breakOptions: [5, 15, 30, 60],
};

async function renderExtremeNudge(): Promise<void> {
  vi.useFakeTimers();
  bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherWindowEvent) => void) => {
    bridge.showHandler = handler;
    return vi.fn();
  });
  render(<WatcherWindowApp />);
  await act(async () => undefined);
  act(() => {
    bridge.showHandler?.(extremeNudgeToastEvent);
  });
}

describe("WatcherWindowApp extreme nudge", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    bridge.showHandler = null;
    window.localStorage.clear();
    delete document.documentElement.dataset.surface;
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  it("renders the live automatic-close card instead of the retired toast", async () => {
    await renderExtremeNudge();
    expect(document.querySelector(".view--nudge")).toBeTruthy();
    expect(document.querySelector(".extreme-nudge-toast")).toBeNull();
    expect(screen.getByText("Removed youtube.com")).toBeTruthy();
    expect(screen.getByText("docs.drifty.so")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take a break" })).toBeTruthy();
    expect(bridge.setNativeWatcherInteractive).toHaveBeenLastCalledWith(true);
  });

  it("hides the watcher window after the live card auto-dismisses", async () => {
    await renderExtremeNudge();
    act(() => {
      vi.advanceTimersByTime(EXTREME_NUDGE_TOAST_VISIBLE_MS);
    });
    expect(bridge.hideNativeWatcherPeek).toHaveBeenCalled();
    expect(document.querySelector(".view--nudge")).toBeNull();
  });

  it("sends take-a-break actions from the live card", async () => {
    await renderExtremeNudge();
    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
    fireEvent.click(screen.getByRole("button", { name: "15m" }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(bridge.triggerNativeExtremeNudgeAction).toHaveBeenCalledWith(
      { type: "start_break", minutes: 15 },
      "extremeNudgeToast:extreme-toast-1",
    );
  });

  it("sends manual correction actions from the live card", async () => {
    await renderExtremeNudge();
    fireEvent.click(screen.getByRole("button", { name: "Not a drift" }));
    expect(bridge.triggerNativeExtremeNudgeAction).toHaveBeenCalledWith(
      { type: "manual_correction" },
      "extremeNudgeToast:extreme-toast-1",
    );
  });
});
