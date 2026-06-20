// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndOfDayReviewEvent } from "./EndOfDayReview";
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
  triggerNativeExtremeNudgeAction: bridge.triggerNativeExtremeNudgeAction,
}));

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

describe("WatcherWindowApp end-of-day review", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    bridge.showHandler = null;
    window.localStorage.clear();
    delete document.documentElement.dataset.surface;
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
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
    expect(within(review).getByText("Summary - Today")).toBeTruthy();
    expect(within(review).queryByText("Evening review")).toBeNull();
    expect(within(review).getAllByText("2h 15m").length).toBeGreaterThan(0);
    expect(within(review).getByLabelText("Focus and drift summary")).toBeTruthy();
    expect(within(review).getByLabelText("End-of-day review tables")).toBeTruthy();
    expect(within(review).getByLabelText("Most used apps")).toBeTruthy();
    expect(screen.getByLabelText("Focus breakdown detail")).toBeTruthy();
    expect(screen.getByLabelText("Neutral breakdown detail")).toBeTruthy();
    expect(bridge.setNativeWatcherInteractive).toHaveBeenLastCalledWith(true);
  });

  it("keeps end-of-day review visible when native interactivity enablement rejects", async () => {
    bridge.setNativeWatcherInteractive.mockRejectedValueOnce(new Error("notification.is_permission_granted not allowed on window \"watcher-peek\""));
    bridge.listenToNativeWatcherShow.mockImplementation(async (handler: (event: WatcherWindowEvent) => void) => {
      bridge.showHandler = handler;
      return vi.fn();
    });

    render(<WatcherWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.showHandler?.(endOfDayReviewEvent);
    });
    await act(async () => undefined);

    expect(screen.getByLabelText("Drifty end-of-day review")).toBeTruthy();
    expect(screen.getByText("Summary - Today")).toBeTruthy();
    expect(screen.getByLabelText("End-of-day review tables")).toBeTruthy();
    expect(screen.getByLabelText("Category breakdown")).toBeTruthy();
    expect(screen.getByLabelText("Most used apps")).toBeTruthy();
    expect(screen.queryByLabelText("Drifty watcher check-in")).toBeNull();
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
    screen.getByRole("button", { name: /review settings/i }).click();

    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenNthCalledWith(1, "openDashboard");
    expect(screen.queryByRole("button", { name: /view details/i })).toBeNull();
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenNthCalledWith(2, "openNotificationSettings");
  });

  it("keeps end-of-day review visible when native review actions reject", async () => {
    bridge.triggerNativeEndOfDayReviewAction.mockRejectedValueOnce(new Error("notification.is_permission_granted not allowed on window \"watcher-peek\""));
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
      screen.getByRole("button", { name: /open dashboard/i }).click();
    });
    await act(async () => undefined);

    expect(screen.getByLabelText("Drifty end-of-day review")).toBeTruthy();
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith("openDashboard");
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
