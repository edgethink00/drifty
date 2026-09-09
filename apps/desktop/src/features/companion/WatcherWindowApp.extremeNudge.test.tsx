// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WatcherWindowApp } from "./WatcherWindowApp";
import type { ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import { DRIFT_ALARM_CORRECTION_FEEDBACK_DURATION_MS } from "./driftAlarmEvent";
import { EXTREME_NUDGE_TOAST_VISIBLE_MS } from "./extremeNudgeTiming";
import type { WatcherWindowEvent } from "./watcherBridge";

const bridge = vi.hoisted(() => ({
  dismissNativeWatcherPeek: vi.fn().mockResolvedValue(undefined),
  hideNativeWatcherPeek: vi.fn().mockResolvedValue(undefined),
  isNativeWatcherCursorInside: vi.fn().mockResolvedValue(null),
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
  isNativeWatcherCursorInside: bridge.isNativeWatcherCursorInside,
  listenToNativeWatcherShow: bridge.listenToNativeWatcherShow,
  respondNativeWatcherPeek: bridge.respondNativeWatcherPeek,
  setNativeWatcherInteractive: bridge.setNativeWatcherInteractive,
  triggerNativeEndOfDayReviewAction: bridge.triggerNativeEndOfDayReviewAction,
  notifyNativeEndOfDayReviewDisplayed: vi.fn().mockResolvedValue(undefined),
  triggerNativeExtremeNudgeAction: bridge.triggerNativeExtremeNudgeAction,
}));

const extremeNudgeToastEvent: ExtremeNudgeToastEvent = {
  kind: "extremeNudgeToast",
  placement: "top-right",
  id: "extreme-toast-1",
  // Fresh build time: moments older than the staleness window are consumed
  // silently, so fixtures must read as "just fired".
  generatedAt: new Date().toISOString(),
  title: "Removed youtube.com",
  closedLabel: "youtube.com",
  focusLabel: "docs.drifty.so",
  breakOptions: [5, 15, 30, 60],
};

async function renderExtremeNudgeToast(): Promise<HTMLElement> {
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
  return screen.getByRole("status");
}

describe("WatcherWindowApp extreme nudge toast", () => {
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

  it("renders extreme nudge toasts and hides the watcher window after the exit animation", async () => {
    const toast = await renderExtremeNudgeToast();
    expect(toast.textContent).toContain("Removed youtube.com");
    expect(toast.textContent).toContain("Focus switched to docs.drifty.so");
    expect(screen.getByRole("button", { name: "Take a break" })).toBeTruthy();
    expect(bridge.setNativeWatcherInteractive).toHaveBeenLastCalledWith(true);
    expect(toast.getAttribute("data-phase")).toBe("visible");
    expect(toast.style.getPropertyValue("--extreme-toast-visible-duration")).toBe(
      `${EXTREME_NUDGE_TOAST_VISIBLE_MS}ms`,
    );

    act(() => {
      vi.advanceTimersByTime(EXTREME_NUDGE_TOAST_VISIBLE_MS - 1);
    });
    expect(toast.getAttribute("data-phase")).toBe("visible");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast.getAttribute("data-phase")).toBe("leaving");

    act(() => {
      vi.advanceTimersByTime(280);
    });
    expect(bridge.hideNativeWatcherPeek).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("pauses extreme nudge toast dismissal while the pointer is inside", async () => {
    const toast = await renderExtremeNudgeToast();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    fireEvent.pointerEnter(toast);
    expect(toast.getAttribute("data-timer-paused")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(toast.getAttribute("data-phase")).toBe("visible");
    expect(bridge.hideNativeWatcherPeek).not.toHaveBeenCalled();

    fireEvent.pointerLeave(toast);
    act(() => {
      vi.advanceTimersByTime(EXTREME_NUDGE_TOAST_VISIBLE_MS - 4_000 - 1);
    });
    expect(toast.getAttribute("data-phase")).toBe("visible");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast.getAttribute("data-phase")).toBe("leaving");

    act(() => {
      vi.advanceTimersByTime(280);
    });
    expect(bridge.hideNativeWatcherPeek).toHaveBeenCalledTimes(1);
  });

  it("recovers extreme nudge toast dismissal when the pointer leave event is missed and the native cursor is outside", async () => {
    bridge.isNativeWatcherCursorInside.mockResolvedValue(false);
    const toast = await renderExtremeNudgeToast();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    fireEvent.pointerEnter(toast);
    expect(toast.getAttribute("data-timer-paused")).toBe("true");

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(EXTREME_NUDGE_TOAST_VISIBLE_MS - 4_000 - 1);
    });
    expect(toast.getAttribute("data-phase")).toBe("visible");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast.getAttribute("data-phase")).toBe("leaving");

    act(() => {
      vi.advanceTimersByTime(280);
    });
    expect(bridge.hideNativeWatcherPeek).toHaveBeenCalledTimes(1);
    expect(bridge.isNativeWatcherCursorInside).toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps extreme nudge toast visible when the pointer leave event is missed and the native cursor is inside", async () => {
    bridge.isNativeWatcherCursorInside.mockResolvedValue(true);
    const toast = await renderExtremeNudgeToast();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    fireEvent.mouseEnter(toast);
    expect(toast.getAttribute("data-timer-paused")).toBe("true");

    await act(async () => {
      vi.advanceTimersByTime(8_500);
      await Promise.resolve();
    });

    expect(bridge.isNativeWatcherCursorInside).toHaveBeenCalled();
    expect(toast.getAttribute("data-phase")).toBe("visible");
    expect(bridge.hideNativeWatcherPeek).not.toHaveBeenCalled();
  });

  it("pauses extreme nudge toast dismissal while the mouse is hovered", async () => {
    const toast = await renderExtremeNudgeToast();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    fireEvent.mouseEnter(toast);
    expect(toast.getAttribute("data-timer-paused")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(toast.getAttribute("data-phase")).toBe("visible");
    expect(bridge.hideNativeWatcherPeek).not.toHaveBeenCalled();

    fireEvent.mouseLeave(toast);
    expect(toast.hasAttribute("data-timer-paused")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(EXTREME_NUDGE_TOAST_VISIBLE_MS - 4_000 - 1);
    });
    expect(toast.getAttribute("data-phase")).toBe("visible");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast.getAttribute("data-phase")).toBe("leaving");
  });

  it("does not keep the timer paused after mouse-created focus leaves the toast", async () => {
    const toast = await renderExtremeNudgeToast();
    const breakTrigger = screen.getByRole("button", { name: "Take a break" });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    fireEvent.mouseEnter(toast);
    fireEvent.mouseDown(breakTrigger);
    fireEvent.focus(breakTrigger);
    expect(toast.getAttribute("data-timer-paused")).toBe("true");

    fireEvent.mouseLeave(toast);
    expect(toast.hasAttribute("data-timer-paused")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(EXTREME_NUDGE_TOAST_VISIBLE_MS - 2_000 - 1);
    });
    expect(toast.getAttribute("data-phase")).toBe("visible");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast.getAttribute("data-phase")).toBe("leaving");
  });

  it("sends take-a-break actions from extreme nudge toasts", async () => {
    await renderExtremeNudgeToast();

    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
    fireEvent.click(screen.getByRole("button", { name: "15m" }));
    expect(screen.getByRole("status", { name: "Starting break" })).toBeTruthy();
    expect(bridge.triggerNativeExtremeNudgeAction).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(bridge.triggerNativeExtremeNudgeAction).toHaveBeenCalledWith({ type: "start_break", minutes: 15 }, "extremeNudgeToast:extreme-toast-1");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends manual correction actions from extreme nudge toasts", async () => {
    await renderExtremeNudgeToast();

    fireEvent.click(screen.getByRole("button", { name: "Not a drift" }));

    expect(bridge.triggerNativeExtremeNudgeAction).toHaveBeenCalledWith({ type: "manual_correction" }, "extremeNudgeToast:extreme-toast-1");
    expect(screen.getByRole("status").textContent).toContain("Learning signal added");
    expect(screen.getByRole("status").textContent).toContain("Similar decisions will now weigh this as not drift.");
    expect(screen.queryByRole("button", { name: "Not a drift" })).toBeNull();
  });

  it("updates the same extreme nudge toast with one learning acknowledgement and then closes it", async () => {
    await renderExtremeNudgeToast();

    act(() => {
      bridge.showHandler?.({ ...extremeNudgeToastEvent, correctionStatus: "acknowledged" });
    });

    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Learning signal added");
    expect(toast.textContent).toContain("Similar decisions will now weigh this as not drift.");
    expect(toast.querySelector(".extreme-nudge-toast__eyebrow")).toBeNull();
    expect(toast.style.getPropertyValue("--extreme-toast-visible-duration")).toBe(
      `${DRIFT_ALARM_CORRECTION_FEEDBACK_DURATION_MS}ms`,
    );
    fireEvent.pointerEnter(toast);
    expect(toast.hasAttribute("data-timer-paused")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(DRIFT_ALARM_CORRECTION_FEEDBACK_DURATION_MS + 280);
    });
    expect(bridge.hideNativeWatcherPeek).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).toBeNull();
  });

});
