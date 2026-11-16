import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getFeedbackTrackerStatus } from "./trackerClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("does not call IPC outside the desktop runtime", async () => {
  expect(await getFeedbackTrackerStatus()).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("uses the dedicated read and normalizes native status without the live status command", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.mocked(invoke).mockResolvedValue({ isRunning: true, trackerMode: "idle", idleSeconds: 181, idleDetectionAvailable: true });
  expect(await getFeedbackTrackerStatus()).toMatchObject({ running: true, trackerMode: "idle", idleSeconds: 181 });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("feedback_diagnostics_get_tracker_status");
});

it("propagates the bounded failure without falling back to the live control queue", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.mocked(invoke).mockRejectedValue("feedback_tracker_status_timeout");
  await expect(getFeedbackTrackerStatus()).rejects.toBe("feedback_tracker_status_timeout");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("feedback_diagnostics_get_tracker_status");
});
