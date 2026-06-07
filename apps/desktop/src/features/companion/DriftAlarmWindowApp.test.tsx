// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriftAlarmWindowApp } from "./DriftAlarmWindowApp";
import type { DriftAlarmEvent } from "./DriftAlarm";

const bridge = vi.hoisted(() => ({
  callOrder: [] as string[],
  currentPayload: null as DriftAlarmEvent | null,
  dismissNativeDriftAlarm: vi.fn().mockResolvedValue(undefined),
  getNativeDriftAlarmCurrent: vi.fn().mockImplementation(async () => {
    bridge.callOrder.push("current");
    return bridge.currentPayload;
  }),
  listenToNativeDriftAlarmShow: vi.fn().mockImplementation(async (_handler: (event: DriftAlarmEvent) => void) => {
    bridge.callOrder.push("listen:start");
    await Promise.resolve();
    bridge.callOrder.push("listen:resolved");
    return vi.fn();
  }),
  triggerNativeDriftAlarmAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./driftAlarmBridge", () => ({
  dismissNativeDriftAlarm: bridge.dismissNativeDriftAlarm,
  getNativeDriftAlarmCurrent: bridge.getNativeDriftAlarmCurrent,
  listenToNativeDriftAlarmShow: bridge.listenToNativeDriftAlarmShow,
  triggerNativeDriftAlarmAction: bridge.triggerNativeDriftAlarmAction,
}));

function event(overrides: Partial<DriftAlarmEvent> = {}): DriftAlarmEvent {
  return {
    id: "alarm-1",
    contextLabel: "youtube.com",
    driftDurationLabel: "2m",
    driftDurationSeconds: 2 * 60,
    preservedFocusStrikeLabel: "32-minute",
    preservedFocusStrikeSeconds: 32 * 60,
    generatedAt: "2026-05-20T13:16:00.000Z",
    breakOptions: [5, 15, 30, 60],
    focusTargets: [
      {
        targetId: "app:com.microsoft.VSCode",
        label: "Visual Studio Code",
        detail: "Recent focus app",
        appName: "Visual Studio Code",
        bundleId: "com.microsoft.VSCode",
        siteDomain: null,
        siteTitle: null,
        iconSrc: null,
      },
    ],
    ...overrides,
  };
}

describe("DriftAlarmWindowApp", () => {
  afterEach(() => {
    vi.clearAllMocks();
    bridge.callOrder = [];
    bridge.currentPayload = null;
    delete document.documentElement.dataset.surface;
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
    window.localStorage.clear();
  });

  it("replays the current native payload after listener registration", async () => {
    bridge.currentPayload = event();
    window.localStorage.setItem("drifty.theme", "light");

    const { container } = render(<DriftAlarmWindowApp />);
    await act(async () => undefined);

    expect(document.documentElement.dataset.surface).toBe("drift-alarm");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(bridge.callOrder).toEqual(["listen:start", "listen:resolved", "current"]);
    const alarm = screen.getByRole("alertdialog", { name: "Drift detected" });
    expect(alarm.getAttribute("aria-modal")).toBe("true");
    expect(alarm.getAttribute("aria-labelledby")).toBe("drift-alarm-title");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /visual studio code/i })));
    const main = screen.getByRole("main", { name: "Drifty drift alarm window" });
    expect(main.classList.contains("drift-alarm-window-surface")).toBe(true);
    expect(container.querySelector(".drift-alarm-backdrop")).toBeTruthy();
    expect(container.querySelector(".drift-alarm-overlay")).toBeTruthy();
    expect(container.querySelector(".da")).toBeTruthy();
    expect(container.querySelector(".watcher-peek--top-right")).toBeNull();
    expect(screen.getByText(/drift detected/i)).toBeTruthy();
    expect(screen.getByText(/latest focus/i)).toBeTruthy();
    expect(screen.getAllByText(/visual studio code/i).length).toBeGreaterThan(0);
  });

  it("sends clicked actions without echoing native action events", async () => {
    bridge.currentPayload = event();

    render(<DriftAlarmWindowApp />);
    await act(async () => undefined);

    fireEvent.click(screen.getByRole("button", { name: /visual studio code/i }));
    expect(bridge.triggerNativeDriftAlarmAction).toHaveBeenCalledWith({ type: "return_to_focus", targetId: "app:com.microsoft.VSCode" });
    expect(bridge.triggerNativeDriftAlarmAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Drift detected" })).toBeNull());
  });

  it("dismisses the native alarm webview surface on Escape", async () => {
    bridge.currentPayload = event();

    render(<DriftAlarmWindowApp />);
    await act(async () => undefined);

    const alarm = screen.getByRole("alertdialog", { name: "Drift detected" });
    fireEvent.keyDown(alarm, { key: "Escape" });

    expect(bridge.dismissNativeDriftAlarm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Drift detected" })).toBeNull());
  });

  it("dismisses the native alarm webview surface from the chrome X button", async () => {
    bridge.currentPayload = event();

    render(<DriftAlarmWindowApp />);
    await act(async () => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss drift alarm" }));

    expect(bridge.dismissNativeDriftAlarm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Drift detected" })).toBeNull());
  });
});
