// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WatcherWindowApp } from "./WatcherWindowApp";
import type { ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
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
  triggerNativeExtremeNudgeAction: bridge.triggerNativeExtremeNudgeAction,
}));

const extremeNudgeToastEvent: ExtremeNudgeToastEvent = {
  kind: "extremeNudgeToast",
  placement: "top-right",
  id: "extreme-toast-1",
  generatedAt: "2026-05-20T13:16:20.000Z",
  title: "Removed youtube.com",
  closedLabel: "youtube.com",
  focusLabel: "docs.drifty.so",
  breakOptions: [5, 15, 30, 60],
};

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

    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Removed youtube.com");
    expect(toast.textContent).toContain("Focus switched to docs.drifty.so");
    expect(screen.getByRole("button", { name: "Take a break" })).toBeTruthy();
    expect(bridge.setNativeWatcherInteractive).toHaveBeenLastCalledWith(true);
    expect(toast.getAttribute("data-phase")).toBe("visible");

    act(() => {
      vi.advanceTimersByTime(7_999);
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

    const toast = screen.getByRole("status");
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
      vi.advanceTimersByTime(3_999);
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

  it("pauses extreme nudge toast dismissal while the mouse is hovered", async () => {
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

    const toast = screen.getByRole("status");
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
      vi.advanceTimersByTime(3_999);
    });
    expect(toast.getAttribute("data-phase")).toBe("visible");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast.getAttribute("data-phase")).toBe("leaving");
  });

  it("does not keep the timer paused after mouse-created focus leaves the toast", async () => {
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

    const toast = screen.getByRole("status");
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
      vi.advanceTimersByTime(5_999);
    });
    expect(toast.getAttribute("data-phase")).toBe("visible");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toast.getAttribute("data-phase")).toBe("leaving");
  });

  it("sends take-a-break actions from extreme nudge toasts", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
    fireEvent.click(screen.getByRole("button", { name: "15m" }));
    expect(screen.getByRole("status", { name: "Starting break" })).toBeTruthy();
    expect(bridge.triggerNativeExtremeNudgeAction).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(bridge.triggerNativeExtremeNudgeAction).toHaveBeenCalledWith({ type: "start_break", minutes: 15 });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
