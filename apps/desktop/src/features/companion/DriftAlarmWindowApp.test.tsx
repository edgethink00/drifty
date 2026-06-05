// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
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

    render(<DriftAlarmWindowApp />);
    await act(async () => undefined);

    expect(document.documentElement.dataset.surface).toBe("drift-alarm");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(bridge.callOrder).toEqual(["listen:start", "listen:resolved", "current"]);
    expect(screen.getByLabelText("Drifty drift alarm")).toBeTruthy();
    expect(screen.getByRole("main", { name: "Drifty drift alarm window" }).classList.contains("watcher-window-surface--drift-alarm")).toBe(true);
    expect(screen.getByText(/your 32-minute focus flame is still alive/i)).toBeTruthy();
  });

  it("sends clicked actions without echoing native action events", async () => {
    bridge.currentPayload = event();

    render(<DriftAlarmWindowApp />);
    await act(async () => undefined);

    fireEvent.click(screen.getByRole("button", { name: /visual studio code/i }));
    expect(bridge.triggerNativeDriftAlarmAction).toHaveBeenCalledWith({ type: "return_to_focus", targetId: "app:com.microsoft.VSCode" });
    expect(bridge.triggerNativeDriftAlarmAction).toHaveBeenCalledTimes(1);
  });
});
