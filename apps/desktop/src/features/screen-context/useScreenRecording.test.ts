// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ScreenCapturePreferences } from "@drifty/domain";
import { ScreenContextClient, type ScreenContextInvoke } from "./screenContextClient";
import { renderHook, waitFor } from "@testing-library/react";
import { turnOnScreenRecordingAfterTrackingStarts, useScreenRecordingStartup } from "./useScreenRecording";
import { screenRecordingUsed } from "./screenRecordingSignals";

const LEASE = "a9db1b29-80fb-4104-9272-46e0845a4774";
const clients: ScreenContextClient[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.dispose()); screenRecordingUsed.set(false); window.localStorage.clear(); });

/** What pressing Drifty's own Allow leaves behind before macOS relaunches the app. */
function pressedAllowBefore() { window.localStorage.setItem("drifty.screenRecording.requested", "1"); }

function fixture(notReadyTimes: number, initial: Partial<ScreenCapturePreferences> = {}, native: { granted?: boolean; configured?: boolean } = {}) {
  let preferences: ScreenCapturePreferences = { enabled: false, replayEnabled: false, visibleTextEnabled: false, ocrEnabled: false, allowedApps: [], intervalSeconds: 10, ...initial };
  let refusals = notReadyTimes;
  const status = () => ({ preferences, preferencesInvalid: false, captureEnabled: preferences.enabled, helperInstalled: true, globalPaused: false,
    ocrSupported: true, supportedApps: [{ id: "textedit", name: "TextEdit" }], paused: false, running: false, preparing: false,
    accepted: 0, dropped: 0, lastFailure: null, lastAcceptedAtMs: null });
  const invoke = vi.fn<ScreenContextInvoke>(async (command, args) => {
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") return { leaseId: LEASE, value: { mode: "local", expiresAtMs: Date.now() + 900_000 } };
    if (command === "screen_context_get_status") return { leaseId: LEASE, value: status() };
    if (command === "screen_context_permission_status") return { granted: native.granted ?? false };
    if (command === "screen_context_was_configured") return native.configured ?? false;
    if (command === "screen_context_configure") {
      if (refusals > 0) { refusals -= 1; throw "screen_context_tracker_not_ready"; }
      preferences = args?.preferences as ScreenCapturePreferences;
      return { leaseId: LEASE, value: status() };
    }
    throw new Error("unexpected command " + command);
  });
  const client = new ScreenContextClient(invoke, true); client.setAccount(null); clients.push(client);
  return { client, invoke, preferences: () => preferences };
}

it("saves the onboarding choice once the tracker is ready, retrying a not-ready start", async () => {
  const { client, invoke, preferences } = fixture(2);
  await turnOnScreenRecordingAfterTrackingStarts(client, 5, 1);
  expect(invoke.mock.calls.filter(([command]) => command === "screen_context_configure")).toHaveLength(3);
  expect(invoke.mock.calls.filter(([command]) => command === "screen_context_configure").slice(-1)[0]?.[1]).toMatchObject({ resume: true });
  expect(preferences()).toMatchObject({ enabled: true, replayEnabled: true, visibleTextEnabled: true, ocrEnabled: false, allowedApps: ["textedit"] });
});

it("gives up quietly when tracking never becomes ready, leaving recording off", async () => {
  const { client, preferences } = fixture(10);
  await turnOnScreenRecordingAfterTrackingStarts(client, 3, 1);
  expect(preferences().enabled).toBe(false);
});

it("leaves recording that is already on as it is", async () => {
  const { client, invoke } = fixture(0, { enabled: true, replayEnabled: true, allowedApps: ["textedit"] });
  await turnOnScreenRecordingAfterTrackingStarts(client, 3, 1);
  expect(invoke.mock.calls.some(([command]) => command === "screen_context_configure")).toBe(false);
});

it("turns recording on at startup after Drifty's Allow when macOS now allows it and it was never set up", async () => {
  pressedAllowBefore();
  const { client, preferences } = fixture(0, {}, { granted: true, configured: false });
  renderHook(() => useScreenRecordingStartup(client, { mac: true, trackingRunning: true }));
  await waitFor(() => expect(preferences().enabled).toBe(true));
  expect(screenRecordingUsed.get()).toBe(true);
  // The press is spent once recording is on.
  expect(window.localStorage.getItem("drifty.screenRecording.requested")).toBeNull();
});

it("leaves recording off after an update when macOS allowed it before Drifty ever asked", async () => {
  const { client, invoke } = fixture(0, {}, { granted: true, configured: false });
  renderHook(() => useScreenRecordingStartup(client, { mac: true, trackingRunning: true }));
  await waitFor(() => expect(invoke.mock.calls.some(([command]) => command === "screen_context_permission_status")).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(invoke.mock.calls.some(([command]) => command === "screen_context_configure")).toBe(false);
  expect(screenRecordingUsed.get()).toBe(false);
});

it("leaves recording off when it was turned on once before, even with the permission still granted", async () => {
  pressedAllowBefore();
  const { client, invoke } = fixture(0, {}, { granted: true, configured: true });
  renderHook(() => useScreenRecordingStartup(client, { mac: true, trackingRunning: true }));
  await waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === "screen_context_was_configured").length).toBeGreaterThan(1));
  expect(invoke.mock.calls.some(([command]) => command === "screen_context_configure")).toBe(false);
  expect(screenRecordingUsed.get()).toBe(true);
});

it("does nothing without the permission, before tracking runs or on Windows", async () => {
  pressedAllowBefore();
  for (const [granted, mac, trackingRunning] of [[false, true, true], [true, true, false], [true, false, true]] as const) {
    const { client, invoke } = fixture(0, {}, { granted, configured: false });
    const view = renderHook(() => useScreenRecordingStartup(client, { mac, trackingRunning }));
    await waitFor(() => expect(invoke.mock.calls.some(([command]) => command === "screen_context_was_configured")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke.mock.calls.some(([command]) => command === "screen_context_configure")).toBe(false);
    view.unmount();
  }
});
