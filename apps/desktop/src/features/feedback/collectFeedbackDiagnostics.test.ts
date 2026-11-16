import { afterEach, describe, expect, it, vi } from "vitest";
import { collectFeedbackDiagnostics, feedbackProbe, FEEDBACK_PROBE_TIMEOUT_MS, type FeedbackDiagnosticsAppState } from "./collectFeedbackDiagnostics";
import { getNativeFeedbackDiagnostics } from "../../lib/api/feedbackDiagnosticsClient";
import { getFeedbackTrackerStatus } from "../../lib/api/trackerClient";
vi.mock("../../lib/api/trackerClient", () => ({ getFeedbackTrackerStatus: vi.fn() }));
vi.mock("../../lib/api/feedbackDiagnosticsClient", () => ({ getNativeFeedbackDiagnostics: vi.fn() }));
vi.mock("../../lib/api/startupSettingsClient", () => ({ startupSettingsClient: { isAvailable: () => false } }));
vi.mock("../companion/interventionLedger", () => ({ buildInterventionLedgerDebugInput: () => ({ last7Days: {}, last30Days: {} }) }));
vi.mock("./feedbackDiagnostics", () => ({ buildFeedbackDiagnostics: (value: unknown) => value }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe("bounded independent feedback collection", () => {
  it.each([2_100, 3_500])("collects a healthy Windows status taking %d ms while other probes keep their shorter budget", async (delayMs) => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const status = { running: true, accessibilityGranted: true };
    vi.mocked(getFeedbackTrackerStatus).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(status), delayMs)));
    vi.mocked(getNativeFeedbackDiagnostics).mockImplementation(() => new Promise(() => {}));
    const collect = collectFeedbackDiagnostics({ app: { version: "1.21.1", platform: "windows" }, aiSetup: null } as FeedbackDiagnosticsAppState);
    await vi.advanceTimersByTimeAsync(delayMs);
    expect(await collect).toMatchObject({ tracker: { status, statusSource: "fresh" }, collection: { tracker: "collected", native: "timeout" } });
  });
  it("bounds a hung Windows tracker without extending its renderer wait to the form's five-second cutoff", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    let finish!: (status: { running: boolean; accessibilityGranted: boolean }) => void;
    vi.mocked(getFeedbackTrackerStatus).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    vi.mocked(getNativeFeedbackDiagnostics).mockResolvedValue(null);
    let settled = false;
    const collect = collectFeedbackDiagnostics({ app: { version: "1.21.1", platform: "windows" }, aiSetup: null } as FeedbackDiagnosticsAppState).then(value => { settled = true; return value; });
    try {
      await vi.advanceTimersByTimeAsync(1_200);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await collect).toMatchObject({ tracker: { status: null }, collection: { tracker: "timeout" } });
    } finally {
      finish({ running: true, accessibilityGranted: true });
      await vi.advanceTimersByTimeAsync(0);
    }
  });
  it("retains a native child timeout as timeout without copying its error into the report", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(getFeedbackTrackerStatus).mockRejectedValue("feedback_tracker_status_timeout");
    vi.mocked(getNativeFeedbackDiagnostics).mockResolvedValue(null);
    const result = await collectFeedbackDiagnostics({ app: { version: "1.21.1" }, aiSetup: null } as FeedbackDiagnosticsAppState);
    expect(result).toMatchObject({ tracker: { status: null, statusSource: "unavailable" }, collection: { tracker: "timeout" } });
    expect(JSON.stringify(result)).not.toContain("feedback_tracker_status_timeout");
  });
  it("retains app state and other diagnostics when one native request never finishes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(getFeedbackTrackerStatus).mockResolvedValue({ running: true, accessibilityGranted: true });
    vi.mocked(getNativeFeedbackDiagnostics).mockImplementation(() => new Promise(() => {}));
    const collect = collectFeedbackDiagnostics({ app: { version: "1.20.0" }, aiSetup: null } as FeedbackDiagnosticsAppState);
    await vi.advanceTimersByTimeAsync(FEEDBACK_PROBE_TIMEOUT_MS);
    expect(await collect).toMatchObject({ app: { version: "1.20.0" }, native: null,
      collection: { native: "timeout", installLocation: "unsupported", screen: "unsupported", memory: "unsupported" },
      recentEvents: [], operations: [] });
  });
  it("labels browser placeholders unsupported without invoking native collection", async () => {
    const status = { running: false, accessibilityGranted: false, trackerMode: "unavailable" };
    const result = await collectFeedbackDiagnostics({ app: { version: "1.21.1" }, aiSetup: null,
      tracker: { status, accessibilityGranted: false, accessibilityRequired: true } } as FeedbackDiagnosticsAppState);
    expect(result).toMatchObject({ app: { runtime: "browser" }, tracker: { status: null, cachedStatus: status,
      statusSource: "unsupported" }, collection: { tracker: "unsupported", native: "unsupported" } });
    expect(getFeedbackTrackerStatus).not.toHaveBeenCalled();
    expect(getNativeFeedbackDiagnostics).not.toHaveBeenCalled();
  });

  it("refreshes stale UI status even when the optional native diagnostics call fails", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(getNativeFeedbackDiagnostics).mockRejectedValue(new Error("private path"));
    const fresh = { running: true, trackerMode: "tracking", idleDetectionAvailable: true,
      idleSeconds: 0.4, accessibilityGranted: true };
    vi.mocked(getFeedbackTrackerStatus).mockResolvedValue(fresh);
    const stale = { running: false, trackerMode: "idle", accessibilityGranted: false };
    const result = await collectFeedbackDiagnostics({ app: { version: "1.21.1" }, aiSetup: null,
      tracker: { status: stale, accessibilityGranted: false, accessibilityRequired: true } } as FeedbackDiagnosticsAppState);
    expect(result).toMatchObject({ app: { runtime: "desktop" }, tracker: { status: fresh, cachedStatus: stale,
      accessibilityGranted: true, statusSource: "fresh" }, collection: { tracker: "collected", native: "failed" } });
  });

  it("retains the real native unavailable/database-failure response instead of dropping its cause", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(getNativeFeedbackDiagnostics).mockResolvedValue(null);
    const status = { running: false, trackerMode: "unavailable", accessibilityGranted: false,
      statusIssue: "databaseUnavailable" as const };
    vi.mocked(getFeedbackTrackerStatus).mockResolvedValue(status);
    const result = await collectFeedbackDiagnostics({ app: { version: "1.21.1" }, aiSetup: null,
      tracker: { status: null, accessibilityGranted: false, accessibilityRequired: true } } as FeedbackDiagnosticsAppState);
    expect(result).toMatchObject({ tracker: { status, statusSource: "fresh" }, collection: { tracker: "collected" } });
  });

  it("retains a bounded tracker timeout without promoting the cached status to a fresh observation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(getNativeFeedbackDiagnostics).mockResolvedValue(null);
    let finish: (value: { running: boolean; accessibilityGranted: boolean }) => void = () => {};
    vi.mocked(getFeedbackTrackerStatus).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const status = { running: true, accessibilityGranted: true };
    const pending = collectFeedbackDiagnostics({ app: { version: "1.21.1" }, aiSetup: null,
      tracker: { status, accessibilityGranted: true, accessibilityRequired: true } } as FeedbackDiagnosticsAppState);
    await vi.advanceTimersByTimeAsync(FEEDBACK_PROBE_TIMEOUT_MS);
    const result = await pending;
    expect(result).toMatchObject({ tracker: { status: null, cachedStatus: status, statusSource: "unavailable" },
      collection: { tracker: "timeout" } });
    finish({ running: true, accessibilityGranted: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toMatchObject({ tracker: { status: null }, collection: { tracker: "timeout" } });
  });
  it("does not queue another native status call when a prior feedback probe timed out but is still running", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(getNativeFeedbackDiagnostics).mockResolvedValue(null);
    const fresh = { running: true, accessibilityGranted: true };
    let finish: (value: typeof fresh) => void = () => {};
    vi.mocked(getFeedbackTrackerStatus).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const state = { app: { version: "1.21.1" }, aiSetup: null,
      tracker: { status: null, accessibilityGranted: false, accessibilityRequired: true } } as FeedbackDiagnosticsAppState;
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = collectFeedbackDiagnostics(state);
      await vi.advanceTimersByTimeAsync(FEEDBACK_PROBE_TIMEOUT_MS);
      expect(await pending).toMatchObject({ tracker: { status: null }, collection: { tracker: "timeout" } });
      expect(getFeedbackTrackerStatus).toHaveBeenCalledTimes(1);
    }
    finish(fresh);
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(getFeedbackTrackerStatus).mockResolvedValue(fresh);
    expect(await collectFeedbackDiagnostics(state)).toMatchObject({ tracker: { status: fresh }, collection: { tracker: "collected" } });
    expect(getFeedbackTrackerStatus).toHaveBeenCalledTimes(2);
  });
  it("releases a rejected status read so a later manual report can collect a healthy response", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(getNativeFeedbackDiagnostics).mockResolvedValue(null);
    vi.mocked(getFeedbackTrackerStatus).mockRejectedValueOnce(new Error("private path"));
    const state = { app: { version: "1.21.1" }, aiSetup: null,
      tracker: { status: null, accessibilityGranted: false, accessibilityRequired: true } } as FeedbackDiagnosticsAppState;
    expect(await collectFeedbackDiagnostics(state)).toMatchObject({ tracker: { status: null }, collection: { tracker: "failed" } });
    const fresh = { running: true, accessibilityGranted: true };
    vi.mocked(getFeedbackTrackerStatus).mockResolvedValue(fresh);
    expect(await collectFeedbackDiagnostics(state)).toMatchObject({ tracker: { status: fresh }, collection: { tracker: "collected" } });
  });
  it("isolates synchronous throws, rejected reads, unavailable data and success", async () => {
    expect(await feedbackProbe(() => { throw new Error("private path"); })).toEqual({ status: "failed", value: null });
    expect(await feedbackProbe(async () => { throw new Error("private"); })).toEqual({ status: "failed", value: null });
    expect(await feedbackProbe(async () => null)).toEqual({ status: "unavailable", value: null });
    expect(await feedbackProbe(async () => 42)).toEqual({ status: "collected", value: 42 });
  });
});

